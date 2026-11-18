import { type FormEvent, useState } from "react";
import { Alert, Button, Card, Field, PageHeader, SelectField, Spinner } from "../components/ui.tsx";
import { accountApi, storesApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import type { AccountType } from "../lib/types.ts";
import { validateEmail, validateRequired, validateSlug } from "../lib/validation.ts";
import { useWorkspace } from "../workspace/WorkspaceContext.tsx";

const PLATFORM_DOMAIN = import.meta.env.VITE_PLATFORM_DOMAIN || "localhost";

export function SettingsPage() {
  const { account, currentStore, reload } = useWorkspace();

  const [accountName, setAccountName] = useState(account?.name ?? "");
  const [accountType, setAccountType] = useState<AccountType>(account?.type ?? "individual");
  const [billingEmail, setBillingEmail] = useState(account?.billingEmail ?? "");
  const [storeName, setStoreName] = useState(currentStore?.name ?? "");
  const [slug, setSlug] = useState(currentStore?.slug ?? "");

  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [accountMsg, setAccountMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [storeMsg, setStoreMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<"account" | "store" | null>(null);

  if (!account || !currentStore) return <Spinner />;

  const canEditStore = currentStore.role === "OWNER" || currentStore.role === "ADMIN";
  const isOwner = currentStore.role === "OWNER";

  async function saveAccount(event: FormEvent) {
    event.preventDefault();
    setAccountMsg(null);
    const next = {
      accountName: validateRequired(accountName, "el nombre de la cuenta"),
      billingEmail: validateEmail(billingEmail),
    };
    setErrors((previous) => ({ ...previous, ...next }));
    if (next.accountName || next.billingEmail) return;

    setBusy("account");
    try {
      await accountApi.update({
        name: accountName.trim(),
        billingEmail: billingEmail.trim(),
        type: accountType,
      });
      await reload();
      setAccountMsg({ tone: "ok", text: "Cuenta actualizada." });
    } catch (caught) {
      setAccountMsg({ tone: "error", text: errorMessage(caught) });
    } finally {
      setBusy(null);
    }
  }

  async function saveStore(event: FormEvent) {
    event.preventDefault();
    setStoreMsg(null);
    const next = {
      storeName: validateRequired(storeName, "el nombre de la tienda"),
      slug: validateSlug(slug),
    };
    setErrors((previous) => ({ ...previous, ...next }));
    if (next.storeName || next.slug) return;

    const slugChanged = slug.trim().toLowerCase() !== currentStore?.slug;
    if (
      slugChanged &&
      !window.confirm(
        "Cambiar el subdominio cambia la dirección pública de tu vitrina. ¿Continuar?",
      )
    ) {
      return;
    }

    setBusy("store");
    try {
      await storesApi.update(currentStore?.id ?? "", {
        name: storeName.trim(),
        slug: slug.trim().toLowerCase(),
      });
      await reload();
      setStoreMsg({ tone: "ok", text: "Tienda actualizada." });
    } catch (caught) {
      setStoreMsg({ tone: "error", text: errorMessage(caught) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Ajustes" />
      <div className="max-w-2xl space-y-4">
        <Card title="Tienda">
          <form onSubmit={saveStore} className="space-y-5" noValidate>
            {storeMsg ? <Alert tone={storeMsg.tone}>{storeMsg.text}</Alert> : null}
            <Field
              label="Nombre"
              value={storeName}
              error={errors.storeName}
              disabled={!canEditStore}
              onChange={(e) => setStoreName(e.target.value)}
            />
            <Field
              label="Subdominio"
              value={slug}
              error={errors.slug}
              disabled={!canEditStore}
              hint={`${slug || "tu-estudio"}.${PLATFORM_DOMAIN}`}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
            />
            {canEditStore ? (
              <Button type="submit" loading={busy === "store"}>
                Guardar tienda
              </Button>
            ) : (
              <p className="text-sm text-fg-dim">
                Solo propietarios y administradores pueden editar la tienda.
              </p>
            )}
          </form>
        </Card>

        <Card title="Cuenta">
          <form onSubmit={saveAccount} className="space-y-5" noValidate>
            {accountMsg ? <Alert tone={accountMsg.tone}>{accountMsg.text}</Alert> : null}
            <Field
              label="Nombre"
              value={accountName}
              error={errors.accountName}
              disabled={!isOwner}
              onChange={(e) => setAccountName(e.target.value)}
            />
            <SelectField
              label="Tipo"
              value={accountType}
              disabled={!isOwner}
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
              disabled={!isOwner}
              onChange={(e) => setBillingEmail(e.target.value)}
            />
            {isOwner ? (
              <Button type="submit" loading={busy === "account"}>
                Guardar cuenta
              </Button>
            ) : (
              <p className="text-sm text-fg-dim">Solo el propietario puede editar la cuenta.</p>
            )}
          </form>
        </Card>
      </div>
    </>
  );
}
