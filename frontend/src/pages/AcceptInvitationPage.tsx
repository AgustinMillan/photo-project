import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { Alert, Spinner } from "../components/ui.tsx";
import { storesApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import { roleLabel } from "../lib/format.ts";
import { useWorkspace } from "../workspace/WorkspaceContext.tsx";

/** Rendered behind <RequireAuth>: an anonymous visitor is sent to /login?next=... first. */
export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const { reload, selectStore } = useWorkspace();
  const [state, setState] = useState<"working" | "ok" | "error">(token ? "working" : "error");
  const [message, setMessage] = useState(token ? "" : "Falta el código de la invitación en el enlace.");
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;

    storesApi
      .acceptInvitation(token)
      .then(async (result) => {
        setMessage(`Te uniste a ${result.store.name} como ${roleLabel(result.role)}.`);
        selectStore(result.store.id);
        await reload();
        setState("ok");
      })
      .catch((caught: unknown) => {
        setMessage(errorMessage(caught));
        setState("error");
      });
  }, [token, reload, selectStore]);

  return (
    <AuthLayout title="Invitación">
      {state === "working" ? <Spinner label="Aceptando invitación…" /> : null}
      {state === "ok" ? <Alert tone="ok">{message}</Alert> : null}
      {state === "error" ? <Alert>{message}</Alert> : null}
      <Link className="block text-center text-sm text-accent hover:text-accent-soft" to="/app">
        Ir al panel
      </Link>
    </AuthLayout>
  );
}
