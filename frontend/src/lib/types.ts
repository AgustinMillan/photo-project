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
  priceCents: number | null;
  currency: string;
};

export type SellablePlan = {
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  features: { stats: boolean };
};

export type AutoPayment = {
  provider: "mercadopago";
  status: string;
  payerEmail: string | null;
  nextPaymentAt: string | null;
  planCode: string | null;
};

export type SubscriptionPayment = {
  id: string;
  status: string;
  amountCents: number;
  currency: string;
  paidAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  planName: string | null;
};

export type StoreStats = {
  days: number;
  from: string;
  to: string;
  currency: string;
  totals: {
    visitors: number;
    views: number;
    orders: number;
    revenueCents: number;
    averageOrderCents: number;
    conversionRate: number | null;
  };
  previous: { visitors: number; orders: number; revenueCents: number };
  series: { day: string; visitors: number; views: number; orders: number; revenueCents: number }[];
  topPhotos: {
    id: string;
    title: string;
    thumbUrl: string | null;
    sales: number;
    revenueCents: number;
  }[];
  topAlbums: { id: string; title: string; sales: number; revenueCents: number }[];
  paymentMethods: { method: string; orders: number }[];
  sources: { source: string; visitors: number }[];
};

export type AttributionRow = {
  source: string;
  campaign: string;
  content: string;
  visitors: number;
  signups: number;
  withStore: number;
  published: number;
  withSale: number;
  withAutoPay: number;
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
  autoPayment: AutoPayment | null;
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

export type SectionKey = "hero" | "services" | "albums" | "about" | "contact";

export type StorefrontService = {
  id: string;
  title: string;
  description: string;
  priceFromCents: number | null;
  coverPhotoId: string | null;
};

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
  services: StorefrontService[];
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
export type PaymentMethod = "transfer" | "cash" | "other" | "mercadopago";
export type CheckoutMethod = "transfer" | "mercadopago";

export type OrderSummary = {
  id: string;
  code: string;
  customerName: string;
  customerEmail: string;
  status: OrderStatus;
  totalCents: number;
  currency: string;
  checkoutMethod: CheckoutMethod;
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
  store: {
    id: string;
    name: string;
    slug: string;
    purchasesEnabled: boolean;
    currency: string;
    payments: { mercadopago: boolean; transfer: boolean };
  };
  publication: { version: number; publishedAt: string };
  content: Omit<StorefrontContent, "watermarkText" | "paymentInstructions" | "services"> & {
    coverUrl: string | null;
    services: Array<Omit<StorefrontService, "coverPhotoId"> & { coverUrl: string | null }>;
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
  paymentMethod: CheckoutMethod;
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
    paymentMethod: CheckoutMethod;
    createdAt: string;
    paidAt: string | null;
  };
  items: Array<{ kind: "photo" | "album"; title: string; priceCents: number }>;
  downloads: Array<{ photoId: string; title: string; thumbUrl: string }>;
};

export type MercadoPagoConnection = {
  available: boolean;
  connected: boolean;
  account: {
    providerUserId: string;
    liveMode: boolean;
    connectedAt: string;
    expiresAt: string | null;
  } | null;
  platformFeePercent: number;
};

// --- Platform admin ------------------------------------------------------------

export type AdminOverview = {
  days: number;
  funnel: {
    landingVisitors: number;
    signups: number;
    withStore: number;
    published: number;
    withPhotos: number;
    withSale: number;
    withAutoPay: number;
  };
  revenue: {
    mrrCents: number;
    payingAccounts: number;
    trialsWithAutoPay: number;
    collectedPeriodCents: number;
    failedPaymentsPeriod: number;
  };
  totals: {
    users: number;
    verifiedUsers: number;
    accounts: number;
    stores: number;
    publishedStores: number;
    mercadoPagoConnected: number;
    photos: number;
    storageBytes: number;
    orders: number;
    paidOrders: number;
    pendingOrders: number;
    gmvCents: number;
    gmvPeriodCents: number;
    platformFeesCents: number;
    paidViaMercadoPago: number;
    downloads: number;
    signupsPeriod: number;
    expiringIn7Days: number;
  };
  subscriptions: Array<{ status: string; plan: string; count: number }>;
  series: Array<{
    date: string;
    signups: number;
    orders: number;
    paidOrders: number;
    gmvCents: number;
    landingVisitors: number;
  }>;
  recentOrders: Array<{
    code: string;
    status: OrderStatus;
    checkoutMethod: CheckoutMethod;
    totalCents: number;
    createdAt: string;
    paidAt: string | null;
    storeSlug: string;
  }>;
};

export type AdminAccount = {
  id: string;
  name: string;
  createdAt: string;
  ownerEmail: string;
  verified: boolean;
  storeSlug: string | null;
  publicationStatus: PublicationStatus | null;
  status: "none" | "trial" | "active" | "expired" | "cancelled" | "suspended" | "pilot";
  plan: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  mercadoPago: boolean;
  photos: number;
  paidOrders: number;
  gmvCents: number;
  lastOrderAt: string | null;
  lastLoginAt: string | null;
};

export type AdminAction =
  | {
      action: "activate";
      email: string;
      planCode: "base" | "intermediate" | "business";
      months: number;
      note?: string;
    }
  | { action: "extend"; email: string; days: number; note?: string }
  | { action: "pilot_start"; email: string; note?: string }
  | { action: "pilot_end"; email: string; trialDays?: number; note?: string }
  | { action: "verify_email"; email: string };
