import { type FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { Alert, Button, Field, SelectField, Spinner } from "../components/ui.tsx";
import { accountApi, storesApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import { slugify } from "../lib/format.ts";
import type { AccountType } from "../lib/types.ts";
import { validateEmail, validateRequired, validateSlug } from "../lib/validation.ts";
import { useWorkspace } from "../workspace/WorkspaceContext.tsx";

const PLATFORM_DOMAIN = import.meta.env.VITE_PLATFORM_DOMAIN || "localhost";

export function OnboardingPage() {
  const { user } = useAuth();
  const { loading, account, stores, reload, selectStore } = useWorkspace();
  const navigate = useNavigate();

  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("individual");
  const [billingEmail, setBillingEmail] = useState(user?.email ?? "");
  const [storeName, setStoreName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner />;
  if (account && stores.length > 0) return <Navigate to="/app" replace />;

  const needsAccount = !account;

  function onStoreNameChange(value: string) {
    setStoreName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const next: Record<string, string | null> = {
      storeName: validateRequired(storeName, "el nombre de tu tienda"),
      slug: validateSlug(slug),
    };
    if (needsAccount) {
      next.accountName = validateRequired(accountName, "el nombre de tu cuenta");
      next.billingEmail = validateEmail(billingEmail);
    }
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    setBusy(true);
    try {
      if (needsAccount) {
        await accountApi.create({
          name: accountName.trim(),
          billingEmail: billingEmail.trim(),
          type: accountType,
        });
      }
      const { store } = await storesApi.create({
        name: storeName.trim(),
        slug: slug.trim().toLowerCase(),
      });
      selectStore(store.id);
      await reload();
      navigate("/app", { replace: true });
    } catch (caught) {
      // If the account was created but the store failed, the retry skips the account step.
      await reload();
      setFormError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Configura tu estudio"
      subtitle="Crea tu cuenta y tu primera tienda. La prueba gratuita de 14 días empieza con la tienda."
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {formError ? <Alert>{formError}</Alert> : null}

        {needsAccount ? (
          <>
            <Field
              label="Nombre de la cuenta"
              value={accountName}
              error={errors.accountName}
              onChange={(e) => setAccountName(e.target.value)}
            />
            <SelectField
              label="Tipo"
              value={accountType}
              onChange={(e) => setAccountType(e.target.value as AccountType)}
            >
              <option value="individual">Fotógrafo independiente</option>
              <option value="studio">Estudio</option>
            </SelectField>
            <Field
              label="Email de facturación"
              type="email"
              value={billingEmail}
              error={errors.billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
            />
          </>
        ) : null}

        <Field
          label="Nombre de la tienda"
          value={storeName}
          error={errors.storeName}
          onChange={(e) => onStoreNameChange(e.target.value)}
        />
        <Field
          label="Subdominio"
          value={slug}
          error={errors.slug}
          hint={`Tu dirección será ${slug || "tu-estudio"}.${PLATFORM_DOMAIN}`}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value.toLowerCase());
          }}
        />
        <Button type="submit" loading={busy} className="w-full">
          Crear tienda
        </Button>
      </form>
    </AuthLayout>
  );
}
