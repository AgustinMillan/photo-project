import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { clearTestEmailOutbox, testEmailOutbox } from "../../src/modules/auth/auth.email.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests.");

const client = postgres(databaseUrl, { max: 1 });
const PASSWORD = "CorrectHorseBatteryStaple!";
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

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type Owner = { token: string; storeId: string; host: string };

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createOwner(email: string, slug: string): Promise<Owner> {
  await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password: PASSWORD, displayName: "Owner" },
  });
  const message = [...testEmailOutbox].reverse().find((m) => m.to === email);
  const verifyToken = message?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  await app.inject({
    method: "POST",
    url: "/api/v1/auth/verify-email",
    payload: { token: verifyToken },
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: PASSWORD },
  });
  const token = login.json().accessToken as string;
  await app.inject({
    method: "POST",
    url: "/api/v1/accounts",
    headers: auth(token),
    payload: { name: `Studio ${slug}` },
  });
  const store = await app.inject({
    method: "POST",
    url: "/api/v1/stores",
    headers: auth(token),
    payload: { name: `Studio ${slug}`, slug },
  });
  expect(store.statusCode).toBe(201);
  return { token, storeId: store.json().store.id, host: `${slug}.localhost` };
}

async function image(color: string, width = 1200, height = 800): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .withExif({ IFD0: { Copyright: "secret-camera-owner", Artist: "GPS-test" } })
    .toBuffer();
}

function multipart(buffer: Buffer, filename: string, mime = "image/jpeg") {
  const boundary = `----test${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, buffer, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

async function upload(owner: Owner, buffer: Buffer, query = "", filename = "foto.jpg") {
  const body = multipart(buffer, filename);
  return app.inject({
    method: "POST",
    url: `/api/v1/stores/${owner.storeId}/photos${query}`,
    headers: { ...auth(owner.token), ...body.headers },
    payload: body.payload,
  });
}

async function createAlbum(owner: Owner, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/stores/${owner.storeId}/albums`,
    headers: auth(owner.token),
    payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json().album as { id: string };
}

const sections = ["hero", "albums", "about", "contact"].map((key) => ({ key, enabled: true }));

function profile(overrides: Record<string, unknown> = {}) {
  return {
    displayName: "Estudio",
    tagline: "",
    bio: "",
    contactEmail: "",
    phone: "",
    instagram: "",
    website: "",
    coverPhotoId: null,
    paymentInstructions: "Transferí al alias ESTUDIO.FOTOS",
    watermarkText: "ESTUDIO",
    sections,
    ...overrides,
  };
}

async function saveAndPublish(owner: Owner, overrides: Record<string, unknown> = {}) {
  const saved = await app.inject({
    method: "PUT",
    url: `/api/v1/stores/${owner.storeId}/storefront`,
    headers: auth(owner.token),
    payload: profile(overrides),
  });
  expect(saved.statusCode).toBe(200);
  const published = await app.inject({
    method: "POST",
    url: `/api/v1/stores/${owner.storeId}/storefront/publish`,
    headers: auth(owner.token),
  });
  expect(published.statusCode).toBe(200);
  return published.json().publication as { version: number };
}

async function publicGet(host: string, url: string) {
  return app.inject({ method: "GET", url, headers: { host } });
}

/** Store with a published album (2 photos, album price 5000) and a loose photo (price 1500). */
async function sellableStore(slug: string) {
  const owner = await createOwner(`${slug}@example.com`, slug);
  await saveAndPublish(owner);
  const album = await createAlbum(owner, {
    title: "Egresados",
    priceCents: 500000,
    status: "published",
  });
  const a = (
    await upload(
      owner,
      await image("#aa0000"),
      `?albumId=${album.id}&priceCents=200000&status=published`,
    )
  ).json().photo;
  const b = (
    await upload(
      owner,
      await image("#00aa00"),
      `?albumId=${album.id}&priceCents=200000&status=published`,
    )
  ).json().photo;
  const loose = (
    await upload(owner, await image("#0000aa"), "?priceCents=150000&status=published")
  ).json().photo;
  return {
    owner,
    album,
    photoA: a.id as string,
    photoB: b.id as string,
    loose: loose.id as string,
  };
}

async function checkout(host: string, items: Array<{ type: string; id: string }>) {
  return app.inject({
    method: "POST",
    url: "/api/v1/public/orders",
    headers: { host, origin: `http://${host}` },
    payload: { customerName: "Cliente Uno", customerEmail: "cliente@example.com", items },
  });
}

// ---------------------------------------------------------------------------
// Phase 3
// ---------------------------------------------------------------------------

describe("storefront drafts and publications", () => {
  it("keeps the public version immutable until the draft is published again", async () => {
    const owner = await createOwner("pub@example.com", "pub-studio");

    const before = await publicGet(owner.host, "/api/v1/public/storefront");
    expect(before.statusCode).toBe(404);

    expect((await saveAndPublish(owner, { tagline: "Primera" })).version).toBe(1);

    await app.inject({
      method: "PUT",
      url: `/api/v1/stores/${owner.storeId}/storefront`,
      headers: auth(owner.token),
      payload: profile({ tagline: "Borrador nuevo" }),
    });
    const stillV1 = await publicGet(owner.host, "/api/v1/public/storefront");
    expect(stillV1.json().content.tagline).toBe("Primera");
    expect(stillV1.json().content).not.toHaveProperty("watermarkText");

    const v2 = await app.inject({
      method: "POST",
      url: `/api/v1/stores/${owner.storeId}/storefront/publish`,
      headers: auth(owner.token),
    });
    expect(v2.json().publication.version).toBe(2);
    expect((await publicGet(owner.host, "/api/v1/public/storefront")).json().content.tagline).toBe(
      "Borrador nuevo",
    );

    const versions =
      await client`select version, content->>'tagline' as tagline from store_publications order by version`;
    expect(versions.map((row) => row.tagline)).toEqual(["Primera", "Borrador nuevo"]);
  });

  it("serves two stores from the same template with their own content by hostname", async () => {
    const one = await createOwner("one@example.com", "studio-uno");
    const two = await createOwner("two@example.com", "studio-dos");
    await saveAndPublish(one, { displayName: "Uno" });
    await saveAndPublish(two, { displayName: "Dos" });

    expect(
      (await publicGet(one.host, "/api/v1/public/storefront")).json().content.displayName,
    ).toBe("Uno");
    expect(
      (await publicGet(two.host, "/api/v1/public/storefront")).json().content.displayName,
    ).toBe("Dos");
  });

  it("rejects section reordering on plans without the entitlement", async () => {
    const owner = await createOwner("order@example.com", "order-studio");
    const reordered = await app.inject({
      method: "PUT",
      url: `/api/v1/stores/${owner.storeId}/storefront`,
      headers: auth(owner.token),
      payload: profile({ sections: [...sections].reverse() }),
    });
    expect(reordered.statusCode).toBe(403);
    expect(reordered.json().error.code).toBe("SECTIONS_REORDER_NOT_ALLOWED");
  });
});

// ---------------------------------------------------------------------------
// Phase 4
// ---------------------------------------------------------------------------

describe("catalog and media", () => {
  it("processes uploads into stripped derivatives and keeps originals private", async () => {
    const owner = await createOwner("media@example.com", "media-studio");
    const response = await upload(owner, await image("#336699"), "", "atardecer_playa.jpg");
    expect(response.statusCode).toBe(201);
    const photo = response.json().photo;
    expect(photo.title).toBe("atardecer playa");

    const thumb = await app.inject({ method: "GET", url: photo.thumbUrl });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers["content-type"]).toBe("image/webp");
    const meta = await sharp(thumb.rawPayload).metadata();
    expect(meta.exif).toBeUndefined();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(640);

    const assetId = photo.thumbUrl.split("/")[5];
    const original = await app.inject({
      method: "GET",
      url: `/api/v1/public/media/${assetId}/original.jpg`,
    });
    expect(original.statusCode).toBe(404);
  });

  it("rejects files that are not images without creating anything", async () => {
    const owner = await createOwner("bad@example.com", "bad-studio");
    const response = await upload(owner, Buffer.from("not an image at all"), "", "virus.jpg");
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_IMAGE");
    const [count] = await client`select count(*)::int as n from photos`;
    expect(count?.n).toBe(0);
  });

  it("isolates catalogs between tenants", async () => {
    const one = await createOwner("iso1@example.com", "iso-uno");
    const two = await createOwner("iso2@example.com", "iso-dos");
    const photo = (await upload(one, await image("#123456"))).json().photo;
    const foreignAlbum = await createAlbum(two, { title: "Ajeno" });

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/stores/${two.storeId}/photos/${photo.id}`,
      headers: auth(two.token),
      payload: { title: "robada" },
    });
    expect(patch.statusCode).toBe(404);

    const crossStore = await app.inject({
      method: "PATCH",
      url: `/api/v1/stores/${one.storeId}/photos/${photo.id}`,
      headers: auth(one.token),
      payload: { albumId: foreignAlbum.id },
    });
    expect(crossStore.statusCode).toBe(404);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${one.storeId}/photos`,
      headers: auth(two.token),
    });
    expect(list.statusCode).toBe(404);
  });

  it("distinguishes removing an album (photos released) from archiving it (photos archived)", async () => {
    const owner = await createOwner("albums@example.com", "albums-studio");
    const released = await createAlbum(owner, { title: "Liberar" });
    const archived = await createAlbum(owner, { title: "Archivar" });
    const p1 = (await upload(owner, await image("#111111"), `?albumId=${released.id}`)).json()
      .photo;
    const p2 = (await upload(owner, await image("#222222"), `?albumId=${archived.id}`)).json()
      .photo;

    const r1 = await app.inject({
      method: "DELETE",
      url: `/api/v1/stores/${owner.storeId}/albums/${released.id}?mode=release`,
      headers: auth(owner.token),
    });
    const r2 = await app.inject({
      method: "DELETE",
      url: `/api/v1/stores/${owner.storeId}/albums/${archived.id}?mode=archive`,
      headers: auth(owner.token),
    });
    expect(r1.json()).toMatchObject({ mode: "release", affectedPhotos: 1 });
    expect(r2.json()).toMatchObject({ mode: "archive", affectedPhotos: 1 });

    const rows = await client`select id, album_id, status from photos order by created_at`;
    expect(rows.find((r) => r.id === p1.id)).toMatchObject({ album_id: null, status: "draft" });
    expect(rows.find((r) => r.id === p2.id)).toMatchObject({ status: "archived" });
    const audits =
      await client`select action from audit_logs where action like 'album.%' order by id`;
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(["album.removed_releasing_photos", "album.archived_with_photos"]),
    );
  });

  it("replaces a photo keeping previous versions, and a failed replace changes nothing", async () => {
    const owner = await createOwner("replace@example.com", "replace-studio");
    const photo = (await upload(owner, await image("#aaaaaa"))).json().photo;

    const broken = multipart(Buffer.from("broken"), "x.jpg");
    const failed = await app.inject({
      method: "POST",
      url: `/api/v1/stores/${owner.storeId}/photos/${photo.id}/replace`,
      headers: { ...auth(owner.token), ...broken.headers },
      payload: broken.payload,
    });
    expect(failed.statusCode).toBe(400);

    const body = multipart(await image("#bbbbbb"), "nueva.jpg");
    const replaced = await app.inject({
      method: "POST",
      url: `/api/v1/stores/${owner.storeId}/photos/${photo.id}/replace`,
      headers: { ...auth(owner.token), ...body.headers },
      payload: body.payload,
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().photo.version).toBe(2);

    const versions =
      await client`select version, is_current from photo_versions where photo_id = ${photo.id} order by version`;
    expect(versions).toEqual([
      { version: 1, is_current: false },
      { version: 2, is_current: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Phase 5
// ---------------------------------------------------------------------------

describe("orders, manual payments and downloads", () => {
  it("does not charge twice for a photo already covered by an album", async () => {
    const { owner, album, photoA, loose } = await sellableStore("dedupe-studio");

    const storefront = (await publicGet(owner.host, "/api/v1/public/storefront")).json();
    expect(storefront.albums).toEqual([expect.objectContaining({ id: album.id, photoCount: 2 })]);
    expect(storefront.photos).toEqual([expect.objectContaining({ id: loose })]);
    const panelAlbums = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${owner.storeId}/albums`,
      headers: auth(owner.token),
    });
    expect(panelAlbums.json().albums[0]).toMatchObject({ photoCount: 2, publishedCount: 2 });
    expect(panelAlbums.json().albums[0].coverUrl).toMatch(/thumb\.webp$/);
    const response = await checkout(owner.host, [
      { type: "album", id: album.id },
      { type: "photo", id: photoA },
      { type: "photo", id: loose },
    ]);
    expect(response.statusCode).toBe(201);
    expect(response.json().order.totalCents).toBe(500000 + 150000);

    const covered = await client`select photo_id from order_item_photos`;
    expect(covered).toHaveLength(3);
    expect(
      testEmailOutbox.some(
        (m) => m.to === "cliente@example.com" && m.text.includes("ESTUDIO.FOTOS"),
      ),
    ).toBe(true);
  });

  it("rejects unpublished or unpriced items", async () => {
    const { owner } = await sellableStore("unavailable-studio");
    const draft = (await upload(owner, await image("#999999"), "?priceCents=1000")).json().photo;
    const response = await checkout(owner.host, [{ type: "photo", id: draft.id }]);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ITEMS_UNAVAILABLE");
  });

  it("grants downloads only after full payment, of the exact version bought", async () => {
    const { owner, loose } = await sellableStore("pay-studio");
    const created = (await checkout(owner.host, [{ type: "photo", id: loose }])).json().order;
    const orderUrl = `/api/v1/public/orders/${created.orderId}`;
    const downloadUrl = `${orderUrl}/photos/${loose}/download?token=${created.accessToken}`;

    const pending = await publicGet(owner.host, `${orderUrl}?token=${created.accessToken}`);
    expect(pending.json().order.status).toBe("pending_payment");
    expect(pending.json().downloads).toEqual([]);
    expect((await publicGet(owner.host, downloadUrl)).statusCode).toBe(403);

    const partial = await app.inject({
      method: "POST",
      url: `/api/v1/stores/${owner.storeId}/orders/${created.orderId}/payments`,
      headers: auth(owner.token),
      payload: { amountCents: 100000, method: "transfer", reference: "parcial" },
    });
    expect(partial.json()).toMatchObject({ status: "pending_payment", remainingCents: 50000 });
    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${owner.storeId}/orders`,
      headers: auth(owner.token),
    });
    expect(listed.json().orders[0]).toMatchObject({ paidCents: 100000, status: "pending_payment" });
    expect((await publicGet(owner.host, downloadUrl)).statusCode).toBe(403);

    const [originalBefore] = await client`
      select a.checksum_sha256 from photo_versions v join media_assets a on a.id = v.media_asset_id
      where v.photo_id = ${loose} and v.is_current`;

    // The photographer replaces the photo before the order is paid: the buyer
    // still receives the version frozen at checkout.
    const body = multipart(await image("#ffffff"), "reemplazo.jpg");
    await app.inject({
      method: "POST",
      url: `/api/v1/stores/${owner.storeId}/photos/${loose}/replace`,
      headers: { ...auth(owner.token), ...body.headers },
      payload: body.payload,
    });

    const full = await app.inject({
      method: "POST",
      url: `/api/v1/stores/${owner.storeId}/orders/${created.orderId}/payments`,
      headers: auth(owner.token),
      payload: { amountCents: 50000, method: "cash" },
    });
    expect(full.json()).toMatchObject({ status: "paid", remainingCents: 0 });

    const download = await publicGet(owner.host, downloadUrl);
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-disposition"]).toContain("attachment");
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(download.rawPayload).digest("hex")).toBe(
      originalBefore?.checksum_sha256,
    );

    const logs = await client`select count(*)::int as n from download_logs`;
    expect(logs[0]?.n).toBe(1);
    expect(testEmailOutbox.some((m) => m.subject.includes("están listas"))).toBe(true);
  });

  it("does not let a token or another store's hostname unlock an order", async () => {
    const { owner, loose } = await sellableStore("secure-studio");
    const other = await sellableStore("other-studio");
    const created = (await checkout(owner.host, [{ type: "photo", id: loose }])).json().order;
    await app.inject({
      method: "POST",
      url: `/api/v1/stores/${owner.storeId}/orders/${created.orderId}/payments`,
      headers: auth(owner.token),
      payload: { amountCents: 150000, method: "transfer" },
    });

    const base = `/api/v1/public/orders/${created.orderId}`;
    expect((await publicGet(owner.host, `${base}?token=wrong`)).statusCode).toBe(404);
    expect(
      (await publicGet(other.owner.host, `${base}?token=${created.accessToken}`)).statusCode,
    ).toBe(404);
    expect(
      (
        await publicGet(
          owner.host,
          `${base}/photos/${other.loose}/download?token=${created.accessToken}`,
        )
      ).statusCode,
    ).toBe(403);

    const foreignAdmin = await app.inject({
      method: "POST",
      url: `/api/v1/stores/${other.owner.storeId}/orders/${created.orderId}/payments`,
      headers: auth(other.owner.token),
      payload: { amountCents: 1, method: "cash" },
    });
    expect(foreignAdmin.statusCode).toBe(404);
  });

  it("blocks new purchases on an expired subscription but keeps paid downloads", async () => {
    const { owner, loose } = await sellableStore("expired-studio");
    const created = (await checkout(owner.host, [{ type: "photo", id: loose }])).json().order;
    await app.inject({
      method: "POST",
      url: `/api/v1/stores/${owner.storeId}/orders/${created.orderId}/payments`,
      headers: auth(owner.token),
      payload: { amountCents: 150000, method: "transfer" },
    });

    await client`update subscriptions set trial_ends_at = now() - interval '1 minute'`;

    const blocked = await checkout(owner.host, [{ type: "photo", id: loose }]);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("STORE_PURCHASES_DISABLED");

    const download = await publicGet(
      owner.host,
      `/api/v1/public/orders/${created.orderId}/photos/${loose}/download?token=${created.accessToken}`,
    );
    expect(download.statusCode).toBe(200);
  });

  it("rejects checkouts posted from another origin", async () => {
    const { owner, loose } = await sellableStore("origin-studio");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/public/orders",
      headers: { host: owner.host, origin: "https://evil.example" },
      payload: {
        customerName: "X Y",
        customerEmail: "x@example.com",
        items: [{ type: "photo", id: loose }],
      },
    });
    expect(response.statusCode).toBe(403);
  });
});
