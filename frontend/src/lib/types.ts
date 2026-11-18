// Shapes returned by the backend (see backend/src/modules/*). Dates arrive as ISO strings.

export type StoreRole = "OWNER" | "ADMIN" | "PHOTOGRAPHER" | "EDITOR";
export type AssignableRole = Exclude<StoreRole, "OWNER">;

export type AuthUser = {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  emailVerifiedAt: string | null;
  createdAt: string;
};

export type AuthResponse = {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  user: AuthUser;
};

export type AccountType = "individual" | "studio";

export type Account = {
  id: string;
  ownerUserId: string;
  type: AccountType;
  name: string;
  billingEmail: string;
  status: "active" | "suspended" | "closed";
  createdAt: string;
  updatedAt: string;
};

export type StoreStatus = "active" | "suspended" | "archived" | "pending_deletion";
export type PublicationStatus = "draft" | "published" | "unpublished";

export type Store = {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  status: StoreStatus;
  publicationStatus: PublicationStatus;
  primaryHostname: string | null;
  role: StoreRole;
  createdAt: string;
  updatedAt: string;
};

export type PublicStore = {
  id: string;
  name: string;
  slug: string;
  publicationStatus: PublicationStatus;
  purchasesEnabled: boolean;
};

export type MemberStatus = "invited" | "active" | "suspended" | "removed";

export type Member = {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: StoreRole;
  status: MemberStatus;
  acceptedAt: string | null;
  createdAt: string;
};

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export type Invitation = {
  id: string;
  email: string;
  role: AssignableRole;
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
};

export type SubscriptionStatus = "trial" | "active" | "expired" | "cancelled" | "suspended";

export type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: "active" | "retired";
  sortOrder: number;
};

export type Entitlement = {
  featureKey: string;
  enabled: boolean;
  limitValue: number | null;
  config: Record<string, unknown>;
};

export type Subscription = {
  id: string;
  accountId: string;
  status: SubscriptionStatus;
  isUsable: boolean;
  plan: Plan;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  startedAt: string;
  endedAt: string | null;
  cancelledAt: string | null;
  suspendedAt: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
  entitlements: Entitlement[];
};

export type SalesStatus = {
  enabled: boolean;
  reason:
    | "STORE_NOT_FOUND"
    | "STORE_INACTIVE"
    | "ACCOUNT_INACTIVE"
    | "SUBSCRIPTION_MISSING"
    | "SUBSCRIPTION_INACTIVE"
    | "PLAN_PURCHASES_DISABLED"
    | null;
};
