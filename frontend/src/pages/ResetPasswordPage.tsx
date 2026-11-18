import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { Alert, Button, Field } from "../components/ui.tsx";
import { authApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import { validatePassword } from "../lib/validation.ts";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    const invalid = validatePassword(password);
    setError(invalid);
    if (invalid) return;

    setBusy(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Nueva contraseña">
      {!token ? <Alert>Falta el código en el enlace. Solicita uno nuevo.</Alert> : null}
      {done ? (
        <Alert tone="ok">Contraseña actualizada. Ya puedes ingresar con la nueva.</Alert>
      ) : token ? (
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <Field
            label="Nueva contraseña"
            type="password"
            autoComplete="new-password"
            value={password}
            error={error}
            hint="Mínimo 12 caracteres."
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" loading={busy} className="w-full">
            Guardar contraseña
          </Button>
        </form>
      ) : null}
      <Link className="block text-center text-sm text-accent hover:text-accent-soft" to="/login">
        Ir a ingresar
      </Link>
    </AuthLayout>
  );
}
