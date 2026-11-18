import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { Alert, Button, Field } from "../components/ui.tsx";
import { authApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import { validateEmail, validatePassword } from "../lib/validation.ts";

export function RegisterPage() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const next = { email: validateEmail(email), password: validatePassword(password) };
    setErrors(next);
    if (next.email || next.password) return;

    setBusy(true);
    try {
      const name = displayName.trim();
      await authApi.register({
        email: email.trim(),
        password,
        ...(name ? { displayName: name } : {}),
      });
      setDone(true);
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthLayout title="Revisa tu correo">
        <Alert tone="ok">
          Te enviamos un enlace a {email.trim()} para verificar tu cuenta. Si no llega en unos
          minutos, revisa la carpeta de spam.
        </Alert>
        <Link className="block text-center text-sm text-accent hover:text-accent-soft" to="/login">
          Ir a ingresar
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Crear cuenta"
      subtitle="Empieza con una prueba gratuita de 30 días."
      footer={
        <>
          ¿Ya tienes cuenta?{" "}
          <Link className="text-accent hover:text-accent-soft" to="/login">
            Ingresar
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {formError ? <Alert>{formError}</Alert> : null}
        <Field
          label="Nombre (opcional)"
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          error={errors.email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Contraseña"
          type="password"
          autoComplete="new-password"
          value={password}
          error={errors.password}
          hint="Mínimo 12 caracteres."
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" loading={busy} className="w-full">
          Crear cuenta
        </Button>
      </form>
    </AuthLayout>
  );
}
