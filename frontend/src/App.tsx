import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext.tsx";
import { DashboardLayout } from "./components/DashboardLayout.tsx";
import { RequireAuth, RequireWorkspace } from "./components/guards.tsx";
import { resolveTenantSlug } from "./lib/tenant.ts";
import { AcceptInvitationPage } from "./pages/AcceptInvitationPage.tsx";
import { AdminPage } from "./pages/AdminPage.tsx";
import { AlbumPage } from "./pages/AlbumPage.tsx";
import { CatalogPage } from "./pages/CatalogPage.tsx";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { OnboardingPage } from "./pages/OnboardingPage.tsx";
import { OrdersPage } from "./pages/OrdersPage.tsx";
import { OverviewPage } from "./pages/OverviewPage.tsx";
import { PaymentsPage } from "./pages/PaymentsPage.tsx";
import { RegisterPage } from "./pages/RegisterPage.tsx";
import { ResetPasswordPage } from "./pages/ResetPasswordPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { StorefrontEditorPage } from "./pages/StorefrontEditorPage.tsx";
import { SubscriptionPage } from "./pages/SubscriptionPage.tsx";
import { TeamPage } from "./pages/TeamPage.tsx";
import { VerifyEmailPage } from "./pages/VerifyEmailPage.tsx";
import { StorefrontApp } from "./storefront/StorefrontApp.tsx";
import { WorkspaceProvider } from "./workspace/WorkspaceContext.tsx";

const PLATFORM_DOMAIN = import.meta.env.VITE_PLATFORM_DOMAIN || "localhost";

function AuthedShell() {
  return (
    <WorkspaceProvider>
      <Outlet />
    </WorkspaceProvider>
  );
}

export function App() {
  // <slug>.<platform domain> is a public storefront; everything else is the panel.
  if (resolveTenantSlug(window.location.hostname, PLATFORM_DOMAIN)) {
    return <StorefrontApp />;
  }

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route element={<RequireAuth />}>
            <Route path="/admin" element={<AdminPage />} />
            <Route element={<AuthedShell />}>
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
              <Route element={<RequireWorkspace />}>
                <Route path="/app" element={<DashboardLayout />}>
                  <Route index element={<OverviewPage />} />
                  <Route path="storefront" element={<StorefrontEditorPage />} />
                  <Route path="catalog" element={<CatalogPage />} />
                  <Route path="catalog/:albumId" element={<AlbumPage />} />
                  <Route path="orders" element={<OrdersPage />} />
                  <Route path="payments" element={<PaymentsPage />} />
                  <Route path="team" element={<TeamPage />} />
                  <Route path="subscription" element={<SubscriptionPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
