import { Link } from "react-router-dom";
import { Alert, Badge, Card, PageHeader, Spinner, Stat } from "../components/ui.tsx";
import { billingApi, storesApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import {
  daysUntil,
  formatDate,
  publicationLabel,
  salesReasonLabel,
  storeUrl,
  subscriptionStatusLabel,
} from "../lib/format.ts";
import { useLoad } from "../lib/useLoad.ts";
import { useWorkspace } from "../workspace/WorkspaceContext.tsx";

export function OverviewPage() {
  const { currentStore, account } = useWorkspace();
  const storeId = currentStore?.id ?? "";

  const subscription = useLoad(() => billingApi.subscription(), []);
  const sales = useLoad(() => billingApi.sales(storeId), [storeId]);
  const members = useLoad(() => storesApi.members(storeId), [storeId]);

  if (!currentStore) return <Spinner />;

  const sub = subscription.data?.subscription ?? null;
  const trialDays = sub?.status === "trial" ? daysUntil(sub.trialEndsAt) : null;
  const url = storeUrl(currentStore.primaryHostname, window.location);
  const memberCount = members.data?.members.filter((m) => m.status === "active").length;

  return (
    <>
      <PageHeader
        title={currentStore.name}
        subtitle={account ? `Cuenta: ${account.name}` : undefined}
      />

      {trialDays !== null && trialDays <= 3 ? (
        <div className="mb-6">
          <Alert tone="info">
            {trialDays <= 0
              ? "Tu prueba gratuita termina hoy."
              : `Tu prueba gratuita termina en ${trialDays} día${trialDays === 1 ? "" : "s"}.`}{" "}
            <Link className="underline" to="/app/subscription">
              Ver plan
            </Link>
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Plan"
          value={sub ? sub.plan.name : "—"}
          hint={
            sub
              ? sub.isPilot
                ? "Piloto"
                : subscriptionStatusLabel(sub.status)
              : subscription.loading
                ? "Cargando…"
                : "Sin suscripción"
          }
        />
        <Stat
          label={trialDays !== null ? "Días de prueba" : "Vence"}
          value={
            trialDays !== null
              ? Math.max(trialDays, 0)
              : sub?.isPilot
                ? "Nunca"
                : formatDate(sub?.currentPeriodEnd)
          }
          hint={trialDays !== null ? `Hasta ${formatDate(sub?.trialEndsAt)}` : undefined}
        />
        <Stat
          label="Vitrina"
          value={publicationLabel(currentStore.publicationStatus)}
          hint={url ?? undefined}
        />
        <Stat label="Equipo" value={memberCount ?? "—"} hint="miembros activos" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Ventas">
          {sales.loading ? (
            <Spinner />
          ) : sales.error ? (
            <Alert>{errorMessage(sales.error)}</Alert>
          ) : sales.data?.sales.enabled ? (
            <Badge tone="ok">Habilitadas</Badge>
          ) : (
            <div className="space-y-2">
              <Badge tone="warn">No habilitadas</Badge>
              <p className="text-sm text-fg-dim">
                {salesReasonLabel(sales.data?.sales.reason ?? null)}
              </p>
            </div>
          )}
        </Card>

        <Card title="Próximos pasos">
          <ul className="space-y-2 text-sm text-fg-muted">
            <li>✓ Tienda creada</li>
            <li>
              {memberCount && memberCount > 1 ? "✓" : "○"} Invitar a tu equipo (
              <Link className="text-accent hover:text-accent-soft" to="/app/team">
                Equipo
              </Link>
              )
            </li>
            <li className="text-fg-dim">○ Subir galerías de fotos — próximamente</li>
            <li className="text-fg-dim">○ Publicar tu vitrina — próximamente</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
