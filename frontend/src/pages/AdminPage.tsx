import { type FormEvent, Fragment, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";
import { BarChart } from "../components/BarChart.tsx";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  SelectField,
  Spinner,
  Stat,
} from "../components/ui.tsx";
import { adminApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import { formatDate } from "../lib/format.ts";
import { formatMoney } from "../lib/money.ts";
import type { AdminAccount, AdminAction, AdminOverview, AttributionRow } from "../lib/types.ts";
import { useLoad } from "../lib/useLoad.ts";

const STATUS: Record<
  AdminAccount["status"],
  { label: string; tone: "ok" | "warn" | "danger" | "neutral" }
> = {
  pilot: { label: "Piloto", tone: "ok" },
  active: { label: "Activo (pago)", tone: "ok" },
  trial: { label: "Prueba", tone: "warn" },
  expired: { label: "Vencido", tone: "danger" },
  cancelled: { label: "Cancelado", tone: "neutral" },
  suspended: { label: "Suspendido", tone: "danger" },
  none: { label: "Sin tienda", tone: "neutral" },
};

const ORDER_STATUS: Record<string, string> = {
  pending_payment: "Esperando pago",
  paid: "Pagado",
  cancelled: "Cancelado",
};

function bytes(value: number): string {
  if (value < 1024 ** 2) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function shortDay(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

function compactMoney(cents: number): string {
  const pesos = cents / 100;
  if (pesos >= 1_000_000) return `$${(pesos / 1_000_000).toFixed(1)}M`;
  if (pesos >= 10_000) return `$${Math.round(pesos / 1000)}K`;
  return formatMoney(cents);
}

function daysLeft(value: string | null): number | null {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}

function AccountActions({
  account,
  onDone,
}: {
  account: AdminAccount;
  onDone: (message: string) => void;
}) {
  const [kind, setKind] = useState<AdminAction["action"]>(
    account.status === "pilot" ? "pilot_end" : "activate",
  );
  const [plan, setPlan] = useState<"base" | "intermediate" | "business">("base");
  const [months, setMonths] = useState("1");
  const [days, setDays] = useState("7");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const email = account.ownerEmail;
    const body: AdminAction =
      kind === "activate"
        ? { action: kind, email, planCode: plan, months: Number(months), note }
        : kind === "extend"
          ? { action: kind, email, days: Number(days), note }
          : kind === "pilot_end"
            ? { action: kind, email, trialDays: Number(days), note }
            : kind === "pilot_start"
              ? { action: kind, email, note }
              : { action: kind, email };
    const confirmText: Record<AdminAction["action"], string> = {
      activate: `¿Registrar pago y activar el plan ${plan} por ${months} mes(es) para ${email}?`,
      extend: `¿Sumar ${days} días gratis a ${email}?`,
      pilot_start: `¿Pasar a ${email} a piloto (todo gratis, sin vencimiento)?`,
      pilot_end: `¿Terminar el piloto de ${email}? Pasa a una prueba de ${days} días del plan base.`,
      verify_email: `¿Marcar como verificado el email de ${email}?`,
    };
    if (!window.confirm(confirmText[kind])) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.action(body);
      onDone(`Listo: ${email}`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid gap-3 rounded-ui border border-line bg-raised p-3 sm:grid-cols-4 sm:items-end"
    >
      <SelectField
        label="Acción"
        value={kind}
        onChange={(e) => setKind(e.target.value as AdminAction["action"])}
      >
        <option value="activate">Registrar pago / activar plan</option>
        <option value="extend">Sumar días gratis</option>
        {account.status === "pilot" ? (
          <option value="pilot_end">Terminar piloto</option>
        ) : (
          <option value="pilot_start">Iniciar piloto</option>
        )}
        {!account.verified ? <option value="verify_email">Verificar email</option> : null}
      </SelectField>
      {kind === "activate" ? (
        <>
          <SelectField
            label="Plan"
            value={plan}
            onChange={(e) => setPlan(e.target.value as typeof plan)}
          >
            <option value="base">Base</option>
            <option value="intermediate">Intermedio</option>
            <option value="business">Business</option>
          </SelectField>
          <Field
            label="Meses"
            type="number"
            min={1}
            max={24}
            value={months}
            onChange={(e) => setMonths(e.target.value)}
          />
        </>
      ) : null}
      {kind === "extend" || kind === "pilot_end" ? (
        <Field
          label={kind === "extend" ? "Días" : "Días de prueba"}
          type="number"
          min={kind === "extend" ? 1 : 0}
          max={365}
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
      ) : null}
      {kind !== "verify_email" ? (
        <Field
          label="Nota"
          placeholder="Ej.: transferencia 18/11"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      ) : null}
      <Button type="submit" loading={busy}>
        Aplicar
      </Button>
      {error ? (
        <div className="sm:col-span-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}
    </form>
  );
}

export function AdminPage() {
  const { user, logout } = useAuth();
  const me = useLoad(() => adminApi.me(), []);
  const [days, setDays] = useState(30);
  const overview = useLoad(() => adminApi.overview(days), [days]);
  const accounts = useLoad(() => adminApi.accounts(), []);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | AdminAccount["status"]>("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (accounts.data?.accounts ?? []).filter(
      (account) =>
        (!statusFilter || account.status === statusFilter) &&
        (!needle ||
          account.ownerEmail.toLowerCase().includes(needle) ||
          account.name.toLowerCase().includes(needle) ||
          (account.storeSlug ?? "").includes(needle)),
    );
  }, [accounts.data, query, statusFilter]);

  if (me.loading) return <Spinner />;
  if (!me.data?.admin) return <Navigate to="/app" replace />;

  const t = overview.data?.totals;
  const series = overview.data?.series ?? [];

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
            Galeriza · Admin
          </p>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-fg-dim">{user?.email}</span>
            <Link to="/app" className="text-fg-muted hover:text-fg">
              Mi panel
            </Link>
            <Button variant="ghost" onClick={() => void logout()}>
              Salir
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-5 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl">Plataforma</h1>
            <p className="text-sm text-fg-dim">Datos en vivo de todas las cuentas.</p>
          </div>
          <fieldset className="flex gap-1">
            <legend className="sr-only">Período</legend>
            {[14, 30, 90].map((value) => (
              <Button
                key={value}
                variant={days === value ? "primary" : "ghost"}
                onClick={() => setDays(value)}
              >
                {value} días
              </Button>
            ))}
          </fieldset>
        </div>

        {overview.error ? <Alert>{errorMessage(overview.error)}</Alert> : null}
        {!t ? (
          <Spinner />
        ) : (
          <>
            {overview.data ? (
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Stat
                  label="Ingreso mensual recurrente"
                  value={formatMoney(overview.data.revenue.mrrCents)}
                  hint="Abonos con pago automático activo"
                />
                <Stat
                  label={`Cobrado en abonos (${days} d)`}
                  value={formatMoney(overview.data.revenue.collectedPeriodCents)}
                  hint={`${overview.data.revenue.failedPaymentsPeriod} cobros rechazados`}
                />
                <Stat
                  label="Cuentas pagando"
                  value={overview.data.revenue.payingAccounts}
                  hint={`${overview.data.revenue.trialsWithAutoPay} en prueba con pago automático`}
                />
                <Stat
                  label={`Visitantes de la página (${days} d)`}
                  value={overview.data.funnel.landingVisitors}
                  hint="Únicos por día, sin cookies"
                />
              </section>
            ) : null}

            {overview.data ? <Funnel funnel={overview.data.funnel} days={days} /> : null}

            <AttributionTable days={days} />
            <AdLinkBuilder />

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label={`Ventas cobradas (${days} d)`}
                value={formatMoney(t.gmvPeriodCents)}
                hint={`Histórico: ${formatMoney(t.gmvCents)}`}
              />
              <Stat
                label="Pedidos"
                value={t.paidOrders}
                hint={`${t.pendingOrders} esperando pago · ${t.paidViaMercadoPago} por Mercado Pago`}
              />
              <Stat
                label="Comisiones de la plataforma"
                value={formatMoney(t.platformFeesCents)}
                hint="Comisión configurada hoy: 0%"
              />
              <Stat
                label="Vencen en 7 días"
                value={t.expiringIn7Days}
                hint="Pruebas o planes pagos"
              />
              <Stat
                label="Cuentas"
                value={t.accounts}
                hint={`${t.users} usuarios · ${t.signupsPeriod} nuevos en ${days} d`}
              />
              <Stat
                label="Tiendas publicadas"
                value={`${t.publishedStores} / ${t.stores}`}
                hint={`${t.mercadoPagoConnected} con Mercado Pago`}
              />
              <Stat
                label="Fotos"
                value={t.photos}
                hint={`${bytes(t.storageBytes)} en originales`}
              />
              <Stat label="Descargas" value={t.downloads} hint="Descargas de fotos compradas" />
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <Card>
                <BarChart
                  title="Ventas cobradas por día"
                  data={series.map((d) => ({ label: d.date, value: d.gmvCents }))}
                  formatValue={compactMoney}
                  formatLabel={shortDay}
                />
              </Card>
              <Card>
                <BarChart
                  title="Pedidos creados por día"
                  data={series.map((d) => ({ label: d.date, value: d.orders }))}
                  formatValue={(v) => String(Math.round(v))}
                  formatLabel={shortDay}
                />
              </Card>
              <Card>
                <BarChart
                  title="Visitantes de la página de inicio por día"
                  data={series.map((d) => ({ label: d.date, value: d.landingVisitors }))}
                  formatValue={(v) => String(Math.round(v))}
                  formatLabel={shortDay}
                />
              </Card>
              <Card>
                <BarChart
                  title="Registros por día"
                  data={series.map((d) => ({ label: d.date, value: d.signups }))}
                  formatValue={(v) => String(Math.round(v))}
                  formatLabel={shortDay}
                />
              </Card>
              <Card title="Suscripciones">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left font-mono text-xs uppercase tracking-wider text-fg-dim">
                      <th className="py-1 font-normal">Estado</th>
                      <th className="py-1 font-normal">Plan</th>
                      <th className="py-1 text-right font-normal">Cuentas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.data?.subscriptions.map((row) => (
                      <tr key={`${row.status}-${row.plan}`} className="border-t border-line">
                        <td className="py-2">
                          <Badge
                            tone={STATUS[row.status as AdminAccount["status"]]?.tone ?? "neutral"}
                          >
                            {STATUS[row.status as AdminAccount["status"]]?.label ?? row.status}
                          </Badge>
                        </td>
                        <td className="py-2 text-fg-muted">{row.plan}</td>
                        <td className="py-2 text-right text-fg">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </section>
          </>
        )}

        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-display text-2xl">Clientes</h2>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="Buscar"
                placeholder="Buscar email, nombre o tienda"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-64 border-0 border-b border-line bg-raised px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
              <select
                aria-label="Estado"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="border-0 border-b border-line bg-raised px-3 py-2 text-sm focus:border-accent focus:outline-none"
              >
                <option value="">Todos los estados</option>
                {Object.entries(STATUS).map(([value, item]) => (
                  <option key={value} value={value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {message ? (
            <div className="mb-3">
              <Alert tone="ok">{message}</Alert>
            </div>
          ) : null}
          {accounts.loading && !accounts.data ? <Spinner /> : null}
          {accounts.error ? <Alert>{errorMessage(accounts.error)}</Alert> : null}
          <div className="overflow-x-auto rounded-ui border border-line">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-surface">
                <tr className="text-left font-mono text-xs uppercase tracking-wider text-fg-dim">
                  <th className="px-3 py-2 font-normal">Cuenta</th>
                  <th className="px-3 py-2 font-normal">Tienda</th>
                  <th className="px-3 py-2 font-normal">Estado</th>
                  <th className="px-3 py-2 font-normal">Vence</th>
                  <th className="px-3 py-2 text-right font-normal">Fotos</th>
                  <th className="px-3 py-2 text-right font-normal">Ventas</th>
                  <th className="px-3 py-2 font-normal">Último acceso</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((account) => {
                  const due =
                    account.status === "trial" ? account.trialEndsAt : account.currentPeriodEnd;
                  const left = account.status === "pilot" ? null : daysLeft(due);
                  return (
                    <Fragment key={account.id}>
                      <tr className="border-t border-line align-top">
                        <td className="px-3 py-2">
                          <p className="text-fg">{account.name}</p>
                          <p className="text-xs text-fg-dim">
                            {account.ownerEmail}
                            {!account.verified ? " · sin verificar" : ""}
                          </p>
                        </td>
                        <td className="px-3 py-2">
                          {account.storeSlug ? (
                            <>
                              <a
                                className="text-accent-soft hover:underline"
                                href={`https://${account.storeSlug}.${import.meta.env.VITE_PLATFORM_DOMAIN || "localhost"}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {account.storeSlug}
                              </a>
                              <p className="text-xs text-fg-dim">
                                {account.publicationStatus === "published"
                                  ? "Publicada"
                                  : "No publicada"}
                                {account.mercadoPago ? " · MP" : ""}
                              </p>
                            </>
                          ) : (
                            <span className="text-fg-dim">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={STATUS[account.status].tone}>
                            {STATUS[account.status].label}
                          </Badge>
                          {account.plan ? (
                            <p className="mt-1 text-xs text-fg-dim">{account.plan}</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          {account.status === "pilot" ? (
                            <span className="text-fg-dim">Nunca</span>
                          ) : due ? (
                            <>
                              <p
                                className={
                                  left !== null && left <= 7 ? "text-danger" : "text-fg-muted"
                                }
                              >
                                {formatDate(due)}
                              </p>
                              {left !== null ? (
                                <p className="text-xs text-fg-dim">
                                  {left > 0 ? `en ${left} d` : `hace ${-left} d`}
                                </p>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-fg-dim">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">{account.photos}</td>
                        <td className="px-3 py-2 text-right">
                          <p>{formatMoney(account.gmvCents)}</p>
                          <p className="text-xs text-fg-dim">{account.paidOrders} pedidos</p>
                        </td>
                        <td className="px-3 py-2 text-fg-muted">
                          {account.lastLoginAt ? formatDate(account.lastLoginAt) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            onClick={() => setOpenId(openId === account.id ? null : account.id)}
                          >
                            {openId === account.id ? "Cerrar" : "Gestionar"}
                          </Button>
                        </td>
                      </tr>
                      {openId === account.id ? (
                        <tr>
                          <td colSpan={8} className="px-3 pb-3">
                            <AccountActions
                              account={account}
                              onDone={(text) => {
                                setMessage(text);
                                setOpenId(null);
                                accounts.reload();
                                overview.reload();
                              }}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
                {accounts.data && filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-fg-dim">
                      No hay cuentas con ese filtro.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-3 font-display text-2xl">Últimos pedidos</h2>
          <Card>
            {overview.data && overview.data.recentOrders.length === 0 ? (
              <p className="text-sm text-fg-dim">Todavía no hay pedidos.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {overview.data?.recentOrders.map((order) => (
                  <li
                    key={order.code}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span>
                      <span className="font-mono">{order.code}</span> · {order.storeSlug}
                      <span className="text-fg-dim">
                        {" "}
                        · {formatDate(order.createdAt)} ·{" "}
                        {order.checkoutMethod === "mercadopago" ? "Mercado Pago" : "Transferencia"}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span>{formatMoney(order.totalCents)}</span>
                      <Badge
                        tone={
                          order.status === "paid"
                            ? "ok"
                            : order.status === "cancelled"
                              ? "neutral"
                              : "warn"
                        }
                      >
                        {ORDER_STATUS[order.status] ?? order.status}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </main>
    </div>
  );
}

const FUNNEL_STEPS: Array<{ key: keyof AdminOverview["funnel"]; label: string }> = [
  { key: "landingVisitors", label: "Visitaron la página de inicio" },
  { key: "signups", label: "Se registraron" },
  { key: "withStore", label: "Crearon su tienda" },
  { key: "withPhotos", label: "Subieron fotos" },
  { key: "published", label: "Publicaron la tienda" },
  { key: "withSale", label: "Hicieron su primera venta" },
  { key: "withAutoPay", label: "Activaron el pago automático" },
];

function Funnel({ funnel, days }: { funnel: AdminOverview["funnel"]; days: number }) {
  const max = Math.max(1, ...FUNNEL_STEPS.map((step) => funnel[step.key]));
  return (
    <Card title={`Embudo de los últimos ${days} días`}>
      <p className="mb-4 text-xs text-fg-dim">
        Desde la visita hasta el pago. Los pasos después del registro cuentan solo cuentas creadas
        en el período.
      </p>
      <ol className="space-y-2">
        {FUNNEL_STEPS.map((step, index) => {
          const value = funnel[step.key];
          const previous = index > 0 ? funnel[FUNNEL_STEPS[index - 1]?.key ?? step.key] : null;
          const rate =
            previous !== null && previous > 0 ? `${Math.round((value / previous) * 100)}%` : null;
          return (
            <li
              key={step.key}
              className="grid grid-cols-[12rem_1fr_5rem] items-center gap-3 text-sm"
            >
              <span className="text-fg-muted">{step.label}</span>
              <span className="h-3 rounded-sm bg-raised">
                <span
                  className="block h-3 rounded-sm bg-accent"
                  style={{ width: `${Math.max(value > 0 ? 2 : 0, (value / max) * 100)}%` }}
                />
              </span>
              <span className="text-right text-fg">
                {value}
                {rate ? <span className="ml-1 text-xs text-fg-dim">{rate}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

const SOURCE_NAMES: Record<string, string> = {
  "": "Directo / sin dato",
  instagram: "Instagram",
  facebook: "Facebook",
  google: "Google",
  whatsapp: "WhatsApp",
};

function AttributionTable({ days }: { days: number }) {
  const { data, error, loading } = useLoad(() => adminApi.attribution(days), [days]);
  const rows: AttributionRow[] = data?.rows ?? [];
  return (
    <Card title={`De dónde vienen (últimos ${days} días)`}>
      {loading && !data ? <Spinner /> : null}
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      {data && rows.length === 0 ? (
        <p className="text-sm text-fg-dim">Todavía no hay visitas ni registros en este período.</p>
      ) : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead className="font-mono text-xs uppercase tracking-wider text-fg-dim">
              <tr>
                <th className="py-2 font-normal">Origen</th>
                <th className="py-2 font-normal">Campaña / anuncio</th>
                <th className="py-2 text-right font-normal">Visitantes</th>
                <th className="py-2 text-right font-normal">Registros</th>
                <th className="py-2 text-right font-normal">Tienda</th>
                <th className="py-2 text-right font-normal">Publicada</th>
                <th className="py-2 text-right font-normal">Venta</th>
                <th className="py-2 text-right font-normal">Pago aut.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={`${row.source}|${row.campaign}|${row.content}`}>
                  <td className="py-2 text-fg">{SOURCE_NAMES[row.source] ?? row.source}</td>
                  <td className="py-2 text-fg-muted">
                    {[row.campaign, row.content].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="py-2 text-right text-fg">{row.visitors}</td>
                  <td className="py-2 text-right text-fg">
                    {row.signups}
                    {row.visitors > 0 && row.signups > 0 ? (
                      <span className="ml-1 text-xs text-fg-dim">
                        {Math.round((row.signups / row.visitors) * 100)}%
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 text-right text-fg">{row.withStore}</td>
                  <td className="py-2 text-right text-fg">{row.published}</td>
                  <td className="py-2 text-right text-fg">{row.withSale}</td>
                  <td className="py-2 text-right text-fg">{row.withAutoPay}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

function slugPart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Builds the link to use in an ad so its visits and sign-ups are identified. */
function AdLinkBuilder() {
  const [source, setSource] = useState("instagram");
  const [campaign, setCampaign] = useState("prueba-1");
  const [content, setContent] = useState("");
  const [copied, setCopied] = useState(false);
  const url = new URL(window.location.origin);
  url.searchParams.set("utm_source", slugPart(source) || "instagram");
  url.searchParams.set("utm_medium", "paid");
  if (slugPart(campaign)) url.searchParams.set("utm_campaign", slugPart(campaign));
  if (slugPart(content)) url.searchParams.set("utm_content", slugPart(content));
  const link = url.toString();

  return (
    <Card title="Link para un anuncio">
      <p className="mb-4 text-sm text-fg-dim">
        Usa un link distinto por cada anuncio (cambia el “anuncio”), así ves en la tabla de arriba
        cuál trae fotógrafos que realmente publican su tienda.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Red" value={source} onChange={(event) => setSource(event.target.value)} />
        <Field
          label="Campaña"
          value={campaign}
          onChange={(event) => setCampaign(event.target.value)}
        />
        <Field
          label="Anuncio"
          value={content}
          placeholder="ej: sin-wetransfer"
          onChange={(event) => setContent(event.target.value)}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <code className="break-all rounded-ui bg-raised px-3 py-2 text-xs text-fg">{link}</code>
        <Button
          variant="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
    </Card>
  );
}
