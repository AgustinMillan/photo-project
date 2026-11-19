import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";
import { billingApi } from "../lib/endpoints.ts";
import { roleLabel } from "../lib/format.ts";
import { useIsAdmin } from "../lib/useIsAdmin.ts";
import { useLoad } from "../lib/useLoad.ts";
import { useWorkspace } from "../workspace/WorkspaceContext.tsx";
import { Button } from "./ui.tsx";

const NAV = [
  { to: "/app", label: "Resumen", end: true },
  { to: "/app/storefront", label: "Vitrina", end: false },
  { to: "/app/catalog", label: "Catálogo", end: false },
  { to: "/app/orders", label: "Pedidos", end: false },
  { to: "/app/stats", label: "Estadísticas", end: false },
  { to: "/app/payments", label: "Cobros", end: false },
  { to: "/app/team", label: "Equipo", end: false },
  { to: "/app/subscription", label: "Plan", end: false },
  { to: "/app/settings", label: "Ajustes", end: false },
];

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const { stores, currentStore, selectStore } = useWorkspace();
  const isAdmin = useIsAdmin();
  const location = useLocation();
  // Re-read on navigation so the banner disappears right after paying.
  const subscription = useLoad(() => billingApi.subscription(), [location.pathname]);
  const sub = subscription.data?.subscription ?? null;
  const inactive = sub !== null && !sub.isUsable && !sub.isPilot;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[16rem_1fr]">
      <aside className="border-b border-line bg-surface p-5 md:border-r md:border-b-0">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">Galeriza</p>

        <div className="mt-6">
          <label
            htmlFor="store-switch"
            className="font-mono text-xs uppercase tracking-wider text-fg-dim"
          >
            Tienda
          </label>
          <select
            id="store-switch"
            value={currentStore?.id ?? ""}
            onChange={(event) => selectStore(event.target.value)}
            className="mt-1 w-full border-0 border-b border-line bg-raised px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
          >
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
          {currentStore ? (
            <p className="mt-1 text-xs text-fg-dim">Tu rol: {roleLabel(currentStore.role)}</p>
          ) : null}
        </div>

        <nav aria-label="Principal" className="mt-6 flex flex-wrap gap-1 md:flex-col">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-ui px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-overlay text-accent-soft"
                    : "text-fg-muted hover:bg-raised hover:text-fg"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {isAdmin ? (
          <NavLink
            to="/admin"
            className="mt-4 block rounded-ui border border-accent/40 px-3 py-2 text-sm text-accent-soft hover:bg-raised"
          >
            Admin plataforma
          </NavLink>
        ) : null}

        <div className="mt-6 border-t border-line pt-4 md:mt-10">
          <p className="truncate text-xs text-fg-dim" title={user?.email}>
            {user?.displayName ?? user?.email}
          </p>
          <Button variant="ghost" className="mt-2 w-full" onClick={() => void logout()}>
            Cerrar sesión
          </Button>
        </div>
      </aside>

      <main className="p-5 md:p-10">
        {inactive && location.pathname !== "/app/subscription" ? (
          <div className="mb-6 rounded-ui border border-danger/40 bg-danger/10 p-4 text-sm">
            <p className="font-medium text-fg">
              {sub?.status === "expired" && sub.trialEndsAt && !sub.currentPeriodEnd
                ? "Tu prueba gratis terminó."
                : "Tu plan no está activo."}
            </p>
            <p className="mt-1 text-fg-muted">
              Tu tienda sigue visible, pero no recibe compras nuevas y las estadísticas están
              pausadas. Tus fotos, galerías y pedidos siguen guardados.
            </p>
            <Link
              to="/app/subscription"
              className="mt-3 inline-block rounded-ui bg-accent px-3 py-1.5 font-medium text-void hover:bg-accent-soft"
            >
              Elegir mi plan
            </Link>
          </div>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}
