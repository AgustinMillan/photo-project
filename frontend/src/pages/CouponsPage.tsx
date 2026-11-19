import { type FormEvent, useState } from "react";
import { QrDownload } from "../components/QrDownload.tsx";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  PageHeader,
  SelectField,
  Spinner,
} from "../components/ui.tsx";
import { couponsApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import { storeUrl } from "../lib/format.ts";
import type { Coupon, CouponScope } from "../lib/types.ts";
import { useLoad } from "../lib/useLoad.ts";
import { useWorkspace } from "../workspace/WorkspaceContext.tsx";

export const SCOPE_LABEL: Record<CouponScope, string> = {
  all: "Todo",
  photos: "Fotos sueltas",
  albums: "Galerías completas",
};

const STATUS: Record<
  Coupon["status"],
  { label: string; tone: "ok" | "neutral" | "warn" | "danger" }
> = {
  active: { label: "Activo", tone: "ok" },
  paused: { label: "Pausado", tone: "neutral" },
  expired: { label: "Vencido", tone: "warn" },
  exhausted: { label: "Agotado", tone: "warn" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Store coupons: "VERANO2027, 10% off photos, 50 uses". */
export function CouponsPage() {
  const { currentStore } = useWorkspace();
  const storeId = currentStore?.id ?? "";
  const coupons = useLoad(() => couponsApi.list(storeId), [storeId]);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const [code, setCode] = useState("");
  const [percent, setPercent] = useState("10");
  const [scope, setScope] = useState<CouponScope>("all");
  const [maxUses, setMaxUses] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [showInStore, setShowInStore] = useState(true);
  const [saving, setSaving] = useState(false);

  if (!currentStore) return <Spinner />;
  const list = coupons.data?.coupons ?? [];
  const base = storeUrl(currentStore.primaryHostname, window.location);

  async function create(event: FormEvent) {
    event.preventDefault();
    const percentOff = Number(percent);
    const uses = maxUses.trim() ? Number(maxUses) : null;
    if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 90) {
      setMessage({ tone: "error", text: "El descuento tiene que ser entre 1% y 90%." });
      return;
    }
    if (uses !== null && (!Number.isInteger(uses) || uses < 1)) {
      setMessage({ tone: "error", text: "El límite de usos tiene que ser un número entero." });
      return;
    }
    setSaving(true);
    try {
      await couponsApi.create(storeId, {
        code: code.trim().toUpperCase(),
        percentOff,
        appliesTo: scope,
        maxUses: uses,
        // Valid through the whole chosen day (Argentina time).
        endsAt: endsOn ? new Date(`${endsOn}T23:59:59-03:00`).toISOString() : null,
        showInStore,
      });
      setMessage({ tone: "ok", text: `Cupón ${code.trim().toUpperCase()} creado.` });
      setCode("");
      setMaxUses("");
      setEndsOn("");
      coupons.reload();
    } catch (caught) {
      setMessage({ tone: "error", text: errorMessage(caught) });
    } finally {
      setSaving(false);
    }
  }

  async function update(coupon: Coupon, body: Parameters<typeof couponsApi.update>[2]) {
    try {
      await couponsApi.update(storeId, coupon.id, body);
      coupons.reload();
    } catch (caught) {
      setMessage({ tone: "error", text: errorMessage(caught) });
    }
  }

  async function remove(coupon: Coupon) {
    if (!confirm(`¿Eliminar el cupón ${coupon.code}?`)) return;
    try {
      const result = await couponsApi.remove(storeId, coupon.id);
      setMessage({
        tone: "ok",
        text: result.paused
          ? `${coupon.code} ya se usó en pedidos, así que lo pausamos en vez de borrarlo.`
          : `Cupón ${coupon.code} eliminado.`,
      });
      coupons.reload();
    } catch (caught) {
      setMessage({ tone: "error", text: errorMessage(caught) });
    }
  }

  return (
    <>
      <PageHeader
        title="Cupones"
        subtitle="Códigos de descuento para tus clientes. El QR de cada cupón abre tu tienda con el código ya cargado."
      />
      {message ? (
        <div className="mb-4">
          <Alert tone={message.tone === "ok" ? "ok" : "error"}>{message.text}</Alert>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
        <Card title="Nuevo cupón">
          <form onSubmit={create} className="space-y-4">
            <Field
              label="Código"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))
              }
              placeholder="VERANO2027"
              minLength={3}
              maxLength={30}
              required
            />
            <Field
              label="Descuento (%)"
              type="number"
              min={1}
              max={90}
              value={percent}
              onChange={(event) => setPercent(event.target.value)}
              required
            />
            <SelectField
              label="Aplica a"
              value={scope}
              onChange={(event) => setScope(event.target.value as CouponScope)}
            >
              <option value="all">Todo</option>
              <option value="photos">Solo fotos sueltas</option>
              <option value="albums">Solo galerías completas</option>
            </SelectField>
            <Field
              label="Límite de usos"
              type="number"
              min={1}
              value={maxUses}
              onChange={(event) => setMaxUses(event.target.value)}
              placeholder="Sin límite"
              hint="Cuántos pedidos pueden usarlo en total."
            />
            <Field
              label="Vence el"
              type="date"
              value={endsOn}
              onChange={(event) => setEndsOn(event.target.value)}
              hint="Opcional. Vale hasta el final de ese día."
            />
            <label className="flex items-center gap-2 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={showInStore}
                onChange={(event) => setShowInStore(event.target.checked)}
              />
              Anunciarlo en mi tienda
            </label>
            <Button type="submit" loading={saving} className="w-full">
              Crear cupón
            </Button>
          </form>
        </Card>

        <Card title="Tus cupones">
          {coupons.loading && !coupons.data ? <Spinner /> : null}
          {coupons.error ? <Alert>{errorMessage(coupons.error)}</Alert> : null}
          {coupons.data && list.length === 0 ? (
            <p className="text-sm text-fg-dim">
              Todavía no creaste cupones. Probá con uno para tus clientes de siempre.
            </p>
          ) : null}
          <ul className="divide-y divide-line">
            {list.map((coupon) => (
              <li key={coupon.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-48 flex-1">
                  <p className="font-mono text-fg">
                    {coupon.code} <span className="text-accent">−{coupon.percentOff}%</span>
                  </p>
                  <p className="text-xs text-fg-dim">
                    {SCOPE_LABEL[coupon.appliesTo]} · {coupon.uses}
                    {coupon.maxUses ? ` / ${coupon.maxUses}` : ""} usos
                    {coupon.endsAt ? ` · vence ${formatDate(coupon.endsAt)}` : ""}
                    {coupon.showInStore ? " · visible en la tienda" : ""}
                  </p>
                </div>
                <Badge tone={STATUS[coupon.status].tone}>{STATUS[coupon.status].label}</Badge>
                <div className="flex flex-wrap gap-2">
                  {base ? (
                    <QrDownload
                      url={`${base}/?cupon=${coupon.code}`}
                      filename={`qr-cupon-${coupon.code}`}
                    />
                  ) : null}
                  <Button
                    variant="ghost"
                    onClick={() => update(coupon, { active: !coupon.active })}
                  >
                    {coupon.active ? "Pausar" : "Activar"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => update(coupon, { showInStore: !coupon.showInStore })}
                  >
                    {coupon.showInStore ? "Ocultar" : "Anunciar"}
                  </Button>
                  <Button variant="danger" onClick={() => remove(coupon)}>
                    Eliminar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
