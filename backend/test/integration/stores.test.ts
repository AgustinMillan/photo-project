import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { clearTestEmailOutbox, testEmailOutbox } from "../../src/modules/auth/auth.email.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for integration tests.");
}

const client = postgres(databaseUrl, { max: 1 });
const PASSWORD = "CorrectHorseBatteryStaple!";
const OWNER_EMAIL = "owner@example.com";
const MEMBER_EMAIL = "member@example.com";
const OTHER_EMAIL = "other@example.com";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await client`truncate table users, audit_logs cascade`;
  clearTestEmailOutbox();
});

afterAll(async () => {
  await app.close();
  await client.end({ timeout: 5 });
});

function authHeaders(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}

function findEmailLink(to: string, path: string): string {
  const message = [...testEmailOutbox]
    .reverse()
    .find((candidate) => candidate.to === to && candidate.text.includes(path));

  if (!message) {
    throw new Error(`No email containing "${path}" was sent to ${to}.`);
  }

  const match = message.text.match(/token=([A-Za-z0-9_-]+)/);

  if (!match?.[1]) {
    throw new Error(`No token found in the email sent to ${to}.`);
  }

  return match[1];
}

async function createVerifiedUser(email: string, displayName = "Test User") {
  const registerResponse = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password: PASSWORD, displayName },
  });

  expect(registerResponse.statusCode).toBe(201);

  const verificationToken = findEmailLink(email, "/verify-email?token=");
  const verifyResponse = await app.inject({
    method: "POST",
    url: "/api/v1/auth/verify-email",
    payload: { token: verificationToken },
  });

  expect(verifyResponse.statusCode).toBe(200);

  const loginResponse = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: PASSWORD },
  });

  expect(loginResponse.statusCode).toBe(200);

  const body = loginResponse.json() as {
    accessToken: string;
    user: { id: string; email: string };
  };

  return {
    email,
    id: body.user.id,
    accessToken: body.accessToken,
  };
}

async function createAccount(
  accessToken: string,
  payload: Record<string, unknown> = { name: "Test Studio" },
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/accounts",
    headers: authHeaders(accessToken),
    payload,
  });

  expect(response.statusCode).toBe(201);
  return response.json().account as {
    id: string;
    name: string;
    billingEmail: string;
    type: string;
    status: string;
  };
}

async function createStore(accessToken: string, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/stores",
    headers: authHeaders(accessToken),
    payload,
  });

  expect(response.statusCode).toBe(201);
  return response.json().store as {
    id: string;
    accountId: string;
    name: string;
    slug: string;
    primaryHostname: string;
    role: string;
    status: string;
    publicationStatus: string;
  };
}

async function inviteMember(
  accessToken: string,
  storeId: string,
  email: string,
  role: "ADMIN" | "PHOTOGRAPHER" | "EDITOR" = "PHOTOGRAPHER",
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/stores/${storeId}/invitations`,
    headers: authHeaders(accessToken),
    payload: { email, role },
  });

  return response;
}

async function acceptInvitation(accessToken: string, token: string) {
  return app.inject({
    method: "POST",
    url: "/api/v1/invitations/accept",
    headers: authHeaders(accessToken),
    payload: { token },
  });
}

async function resolveStore(host: string) {
  return app.inject({
    method: "GET",
    url: "/api/v1/public/stores/resolve",
    headers: { host },
  });
}

describe("accounts", () => {
  it("creates one account per user and updates its profile", async () => {
    const user = await createVerifiedUser(OWNER_EMAIL);

    const noAccount = await app.inject({
      method: "GET",
      url: "/api/v1/accounts/me",
      headers: authHeaders(user.accessToken),
    });
    expect(noAccount.statusCode).toBe(404);

    const account = await createAccount(user.accessToken, {
      name: "  Acme Photography  ",
      type: "studio",
    });

    expect(account).toMatchObject({
      name: "Acme Photography",
      billingEmail: OWNER_EMAIL,
      type: "studio",
      status: "active",
    });

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/accounts/me",
      headers: authHeaders(user.accessToken),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().account.id).toBe(account.id);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      headers: authHeaders(user.accessToken),
      payload: { name: "Another Account" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("ACCOUNT_ALREADY_EXISTS");

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/v1/accounts/me",
      headers: authHeaders(user.accessToken),
      payload: {
        name: "Acme Studio",
        billingEmail: "Billing@Example.com",
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().account).toMatchObject({
      name: "Acme Studio",
      billingEmail: "billing@example.com",
    });
  });

  it("requires an account before creating a store", async () => {
    const user = await createVerifiedUser(OWNER_EMAIL);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/stores",
      headers: authHeaders(user.accessToken),
      payload: { name: "No Account", slug: "no-account" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ACCOUNT_REQUIRED");
  });
});

describe("stores and tenant isolation", () => {
  it("creates a store atomically with owner membership and a platform domain", async () => {
    const owner = await createVerifiedUser(OWNER_EMAIL, "Owner");
    const account = await createAccount(owner.accessToken);

    const store = await createStore(owner.accessToken, {
      name: "Studio One",
      slug: "Studio-One",
      planCode: "business",
    });

    expect(store).toMatchObject({
      accountId: account.id,
      name: "Studio One",
      slug: "studio-one",
      primaryHostname: "studio-one.localhost",
      role: "OWNER",
      status: "active",
      publicationStatus: "draft",
    });

    const [counts] = await client<{ stores: number; memberships: number; domains: number }[]>`
      select
        (select count(*)::int from stores) as stores,
        (select count(*)::int from store_memberships) as memberships,
        (select count(*)::int from store_domains) as domains
    `;

    expect(counts).toEqual({ stores: 1, memberships: 1, domains: 1 });

    const [domain] = await client<
      { hostname: string; is_primary: boolean; verification_status: string }[]
    >`
      select hostname, is_primary, verification_status from store_domains
    `;
    expect(domain).toMatchObject({
      hostname: "studio-one.localhost",
      is_primary: true,
      verification_status: "verified",
    });

    const members = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${store.id}/members`,
      headers: authHeaders(owner.accessToken),
    });
    expect(members.statusCode).toBe(200);
    expect(members.json().members).toEqual([
      expect.objectContaining({
        userId: owner.id,
        email: OWNER_EMAIL,
        role: "OWNER",
        status: "active",
      }),
    ]);

    const resolved = await resolveStore("studio-one.localhost");
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().store).toMatchObject({
      id: store.id,
      slug: "studio-one",
      publicationStatus: "draft",
    });

    const unknown = await resolveStore("missing.localhost");
    expect(unknown.statusCode).toBe(404);
  });

  it("rejects duplicate, reserved and malformed slugs", async () => {
    const owner = await createVerifiedUser(OWNER_EMAIL);
    await createAccount(owner.accessToken);
    await createStore(owner.accessToken, { name: "First Store", slug: "first-store" });

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/stores",
      headers: authHeaders(owner.accessToken),
      payload: { name: "Duplicate", slug: "FIRST-STORE" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("SLUG_TAKEN");

    const reserved = await app.inject({
      method: "POST",
      url: "/api/v1/stores",
      headers: authHeaders(owner.accessToken),
      payload: { name: "Reserved", slug: "admin" },
    });
    expect(reserved.statusCode).toBe(400);
    expect(reserved.json().error.code).toBe("SLUG_RESERVED");

    for (const slug of ["ab", "two--hyphens", "-leading", "trailing-", "UPPER CASE"]) {
      const invalid = await app.inject({
        method: "POST",
        url: "/api/v1/stores",
        headers: authHeaders(owner.accessToken),
        payload: { name: "Invalid", slug },
      });
      expect(invalid.statusCode).toBe(400);
    }
  });

  it("updates the slug and keeps hostname resolution consistent", async () => {
    const owner = await createVerifiedUser(OWNER_EMAIL);
    await createAccount(owner.accessToken);
    const store = await createStore(owner.accessToken, {
      name: "Old Name",
      slug: "old-name",
    });

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/stores/${store.id}`,
      headers: authHeaders(owner.accessToken),
      payload: { name: "New Name", slug: "new-name" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().store).toMatchObject({
      name: "New Name",
      slug: "new-name",
      primaryHostname: "new-name.localhost",
    });

    const oldHost = await resolveStore("old-name.localhost");
    expect(oldHost.statusCode).toBe(404);

    const newHost = await resolveStore("new-name.localhost");
    expect(newHost.statusCode).toBe(200);
    expect(newHost.json().store.id).toBe(store.id);
  });

  it("prevents cross-tenant reads and writes between two stores", async () => {
    const alice = await createVerifiedUser("alice@example.com", "Alice");
    const bob = await createVerifiedUser("bob@example.com", "Bob");

    await createAccount(alice.accessToken, { name: "Alice Studio" });
    await createAccount(bob.accessToken, { name: "Bob Studio" });

    const aliceStore = await createStore(alice.accessToken, {
      name: "Alice Store",
      slug: "alice-store",
    });
    const bobStore = await createStore(bob.accessToken, {
      name: "Bob Store",
      slug: "bob-store",
    });

    const aliceList = await app.inject({
      method: "GET",
      url: "/api/v1/stores",
      headers: authHeaders(alice.accessToken),
    });
    expect(aliceList.statusCode).toBe(200);
    expect(aliceList.json().stores).toHaveLength(1);
    expect(aliceList.json().stores[0].id).toBe(aliceStore.id);

    const bobList = await app.inject({
      method: "GET",
      url: "/api/v1/stores",
      headers: authHeaders(bob.accessToken),
    });
    expect(bobList.statusCode).toBe(200);
    expect(bobList.json().stores).toHaveLength(1);
    expect(bobList.json().stores[0].id).toBe(bobStore.id);

    const crossTenantRequests = [
      app.inject({
        method: "GET",
        url: `/api/v1/stores/${bobStore.id}`,
        headers: authHeaders(alice.accessToken),
      }),
      app.inject({
        method: "PATCH",
        url: `/api/v1/stores/${bobStore.id}`,
        headers: authHeaders(alice.accessToken),
        payload: { name: "Hijacked" },
      }),
      app.inject({
        method: "GET",
        url: `/api/v1/stores/${bobStore.id}/members`,
        headers: authHeaders(alice.accessToken),
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/stores/${bobStore.id}/invitations`,
        headers: authHeaders(alice.accessToken),
        payload: { email: "intruder@example.com", role: "EDITOR" },
      }),
    ];

    for (const response of await Promise.all(crossTenantRequests)) {
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("STORE_NOT_FOUND");
    }

    const bobStoreAfter = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${bobStore.id}`,
      headers: authHeaders(bob.accessToken),
    });
    expect(bobStoreAfter.statusCode).toBe(200);
    expect(bobStoreAfter.json().store.name).toBe("Bob Store");
  });
});

describe("memberships and invitations", () => {
  it("invites a member by email, enforces roles and removes access", async () => {
    const owner = await createVerifiedUser(OWNER_EMAIL, "Owner");
    const member = await createVerifiedUser(MEMBER_EMAIL, "Member");
    await createAccount(owner.accessToken);
    const store = await createStore(owner.accessToken, {
      name: "Team Store",
      slug: "team-store",
      planCode: "business",
    });

    const invitationResponse = await inviteMember(
      owner.accessToken,
      store.id,
      MEMBER_EMAIL,
      "PHOTOGRAPHER",
    );
    expect(invitationResponse.statusCode).toBe(201);
    expect(invitationResponse.json().invitation).toMatchObject({
      email: MEMBER_EMAIL,
      role: "PHOTOGRAPHER",
      status: "pending",
    });

    const invitationToken = findEmailLink(MEMBER_EMAIL, "/accept-invitation?token=");

    const wrongUserAccept = await acceptInvitation(owner.accessToken, invitationToken);
    expect(wrongUserAccept.statusCode).toBe(403);
    expect(wrongUserAccept.json().error.code).toBe("INVITATION_EMAIL_MISMATCH");

    const accepted = await acceptInvitation(member.accessToken, invitationToken);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      store: { id: store.id, name: "Team Store", slug: "team-store" },
      role: "PHOTOGRAPHER",
    });

    const reused = await acceptInvitation(member.accessToken, invitationToken);
    expect(reused.statusCode).toBe(400);

    const memberStore = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${store.id}`,
      headers: authHeaders(member.accessToken),
    });
    expect(memberStore.statusCode).toBe(200);
    expect(memberStore.json().store.role).toBe("PHOTOGRAPHER");

    const memberList = await app.inject({
      method: "GET",
      url: "/api/v1/stores",
      headers: authHeaders(member.accessToken),
    });
    expect(memberList.statusCode).toBe(200);
    expect(memberList.json().stores).toEqual([
      expect.objectContaining({ id: store.id, role: "PHOTOGRAPHER" }),
    ]);

    const forbiddenTeamList = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${store.id}/members`,
      headers: authHeaders(member.accessToken),
    });
    expect(forbiddenTeamList.statusCode).toBe(403);

    const forbiddenUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/stores/${store.id}`,
      headers: authHeaders(member.accessToken),
      payload: { name: "Changed" },
    });
    expect(forbiddenUpdate.statusCode).toBe(403);

    const forbiddenInvite = await inviteMember(member.accessToken, store.id, OTHER_EMAIL, "EDITOR");
    expect(forbiddenInvite.statusCode).toBe(403);

    const ownerMembers = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${store.id}/members`,
      headers: authHeaders(owner.accessToken),
    });
    expect(ownerMembers.statusCode).toBe(200);
    expect(ownerMembers.json().members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: owner.id, role: "OWNER" }),
        expect.objectContaining({ userId: member.id, role: "PHOTOGRAPHER" }),
      ]),
    );

    const roleUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/stores/${store.id}/members/${member.id}`,
      headers: authHeaders(owner.accessToken),
      payload: { role: "EDITOR" },
    });
    expect(roleUpdate.statusCode).toBe(200);
    expect(roleUpdate.json().member.role).toBe("EDITOR");

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/stores/${store.id}/members/${member.id}`,
      headers: authHeaders(owner.accessToken),
    });
    expect(removed.statusCode).toBe(204);

    const afterRemoval = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${store.id}`,
      headers: authHeaders(member.accessToken),
    });
    expect(afterRemoval.statusCode).toBe(404);
  });

  it("restricts administrators and protects the owner membership", async () => {
    const owner = await createVerifiedUser(OWNER_EMAIL, "Owner");
    const admin = await createVerifiedUser("admin@example.com", "Admin");
    const editor = await createVerifiedUser("editor@example.com", "Editor");
    await createAccount(owner.accessToken);
    const store = await createStore(owner.accessToken, {
      name: "Admin Store",
      slug: "admin-store",
      planCode: "business",
    });

    const adminInvite = await inviteMember(owner.accessToken, store.id, admin.email, "ADMIN");
    expect(adminInvite.statusCode).toBe(201);
    const adminToken = findEmailLink(admin.email, "/accept-invitation?token=");
    expect((await acceptInvitation(admin.accessToken, adminToken)).statusCode).toBe(200);

    const editorInvite = await inviteMember(owner.accessToken, store.id, editor.email, "EDITOR");
    expect(editorInvite.statusCode).toBe(201);
    const editorToken = findEmailLink(editor.email, "/accept-invitation?token=");
    expect((await acceptInvitation(editor.accessToken, editorToken)).statusCode).toBe(200);

    const adminList = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${store.id}/members`,
      headers: authHeaders(admin.accessToken),
    });
    expect(adminList.statusCode).toBe(200);

    const adminCannotInviteAdmin = await inviteMember(
      admin.accessToken,
      store.id,
      OTHER_EMAIL,
      "ADMIN",
    );
    expect(adminCannotInviteAdmin.statusCode).toBe(403);
    expect(adminCannotInviteAdmin.json().error.code).toBe("ADMIN_CANNOT_INVITE_ADMINS");

    const adminCanInviteEditor = await inviteMember(
      admin.accessToken,
      store.id,
      OTHER_EMAIL,
      "EDITOR",
    );
    expect(adminCanInviteEditor.statusCode).toBe(201);

    const adminCannotPromote = await app.inject({
      method: "PATCH",
      url: `/api/v1/stores/${store.id}/members/${editor.id}`,
      headers: authHeaders(admin.accessToken),
      payload: { role: "ADMIN" },
    });
    expect(adminCannotPromote.statusCode).toBe(403);
    expect(adminCannotPromote.json().error.code).toBe("ADMIN_CANNOT_MANAGE_ADMINS");

    const adminCanChangeEditor = await app.inject({
      method: "PATCH",
      url: `/api/v1/stores/${store.id}/members/${editor.id}`,
      headers: authHeaders(admin.accessToken),
      payload: { role: "PHOTOGRAPHER" },
    });
    expect(adminCanChangeEditor.statusCode).toBe(200);

    const ownerImmutable = await app.inject({
      method: "PATCH",
      url: `/api/v1/stores/${store.id}/members/${owner.id}`,
      headers: authHeaders(owner.accessToken),
      payload: { role: "EDITOR" },
    });
    expect(ownerImmutable.statusCode).toBe(403);
    expect(ownerImmutable.json().error.code).toBe("OWNER_MEMBERSHIP_IMMUTABLE");

    const ownerCannotBeRemoved = await app.inject({
      method: "DELETE",
      url: `/api/v1/stores/${store.id}/members/${owner.id}`,
      headers: authHeaders(owner.accessToken),
    });
    expect(ownerCannotBeRemoved.statusCode).toBe(403);

    const adminCannotRemoveAdmin = await app.inject({
      method: "DELETE",
      url: `/api/v1/stores/${store.id}/members/${admin.id}`,
      headers: authHeaders(admin.accessToken),
    });
    expect(adminCannotRemoveAdmin.statusCode).toBe(403);
  });

  it("rejects duplicate and expired invitations", async () => {
    const owner = await createVerifiedUser(OWNER_EMAIL, "Owner");
    const member = await createVerifiedUser(MEMBER_EMAIL, "Member");
    await createAccount(owner.accessToken);
    const store = await createStore(owner.accessToken, {
      name: "Invite Store",
      slug: "invite-store",
      planCode: "business",
    });

    const first = await inviteMember(owner.accessToken, store.id, MEMBER_EMAIL, "EDITOR");
    expect(first.statusCode).toBe(201);

    const duplicate = await inviteMember(owner.accessToken, store.id, MEMBER_EMAIL, "EDITOR");
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("INVITATION_ALREADY_PENDING");

    const token = findEmailLink(MEMBER_EMAIL, "/accept-invitation?token=");

    await client`
      update store_invitations
      set expires_at = now() - interval '1 minute'
      where store_id = ${store.id}
    `;

    const expired = await acceptInvitation(member.accessToken, token);
    expect(expired.statusCode).toBe(400);
    expect(expired.json().error.code).toBe("INVITATION_EXPIRED");

    const [invitation] = await client<{ status: string }[]>`
      select status from store_invitations where store_id = ${store.id}
    `;
    expect(invitation?.status).toBe("expired");
  });
});
