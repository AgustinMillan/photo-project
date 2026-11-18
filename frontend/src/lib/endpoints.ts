import { api } from "./client.ts";
import type {
  Account,
  AccountType,
  AssignableRole,
  AuthResponse,
  AuthUser,
  Entitlement,
  Invitation,
  Member,
  PublicStore,
  SalesStatus,
  Store,
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
