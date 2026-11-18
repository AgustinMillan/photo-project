import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { Alert, Button, Field } from "../components/ui.tsx";
import { authApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import { validateEmail } from "../lib/validation.ts";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const invalid = validateEmail(email);
    setError(invalid);
    if (invalid) return;

    setBusy(true);
    try {
      await authApi.forgotPassword(email.trim());
      setSent(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Recuperar contraseña"
      footer={
        <Link className="text-accent hover:text-accent-soft" to="/login">
          Volver a ingresar
        </Link>
      }
    >
      {sent ? (
        <Alert tone="ok">Si el email está registrado, te enviamos un enlace para restablecer tu contraseña.</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <Field label="Email" type="email" autoComplete="email" value={email} error={error} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" loading={busy} className="w-full">
            Enviar enlace
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
