import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { Alert, Spinner } from "../components/ui.tsx";
import { authApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"working" | "ok" | "error">(token ? "working" : "error");
  const [message, setMessage] = useState<string>(
    token ? "" : "Falta el código de verificación en el enlace.",
  );
  // The token is single-use: avoid a second call from React StrictMode's double effect.
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;

    authApi
      .verifyEmail(token)
      .then(() => setState("ok"))
      .catch((caught: unknown) => {
        setMessage(errorMessage(caught));
        setState("error");
      });
  }, [token]);

  return (
    <AuthLayout title="Verificar email">
      {state === "working" ? <Spinner label="Verificando…" /> : null}
      {state === "ok" ? (
        <Alert tone="ok">¡Listo! Tu email fue verificado. Ya puedes ingresar.</Alert>
      ) : null}
      {state === "error" ? <Alert>{message}</Alert> : null}
      <Link className="block text-center text-sm text-accent hover:text-accent-soft" to="/login">
        Ir a ingresar
      </Link>
    </AuthLayout>
  );
}
