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
  isPilot: boolean;
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

// --- Storefront (phase 3) ---------------------------------------------------

export type SectionKey = "hero" | "albums" | "about" | "contact";

export type StorefrontContent = {
  displayName: string;
  tagline: string;
  bio: string;
  contactEmail: string;
  phone: string;
  instagram: string;
  website: string;
  coverPhotoId: string | null;
  paymentInstructions: string;
  watermarkText: string;
  sections: Array<{ key: SectionKey; enabled: boolean }>;
};

export type StorefrontAdmin = {
  draft: StorefrontContent;
  publicationStatus: PublicationStatus;
  published: { version: number; publishedAt: string } | null;
  canReorderSections: boolean;
};

// --- Catalog (phase 4) -------------------------------------------------------

export type CatalogStatus = "draft" | "published" | "archived";

export type Album = {
  id: string;
  title: string;
  description: string;
  priceCents: number | null;
  status: CatalogStatus;
  sortOrder: number;
  coverPhotoId: string | null;
  createdAt: string;
  photoCount: number;
  publishedCount: number;
  coverUrl: string | null;
};

export type Photo = {
  id: string;
  title: string;
  priceCents: number | null;
  status: CatalogStatus;
  albumId: string | null;
  sortOrder: number;
  createdAt: string;
  version: number;
  width: number;
  height: number;
  originalFilename: string;
  thumbUrl: string;
  previewUrl: string;
};

// --- Orders (phase 5) --------------------------------------------------------

export type OrderStatus = "pending_payment" | "paid" | "cancelled";
export type PaymentMethod = "transfer" | "cash" | "other";

export type OrderSummary = {
  id: string;
  code: string;
  customerName: string;
  customerEmail: string;
  status: OrderStatus;
  totalCents: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
  paidCents: number;
};

export type OrderDetail = {
  order: OrderSummary & { paymentInstructions: string; cancelledAt: string | null };
  items: Array<{
    id: string;
    kind: "photo" | "album";
    title: string;
    priceCents: number;
    photoCount: number;
  }>;
  payments: Array<{
    id: string;
    amountCents: number;
    method: PaymentMethod;
    reference: string;
    createdAt: string;
  }>;
  paidCents: number;
  downloadCount: number;
};

// --- Public shop ---------------------------------------------------------------

export type PublicPhoto = {
  id: string;
  title: string;
  priceCents: number | null;
  albumId: string | null;
  thumbUrl: string;
  previewUrl: string;
};

export type PublicStorefront = {
  store: { id: string; name: string; slug: string; purchasesEnabled: boolean; currency: string };
  publication: { version: number; publishedAt: string };
  content: Omit<StorefrontContent, "watermarkText" | "paymentInstructions"> & {
    coverUrl: string | null;
  };
  albums: Array<{
    id: string;
    title: string;
    description: string;
    priceCents: number | null;
    photoCount: number;
    coverUrl: string | null;
  }>;
  photos: PublicPhoto[];
};

export type PublicAlbum = {
  album: { id: string; title: string; description: string; priceCents: number | null };
  photos: PublicPhoto[];
  purchasesEnabled: boolean;
};

export type CreatedOrder = {
  orderId: string;
  code: string;
  accessToken: string;
  totalCents: number;
  currency: string;
  paymentInstructions: string;
};

export type CustomerOrder = {
  store: { name: string };
  order: {
    id: string;
    code: string;
    status: OrderStatus;
    customerName: string;
    totalCents: number;
    currency: string;
    paymentInstructions: string;
    createdAt: string;
    paidAt: string | null;
  };
  items: Array<{ kind: "photo" | "album"; title: string; priceCents: number }>;
  downloads: Array<{ photoId: string; title: string; thumbUrl: string }>;
};
