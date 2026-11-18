import { api } from "./client.ts";
import type {
  Account,
  AccountType,
  Album,
  AssignableRole,
  AuthResponse,
  AuthUser,
  CatalogStatus,
  CreatedOrder,
  CustomerOrder,
  Entitlement,
  Invitation,
  Member,
  OrderDetail,
  OrderStatus,
  OrderSummary,
  PaymentMethod,
  Photo,
  PublicAlbum,
  PublicStore,
  PublicStorefront,
  SalesStatus,
  Store,
  StorefrontAdmin,
  StorefrontContent,
  Subscription,
} from "./types.ts";

export const authApi = {
  register: (body: { email: string; password: string; displayName?: string }) =>
    api.post<{ message: string; user: AuthUser }>("/auth/register", body, { auth: false }),
  verifyEmail: (token: string) =>
    api.post<{ message: string }>("/auth/verify-email", { token }, { auth: false }),
  resendVerification: (email: string) =>
    api.post<{ message: string }>("/auth/resend-verification", { email }, { auth: false }),
  login: (body: { email: string; password: string }) =>
    api.post<AuthResponse>("/auth/login", body, { auth: false }),
  logout: (allDevices: boolean) => api.post<void>("/auth/logout", { allDevices }, { auth: false }),
  forgotPassword: (email: string) =>
    api.post<{ message: string }>("/auth/forgot-password", { email }, { auth: false }),
  resetPassword: (token: string, newPassword: string) =>
    api.post<{ message: string }>("/auth/reset-password", { token, newPassword }, { auth: false }),
};

export const accountApi = {
  get: () => api.get<{ account: Account }>("/accounts/me"),
  create: (body: { name: string; billingEmail?: string; type?: AccountType }) =>
    api.post<{ account: Account }>("/accounts", body),
  update: (body: { name?: string; billingEmail?: string; type?: AccountType }) =>
    api.patch<{ account: Account }>("/accounts/me", body),
};

export const storesApi = {
  list: () => api.get<{ stores: Store[] }>("/stores"),
  create: (body: { name: string; slug: string }) => api.post<{ store: Store }>("/stores", body),
  update: (storeId: string, body: { name?: string; slug?: string }) =>
    api.patch<{ store: Store }>(`/stores/${storeId}`, body),
  members: (storeId: string) => api.get<{ members: Member[] }>(`/stores/${storeId}/members`),
  updateMember: (storeId: string, userId: string, role: AssignableRole) =>
    api.patch<{ member: Member }>(`/stores/${storeId}/members/${userId}`, { role }),
  removeMember: (storeId: string, userId: string) =>
    api.delete<void>(`/stores/${storeId}/members/${userId}`),
  invitations: (storeId: string) =>
    api.get<{ invitations: Invitation[] }>(`/stores/${storeId}/invitations`),
  invite: (storeId: string, body: { email: string; role: AssignableRole }) =>
    api.post<{ invitation: Invitation }>(`/stores/${storeId}/invitations`, body),
  revokeInvitation: (storeId: string, invitationId: string) =>
    api.delete<void>(`/stores/${storeId}/invitations/${invitationId}`),
  acceptInvitation: (token: string) =>
    api.post<{ store: { id: string; name: string; slug: string }; role: string }>(
      "/invitations/accept",
      { token },
    ),
};

export const billingApi = {
  subscription: () => api.get<{ subscription: Subscription | null }>("/accounts/me/subscription"),
  features: (storeId: string) =>
    api.get<{ entitlements: Record<string, Entitlement> }>(`/stores/${storeId}/features`),
  sales: (storeId: string) => api.get<{ sales: SalesStatus }>(`/stores/${storeId}/sales-status`),
};

export const publicApi = {
  resolveStore: () => api.get<{ store: PublicStore }>("/public/stores/resolve", { auth: false }),
};

export const storefrontApi = {
  get: (storeId: string) => api.get<StorefrontAdmin>(`/stores/${storeId}/storefront`),
  save: (storeId: string, draft: StorefrontContent) =>
    api.put<{ draft: StorefrontContent }>(`/stores/${storeId}/storefront`, draft),
  publish: (storeId: string) =>
    api.post<{ publication: { version: number; publishedAt: string } }>(
      `/stores/${storeId}/storefront/publish`,
    ),
  unpublish: (storeId: string) => api.post<void>(`/stores/${storeId}/storefront/unpublish`),
};

export const catalogApi = {
  albums: (storeId: string) => api.get<{ albums: Album[] }>(`/stores/${storeId}/albums`),
  createAlbum: (
    storeId: string,
    body: { title: string; description?: string; priceCents?: number | null },
  ) => api.post<{ album: Album }>(`/stores/${storeId}/albums`, body),
  updateAlbum: (
    storeId: string,
    albumId: string,
    body: Partial<Pick<Album, "title" | "description" | "priceCents" | "coverPhotoId">> & {
      status?: "draft" | "published";
    },
  ) => api.patch<{ album: Album }>(`/stores/${storeId}/albums/${albumId}`, body),
  removeAlbum: (storeId: string, albumId: string, mode: "release" | "archive") =>
    api.delete<{ mode: string; affectedPhotos: number }>(
      `/stores/${storeId}/albums/${albumId}?mode=${mode}`,
    ),
  photos: (storeId: string, filter: { albumId?: string; unassigned?: boolean }) => {
    const query = filter.albumId
      ? `?albumId=${filter.albumId}`
      : filter.unassigned
        ? "?unassigned=1"
        : "";
    return api.get<{ photos: Photo[] }>(`/stores/${storeId}/photos${query}`);
  },
  upload: (
    storeId: string,
    file: File,
    options: { albumId?: string; priceCents?: number | null; status?: "draft" | "published" },
  ) => {
    const params = new URLSearchParams();
    if (options.albumId) params.set("albumId", options.albumId);
    if (options.priceCents) params.set("priceCents", String(options.priceCents));
    if (options.status) params.set("status", options.status);
    const query = params.toString();
    return api.upload<{ photo: Photo }>(
      `/stores/${storeId}/photos${query ? `?${query}` : ""}`,
      file,
    );
  },
  replace: (storeId: string, photoId: string, file: File) =>
    api.upload<{ photo: { id: string; version: number } }>(
      `/stores/${storeId}/photos/${photoId}/replace`,
      file,
    ),
  updatePhoto: (
    storeId: string,
    photoId: string,
    body: Partial<{
      title: string;
      priceCents: number | null;
      status: CatalogStatus;
      albumId: string | null;
    }>,
  ) => api.patch<{ photo: Photo }>(`/stores/${storeId}/photos/${photoId}`, body),
  bulkPhotos: (
    storeId: string,
    body: { photoIds: string[]; status?: CatalogStatus; priceCents?: number | null },
  ) => api.post<{ updated: number }>(`/stores/${storeId}/photos/bulk`, body),
};

export const ordersApi = {
  list: (storeId: string, status?: OrderStatus) =>
    api.get<{ orders: OrderSummary[] }>(
      `/stores/${storeId}/orders${status ? `?status=${status}` : ""}`,
    ),
  get: (storeId: string, orderId: string) =>
    api.get<OrderDetail>(`/stores/${storeId}/orders/${orderId}`),
  recordPayment: (
    storeId: string,
    orderId: string,
    body: { amountCents: number; method: PaymentMethod; reference: string },
  ) =>
    api.post<{ status: OrderStatus; paidCents: number; remainingCents: number }>(
      `/stores/${storeId}/orders/${orderId}/payments`,
      body,
    ),
  cancel: (storeId: string, orderId: string) =>
    api.post<{ status: OrderStatus }>(`/stores/${storeId}/orders/${orderId}/cancel`),
  link: (storeId: string, orderId: string) =>
    api.get<{ link: string }>(`/stores/${storeId}/orders/${orderId}/link`),
};

export const shopApi = {
  storefront: () => api.get<PublicStorefront>("/public/storefront", { auth: false }),
  album: (albumId: string) => api.get<PublicAlbum>(`/public/albums/${albumId}`, { auth: false }),
  checkout: (body: {
    customerName: string;
    customerEmail: string;
    items: Array<{ type: "photo" | "album"; id: string }>;
  }) => api.post<{ order: CreatedOrder }>("/public/orders", body, { auth: false }),
  order: (orderId: string, token: string) =>
    api.get<CustomerOrder>(`/public/orders/${orderId}?token=${encodeURIComponent(token)}`, {
      auth: false,
    }),
  downloadUrl: (orderId: string, photoId: string, token: string) =>
    `/api/v1/public/orders/${orderId}/photos/${photoId}/download?token=${encodeURIComponent(token)}`,
};
