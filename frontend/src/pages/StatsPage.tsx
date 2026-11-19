import { useState } from "react";
import { Link } from "react-router-dom";
import { BarChart } from "../components/BarChart.tsx";
import { Alert, Card, PageHeader, Spinner, Stat } from "../components/ui.tsx";
import { billingApi } from "../lib/endpoints.ts";
import { errorMessage, isApiError } from "../lib/errors.ts";
import { formatMoney } from "../lib/money.ts";
import type { StoreStats } from "../lib/types.ts";
import { useLoad } from "../lib/useLoad.ts";
import { useWorkspace } from "../workspace/WorkspaceContext.tsx";

const RANGES = [
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
];

const SOURCE_LABELS: Record<string, string> = {
  "": "Directo o WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  google: "Google",
  whatsapp: "WhatsApp",
  tiktok: "TikTok",
  x: "X (Twitter)",
};

const METHOD_LABELS: Record<string, string> = {
  mercadopago: "Mercado Pago",
  transfer: "Transferencia",
};

function shortDay(day: string): string {
  const [, month, date] = day.split("-");
  return `${Number(date)}/${Number(month)}`;
}

function delta(current: number, previous: number): string | undefined {
  if (previous === 0) return current > 0 ? "Nuevo en este período" : undefined;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return "Igual que el período anterior";
  return `${change > 0 ? "+" : ""}${change}% vs. período anterior`;
}

function percent(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
}

function Upsell() {
  return (
    <>
      <PageHeader title="Estadísticas" subtitle="Cuánta gente visita tu tienda y cuánto vendes." />
      <Card title="Incluido en el plan Profesional">
        <ul className="space-y-1 text-sm text-fg-muted">
          <li>✓ Visitas a tu tienda y ventas por día</li>
          <li>✓ Ingresos, ticket promedio y conversión de visitas a ventas</li>
          <li>✓ Tus fotos y galerías más vendidas</li>
          <li>✓ Comparación con el período anterior</li>
        </ul>
        <Link
          to="/app/subscription"
          className="mt-5 inline-block rounded-ui bg-accent px-4 py-2 text-sm font-medium text-void hover:bg-accent-soft"
        >
          Pasar a Profesional
        </Link>
      </Card>
    </>
  );
}

export function StatsPage() {
  const { currentStore } = useWorkspace();
  const [days, setDays] = useState(30);
  const storeId = currentStore?.id;
  const { data, loading, error } = useLoad(
    () => (storeId ? billingApi.stats(storeId, days) : Promise.resolve(null)),
    [storeId, days],
  );

  if (isApiError(error, "STATS_NOT_IN_PLAN")) return <Upsell />;

  const stats: StoreStats | null = data?.stats ?? null;

  return (
    <>
      <PageHeader title="Estadísticas" subtitle="Cuánta gente visita tu tienda y cuánto vendes." />

      <fieldset className="mb-6 flex gap-2 border-0 p-0">
        <legend className="sr-only">Período</legend>
        {RANGES.map((range) => (
          <button
            key={range.days}
            type="button"
            onClick={() => setDays(range.days)}
            aria-pressed={days === range.days}
            className={`rounded-ui border px-3 py-1.5 text-sm ${
              days === range.days
                ? "border-accent text-fg"
                : "border-line text-fg-muted hover:border-accent"
            }`}
          >
            {range.label}
          </button>
        ))}
      </fieldset>

      {loading && !stats ? <Spinner /> : null}
      {error ? <Alert>{errorMessage(error)}</Alert> : null}

      {stats ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Visitantes"
              value={stats.totals.visitors.toLocaleString("es-AR")}
              hint={delta(stats.totals.visitors, stats.previous.visitors)}
            />
            <Stat
              label="Ventas"
              value={stats.totals.orders.toLocaleString("es-AR")}
              hint={delta(stats.totals.orders, stats.previous.orders)}
            />
            <Stat
              label="Ingresos"
              value={formatMoney(stats.totals.revenueCents, stats.currency)}
              hint={delta(stats.totals.revenueCents, stats.previous.revenueCents)}
            />
            <Stat
              label="Conversión"
              value={percent(stats.totals.conversionRate)}
              hint={
                stats.totals.orders
                  ? `Ticket promedio ${formatMoney(stats.totals.averageOrderCents, stats.currency)}`
                  : "Ventas sobre visitantes"
              }
            />
          </div>

          {stats.totals.visitors === 0 && stats.totals.orders === 0 ? (
            <Alert tone="info">
              Todavía no hay datos en este período. Comparte el link de tu tienda en Instagram o
              WhatsApp y las visitas van a aparecer acá.
            </Alert>
          ) : null}

          <Card title="Visitantes por día">
            <BarChart
              title="Visitantes por día"
              data={stats.series.map((point) => ({ label: point.day, value: point.visitors }))}
              formatValue={(value) => value.toLocaleString("es-AR")}
              formatLabel={shortDay}
            />
          </Card>

          <Card title="Ingresos por día">
            <BarChart
              title="Ingresos por día"
              data={stats.series.map((point) => ({ label: point.day, value: point.revenueCents }))}
              formatValue={(value) => formatMoney(value, stats.currency)}
              formatLabel={shortDay}
            />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Fotos más vendidas">
              {stats.topPhotos.length === 0 ? (
                <p className="text-sm text-fg-dim">Sin ventas de fotos sueltas en este período.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {stats.topPhotos.map((photo) => (
                    <li key={photo.id} className="flex items-center gap-3 py-2 text-sm">
                      {photo.thumbUrl ? (
                        <img
                          src={photo.thumbUrl}
                          alt={photo.title || "Foto"}
                          className="size-12 rounded-ui object-cover"
                          loading="lazy"
                        />
                      ) : null}
                      <span className="flex-1 truncate text-fg">{photo.title || "Sin título"}</span>
                      <span className="text-fg-muted">
                        {photo.sales} {photo.sales === 1 ? "venta" : "ventas"}
                      </span>
                      <span className="w-24 text-right text-fg">
                        {formatMoney(photo.revenueCents, stats.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Galerías que más venden">
              {stats.topAlbums.length === 0 ? (
                <p className="text-sm text-fg-dim">Sin ventas en este período.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {stats.topAlbums.map((album) => (
                    <li key={album.id} className="flex items-center gap-3 py-2 text-sm">
                      <span className="flex-1 truncate text-fg">{album.title}</span>
                      <span className="text-fg-muted">
                        {album.sales} {album.sales === 1 ? "venta" : "ventas"}
                      </span>
                      <span className="w-24 text-right text-fg">
                        {formatMoney(album.revenueCents, stats.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {stats.paymentMethods.length > 0 ? (
                <p className="mt-4 text-xs text-fg-dim">
                  Medios de pago:{" "}
                  {stats.paymentMethods
                    .map((item) => `${METHOD_LABELS[item.method] ?? item.method} ${item.orders}`)
                    .join(" · ")}
                </p>
              ) : null}
            </Card>
          </div>

          {stats.sources.length > 0 ? (
            <Card title="De dónde vienen tus visitas">
              <ul className="space-y-2">
                {stats.sources.map((item) => {
                  const share = stats.totals.visitors
                    ? Math.round((item.visitors / stats.totals.visitors) * 100)
                    : 0;
                  return (
                    <li
                      key={item.source || "direct"}
                      className="grid grid-cols-[10rem_1fr_4rem] items-center gap-3 text-sm"
                    >
                      <span className="truncate text-fg-muted">
                        {SOURCE_LABELS[item.source] ?? item.source}
                      </span>
                      <span className="h-2.5 rounded-sm bg-raised">
                        <span
                          className="block h-2.5 rounded-sm bg-accent"
                          style={{ width: `${Math.max(2, share)}%` }}
                        />
                      </span>
                      <span className="text-right text-fg">
                        {item.visitors}
                        <span className="ml-1 text-xs text-fg-dim">{share}%</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-fg-dim">
                Los links abiertos desde WhatsApp o escritos a mano aparecen como "Directo".
              </p>
            </Card>
          ) : null}

          <p className="text-xs text-fg-dim">
            Las visitas se cuentan sin cookies y sin guardar datos personales: cada visitante se
            cuenta una vez por día. No se cuentan robots ni vistas previas de links.
          </p>
        </div>
      ) : null}
    </>
  );
}
