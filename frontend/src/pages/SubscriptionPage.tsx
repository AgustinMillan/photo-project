import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";
import { Alert, Badge, Button, Card, Field, PageHeader, Spinner } from "../components/ui.tsx";
import { billingApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import { daysUntil, featureLabel, formatDate, subscriptionStatusLabel } from "../lib/format.ts";
import { formatMoney } from "../lib/money.ts";
import type { SellablePlan, Subscription, SubscriptionPayment } from "../lib/types.ts";
import { useLoad } from "../lib/useLoad.ts";

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL;

const PLAN_POINTS: Record<string, string[]> = {
  base: [
    "Tu tienda con link propio",
    "Fotos y galerías ilimitadas para vender",
    "Cobro con Mercado Pago y transferencia",
    "Entrega automática en alta resolución",
    "Servicios con consultas por WhatsApp",
  ],
  pro: [
    "Todo lo del plan Base",
    "Estadísticas: visitas, ventas e ingresos por día",
    "Fotos y galerías más vendidas",
    "Conversión de visitas a ventas",
  ],
};

const PAYMENT_STATUS: Record<
  string,
  { label: string; tone: "ok" | "warn" | "danger" | "neutral" }
> = {
  approved: { label: "Pagado", tone: "ok" },
  rejected: { label: "Rechazado", tone: "danger" },
  cancelled: { label: "Cancelado", tone: "danger" },
  in_process: { label: "En proceso", tone: "warn" },
  pending: { label: "Pendiente", tone: "warn" },
};

function autoPayLabel(
  sub: Subscription,
): { text: string; tone: "ok" | "warn" | "danger" | "neutral" } | null {
  const auto = sub.autoPayment;
  if (!auto) return null;
  if (auto.status === "authorized") return { text: "Pago automático activo", tone: "ok" };
  if (auto.status === "pending") return { text: "Pago automático sin confirmar", tone: "warn" };
  if (auto.status === "paused") return { text: "Pago automático pausado", tone: "warn" };
  return { text: "Pago automático cancelado", tone: "neutral" };
}

function accessUntil(sub: Subscription): string | null {
  if (sub.status === "trial") return sub.trialEndsAt;
  if (sub.status === "active") return sub.currentPeriodEnd;
  return null;
}

export function SubscriptionPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const returning = params.get("mp");
  const [syncing, setSyncing] = useState(returning === "return" || returning === "updated");
  const sub = useLoad(() => billingApi.subscription(), []);
  const plans = useLoad(() => billingApi.plans(), []);
  const payments = useLoad(() => billingApi.payments().catch(() => ({ payments: [] })), []);
  const [payerEmail, setPayerEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Back from Mercado Pago: read the result once, then clean the URL.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on return
  useEffect(() => {
    if (!returning) return;
    let cancelled = false;
    billingApi
      .sync()
      .then((result) => {
        if (cancelled) return;
        const status = result.subscription?.autoPayment?.status;
        setNotice(
          returning === "updated"
            ? "Listo: cambiamos tu plan. El nuevo precio se aplica desde el próximo cobro."
            : status === "authorized"
              ? "¡Listo! Tu pago automático quedó activo."
              : "Si completaste el pago en Mercado Pago, en unos minutos lo vas a ver confirmado acá.",
        );
        sub.reload();
        payments.reload();
      })
      .catch((error) => !cancelled && setActionError(errorMessage(error)))
      .finally(() => {
        if (cancelled) return;
        setSyncing(false);
        setParams({}, { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const auto = sub.data?.subscription?.autoPayment;
    setPayerEmail((current) => current || auto?.payerEmail || user?.email || "");
  }, [sub.data, user?.email]);

  if (sub.loading && !sub.data) return <Spinner />;
  if (sub.error) return <Alert>{errorMessage(sub.error)}</Alert>;

  const subscription = sub.data?.subscription ?? null;

  if (!subscription) {
    return (
      <>
        <PageHeader title="Plan" />
        <Alert tone="info">
          Todavía no tienes una suscripción. Se crea junto con tu primera tienda.
        </Alert>
      </>
    );
  }

  const auto = subscription.autoPayment;
  const autoActive = auto?.status === "authorized";
  const chosenCode = autoActive ? auto?.planCode : null;
  const until = accessUntil(subscription);
  const trialDays = subscription.status === "trial" ? daysUntil(subscription.trialEndsAt) : null;
  const autoBadge = autoPayLabel(subscription);

  async function choose(plan: SellablePlan) {
    setBusy(plan.code);
    setActionError(null);
    try {
      const result = await billingApi.checkout({
        planCode: plan.code,
        payerEmail: payerEmail.trim() || undefined,
      });
      window.location.assign(result.url);
    } catch (error) {
      setActionError(errorMessage(error));
      setBusy(null);
    }
  }

  async function cancel() {
    setBusy("cancel");
    setActionError(null);
    try {
      await billingApi.cancel();
      setConfirmCancel(false);
      setNotice(
        "Cancelaste el pago automático. Tu tienda sigue funcionando hasta el final del período.",
      );
      sub.reload();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Plan" subtitle="Tu suscripción a Galeriza y cómo se paga." />

      <div className="space-y-4">
        {syncing ? <Spinner label="Confirmando con Mercado Pago…" /> : null}
        {notice ? <Alert tone="info">{notice}</Alert> : null}
        {actionError ? <Alert>{actionError}</Alert> : null}

        {!subscription.isUsable ? (
          <Alert>
            Tu plan no está activo: tu tienda no está recibiendo compras nuevas. Elige un plan abajo
            para reactivarla; tus fotos y pedidos siguen guardados.
          </Alert>
        ) : null}

        <Card
          title={`Plan ${subscription.plan.name}`}
          action={
            <div className="flex flex-wrap gap-2">
              <Badge tone={subscription.isUsable ? "ok" : "danger"}>
                {subscription.isPilot ? "Piloto" : subscriptionStatusLabel(subscription.status)}
              </Badge>
              {autoBadge ? <Badge tone={autoBadge.tone}>{autoBadge.text}</Badge> : null}
            </div>
          }
        >
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            {subscription.isPilot ? (
              <div>
                <dt className="font-mono text-xs uppercase tracking-wider text-fg-dim">Vence</dt>
                <dd className="mt-1 text-fg">Sin vencimiento: cliente piloto</dd>
              </div>
            ) : (
              <div>
                <dt className="font-mono text-xs uppercase tracking-wider text-fg-dim">
                  {subscription.status === "trial" ? "Prueba gratis hasta" : "Pagado hasta"}
                </dt>
                <dd className="mt-1 text-fg">
                  {until ? formatDate(until) : "—"}
                  {trialDays !== null ? ` (${Math.max(trialDays, 0)} días)` : ""}
                </dd>
              </div>
            )}
            {autoActive && auto?.nextPaymentAt && !subscription.cancelAtPeriodEnd ? (
              <div>
                <dt className="font-mono text-xs uppercase tracking-wider text-fg-dim">
                  Próximo cobro
                </dt>
                <dd className="mt-1 text-fg">{formatDate(auto.nextPaymentAt)}</dd>
              </div>
            ) : null}
            {autoActive && auto?.payerEmail ? (
              <div>
                <dt className="font-mono text-xs uppercase tracking-wider text-fg-dim">
                  Cuenta de Mercado Pago
                </dt>
                <dd className="mt-1 break-all text-fg">{auto.payerEmail}</dd>
              </div>
            ) : null}
            {subscription.cancelAtPeriodEnd ? (
              <div>
                <dt className="font-mono text-xs uppercase tracking-wider text-fg-dim">
                  Cancelación
                </dt>
                <dd className="mt-1 text-fg">Sin renovación al terminar el período</dd>
              </div>
            ) : null}
          </dl>
          {subscription.status === "trial" && !autoActive && !subscription.isPilot ? (
            <p className="mt-4 text-sm text-fg-muted">
              Activa el pago automático cuando quieras: no se cobra nada hasta que termine tu
              prueba, y después se cobra solo cada mes.
            </p>
          ) : null}
          {subscription.status === "trial" && autoActive && chosenCode ? (
            <p className="mt-4 text-sm text-fg-muted">
              Durante la prueba tienes todo incluido. Cuando termine, sigues con el plan{" "}
              {plans.data?.plans.find((plan) => plan.code === chosenCode)?.name ?? chosenCode}.
            </p>
          ) : null}
        </Card>

        {subscription.isPilot ? (
          <Alert tone="info">
            Eres cliente piloto: tienes todas las funciones gratis mientras dure el piloto. Si
            termina, te avisaremos y tendrás un mes de prueba antes de tener que pagar.
          </Alert>
        ) : (
          <Card title={autoActive ? "Cambiar de plan" : "Elige tu plan"}>
            {plans.loading ? <Spinner /> : null}
            {plans.error ? <Alert>{errorMessage(plans.error)}</Alert> : null}
            <div className="grid gap-4 md:grid-cols-2">
              {plans.data?.plans.map((plan) => {
                const current = chosenCode === plan.code;
                return (
                  <div
                    key={plan.code}
                    className={`flex flex-col rounded-ui border p-5 ${
                      current ? "border-accent" : "border-line"
                    } bg-raised`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display text-xl text-fg">{plan.name}</h3>
                      {plan.features.stats ? <Badge tone="warn">Con estadísticas</Badge> : null}
                    </div>
                    <p className="mt-2 font-display text-3xl text-fg">
                      {formatMoney(plan.priceCents, plan.currency)}
                      <span className="font-sans text-sm text-fg-dim"> / mes</span>
                    </p>
                    <ul className="mt-4 flex-1 space-y-1 text-sm text-fg-muted">
                      {(PLAN_POINTS[plan.code] ?? [plan.description ?? ""]).map((point) => (
                        <li key={point}>✓ {point}</li>
                      ))}
                    </ul>
                    <Button
                      className="mt-5"
                      variant={current ? "ghost" : "primary"}
                      disabled={current || busy !== null}
                      loading={busy === plan.code}
                      onClick={() => choose(plan)}
                    >
                      {current
                        ? "Tu plan actual"
                        : autoActive
                          ? `Cambiar a ${plan.name}`
                          : "Pagar con Mercado Pago"}
                    </Button>
                  </div>
                );
              })}
            </div>
            {!autoActive ? (
              <div className="mt-5 max-w-md">
                <Field
                  label="Email de tu cuenta de Mercado Pago"
                  type="email"
                  value={payerEmail}
                  onChange={(event) => setPayerEmail(event.target.value)}
                  hint="Tiene que ser el email con el que entras a Mercado Pago para pagar."
                />
              </div>
            ) : null}
            <p className="mt-4 text-xs text-fg-dim">
              El cobro es mensual con Mercado Pago, con tarjeta de crédito, débito o dinero en
              cuenta. Puedes cancelarlo cuando quieras desde acá.
            </p>
          </Card>
        )}

        {autoActive && !subscription.cancelAtPeriodEnd ? (
          <Card title="Cancelar">
            {confirmCancel ? (
              <div className="space-y-3 text-sm text-fg-muted">
                <p>
                  Si cancelas, no se te vuelve a cobrar y tu tienda sigue funcionando hasta el{" "}
                  {until ? formatDate(until) : "final del período"}. Después deja de recibir compras
                  nuevas, pero tus fotos y pedidos quedan guardados.
                </p>
                <div className="flex gap-2">
                  <Button variant="danger" loading={busy === "cancel"} onClick={cancel}>
                    Sí, cancelar el pago automático
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmCancel(false)}>
                    Volver
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
                Cancelar el pago automático
              </Button>
            )}
          </Card>
        ) : null}

        <PaymentsHistory payments={payments.data?.payments ?? []} />

        <Card title="Incluye tu plan actual">
          <ul className="divide-y divide-line">
            {subscription.entitlements
              .filter((entitlement) => !entitlement.featureKey.startsWith("team.max"))
              .map((entitlement) => (
                <li
                  key={entitlement.featureKey}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span className="text-fg-muted">{featureLabel(entitlement.featureKey)}</span>
                  <span className={entitlement.enabled ? "text-fg" : "text-fg-dim"}>
                    {entitlement.limitValue !== null
                      ? String(entitlement.limitValue)
                      : entitlement.enabled
                        ? "Incluido"
                        : "No incluido"}
                  </span>
                </li>
              ))}
          </ul>
        </Card>

        {SUPPORT_EMAIL ? (
          <p className="text-sm text-fg-dim">
            ¿Dudas con tu plan o un cobro? Escríbenos a{" "}
            <a className="text-accent hover:text-accent-soft" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        ) : null}
      </div>
    </>
  );
}

function PaymentsHistory({ payments }: { payments: SubscriptionPayment[] }) {
  if (payments.length === 0) return null;
  return (
    <Card title="Pagos">
      <table className="w-full text-left text-sm">
        <thead className="font-mono text-xs uppercase tracking-wider text-fg-dim">
          <tr>
            <th className="py-2 font-normal">Fecha</th>
            <th className="py-2 font-normal">Plan</th>
            <th className="py-2 font-normal">Monto</th>
            <th className="py-2 font-normal">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {payments.map((payment) => {
            const status = PAYMENT_STATUS[payment.status] ?? {
              label: payment.status,
              tone: "neutral" as const,
            };
            return (
              <tr key={payment.id}>
                <td className="py-2 text-fg">{formatDate(payment.paidAt ?? payment.createdAt)}</td>
                <td className="py-2 text-fg-muted">{payment.planName ?? "—"}</td>
                <td className="py-2 text-fg">
                  {formatMoney(payment.amountCents, payment.currency)}
                </td>
                <td className="py-2">
                  <Badge tone={status.tone}>{status.label}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
