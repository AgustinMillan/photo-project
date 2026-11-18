import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";
import { roleLabel } from "../lib/format.ts";
import { useWorkspace } from "../workspace/WorkspaceContext.tsx";
import { Button } from "./ui.tsx";

const NAV = [
  { to: "/app", label: "Resumen", end: true },
  { to: "/app/team", label: "Equipo", end: false },
  { to: "/app/subscription", label: "Plan", end: false },
  { to: "/app/settings", label: "Ajustes", end: false },
];

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const { stores, currentStore, selectStore } = useWorkspace();

  return (
    <div className="min-h-screen md:grid md:grid-cols-[16rem_1fr]">
      <aside className="border-b border-line bg-surface p-5 md:border-r md:border-b-0">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">Photo Platform</p>

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

        <nav aria-label="Principal" className="mt-6 flex gap-1 md:flex-col">
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
        <Outlet />
      </main>
    </div>
  );
}
