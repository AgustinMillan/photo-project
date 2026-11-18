import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { safeNext } from "../components/guards.tsx";
import { Alert, Button, Field, Spinner } from "../components/ui.tsx";
import { authApi } from "../lib/endpoints.ts";
import { errorMessage, isApiError } from "../lib/errors.ts";
import { validateEmail } from "../lib/validation.ts";

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (auth.status === "loading") return <Spinner />;
  if (auth.status === "authenticated") return <Navigate to={next} replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setUnverified(false);

    const emailError = validateEmail(email);
    if (emailError || !password) {
      setError(emailError ?? "Ingresa tu contraseña.");
      return;
    }

    setBusy(true);
    try {
      await auth.login(email, password);
      navigate(next, { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
      setUnverified(isApiError(caught, "EMAIL_NOT_VERIFIED"));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    try {
      await authApi.resendVerification(email.trim());
      setNotice("Si el email existe, te enviamos un nuevo enlace de verificación.");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <AuthLayout
      title="Ingresar"
      subtitle="Accede al panel de tu estudio."
      footer={
        <>
          ¿No tienes cuenta?{" "}
          <Link className="text-accent hover:text-accent-soft" to="/register">
            Crear cuenta
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error ? <Alert>{error}</Alert> : null}
        {notice ? <Alert tone="ok">{notice}</Alert> : null}
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" loading={busy} className="w-full">
          Ingresar
        </Button>
      </form>
      {unverified ? (
        <Button variant="ghost" className="w-full" onClick={() => void resend()}>
          Reenviar email de verificación
        </Button>
      ) : null}
      <p className="text-center text-sm">
        <Link className="text-fg-dim hover:text-accent-soft" to="/forgot-password">
          Olvidé mi contraseña
        </Link>
      </p>
    </AuthLayout>
  );
}
