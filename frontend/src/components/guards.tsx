import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";
import { errorMessage } from "../lib/errors.ts";
import { useWorkspace } from "../workspace/WorkspaceContext.tsx";
import { Alert, Button, Spinner } from "./ui.tsx";

/** Only allows same-origin relative paths as post-login destinations. */
export function safeNext(value: string | null | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/app";
}

export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === "loading") {
    return <Spinner label="Verificando sesión…" />;
  }

  if (auth.status === "anonymous") {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <Outlet />;
}

export function RequireWorkspace() {
  const { loading, error, account, stores, reload } = useWorkspace();

  if (loading) {
    return <Spinner label="Cargando tu estudio…" />;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-8">
        <Alert>{errorMessage(error)}</Alert>
        <Button onClick={() => void reload()}>Reintentar</Button>
      </div>
    );
  }

  if (!account || stores.length === 0) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}
