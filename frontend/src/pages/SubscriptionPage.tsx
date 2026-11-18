import { Alert, Badge, Card, PageHeader, Spinner } from "../components/ui.tsx";
import { billingApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import { daysUntil, featureLabel, formatDate, subscriptionStatusLabel } from "../lib/format.ts";
import { useLoad } from "../lib/useLoad.ts";

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL;

function entitlementValue(enabled: boolean, limit: number | null): string {
  if (limit !== null) return String(limit);
  return enabled ? "Incluido" : "No incluido";
}

export function SubscriptionPage() {
  const { data, loading, error } = useLoad(() => billingApi.subscription(), []);

  if (loading) return <Spinner />;
  if (error) return <Alert>{errorMessage(error)}</Alert>;

  const sub = data?.subscription ?? null;

  if (!sub) {
    return (
      <>
        <PageHeader title="Plan" />
        <Alert tone="info">Todavía no tienes una suscripción. Se crea junto con tu primera tienda.</Alert>
      </>
    );
  }

  const trialDays = sub.status === "trial" ? daysUntil(sub.trialEndsAt) : null;

  return (
    <>
      <PageHeader title="Plan" subtitle="Tu suscripción y lo que incluye." />

      <div className="space-y-4">
        {!sub.isUsable ? (
          <Alert>
            Tu suscripción no está activa: las funciones del plan están limitadas.{" "}
            {SUPPORT_EMAIL ? (
              <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>
                Escríbenos
              </a>
            ) : null}
          </Alert>
        ) : null}

        <Card
          title={sub.plan.name}
          action={<Badge tone={sub.isUsable ? "ok" : "danger"}>{subscriptionStatusLabel(sub.status)}</Badge>}
        >
          {sub.plan.description ? <p className="mb-4 text-sm text-fg-dim">{sub.plan.description}</p> : null}
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="font-mono text-xs uppercase tracking-wider text-fg-dim">Inicio</dt>
              <dd className="mt-1 text-fg">{formatDate(sub.startedAt)}</dd>
            </div>
            {sub.status === "trial" ? (
              <div>
                <dt className="font-mono text-xs uppercase tracking-wider text-fg-dim">Fin de la prueba</dt>
                <dd className="mt-1 text-fg">
                  {formatDate(sub.trialEndsAt)}
                  {trialDays !== null ? ` (${Math.max(trialDays, 0)} d)` : ""}
                </dd>
              </div>
            ) : (
              <div>
                <dt className="font-mono text-xs uppercase tracking-wider text-fg-dim">Período actual hasta</dt>
                <dd className="mt-1 text-fg">{formatDate(sub.currentPeriodEnd)}</dd>
              </div>
            )}
            {sub.cancelAtPeriodEnd ? (
              <div>
                <dt className="font-mono text-xs uppercase tracking-wider text-fg-dim">Cancelación</dt>
                <dd className="mt-1 text-fg">Al final del período</dd>
              </div>
            ) : null}
          </dl>
        </Card>

        <Card title="Incluye">
          <ul className="divide-y divide-line">
            {sub.entitlements.map((entitlement) => (
              <li key={entitlement.featureKey} className="flex items-center justify-between py-2 text-sm">
                <span className="text-fg-muted">{featureLabel(entitlement.featureKey)}</span>
                <span className={entitlement.enabled ? "text-fg" : "text-fg-dim"}>
                  {entitlementValue(entitlement.enabled, entitlement.limitValue)}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Pagos">
          <p className="text-sm text-fg-dim">
            La activación y renovación del plan se coordinan con nosotros por ahora.
            {SUPPORT_EMAIL ? (
              <>
                {" "}
                Escríbenos a{" "}
                <a className="text-accent hover:text-accent-soft" href={`mailto:${SUPPORT_EMAIL}`}>
                  {SUPPORT_EMAIL}
                </a>
                .
              </>
            ) : null}
          </p>
        </Card>
      </div>
    </>
  );
}
