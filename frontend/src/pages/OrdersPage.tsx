import { type FormEvent, useState } from "react";
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
import { ordersApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import { formatDate } from "../lib/format.ts";
import { centsToInput, formatMoney, parsePesos } from "../lib/money.ts";
import type { OrderStatus, PaymentMethod } from "../lib/types.ts";
import { useLoad } from "../lib/useLoad.ts";
import { useWorkspace } from "../workspace/WorkspaceContext.tsx";

const STATUS: Record<OrderStatus, { label: string; tone: "ok" | "warn" | "neutral" }> = {
  pending_payment: { label: "Esperando pago", tone: "warn" },
  paid: { label: "Pagado", tone: "ok" },
  cancelled: { label: "Cancelado", tone: "neutral" },
};

const METHODS: Record<PaymentMethod, string> = {
  transfer: "Transferencia",
  cash: "Efectivo",
  other: "Otro",
  mercadopago: "Mercado Pago",
};

const MANUAL_METHODS = ["transfer", "cash", "other"] as const;

function OrderDetailPanel({
  storeId,
  orderId,
  onChanged,
}: {
  storeId: string;
  orderId: string;
  onChanged: () => void;
}) {
  const detail = useLoad(() => ordersApi.get(storeId, orderId), [storeId, orderId]);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("transfer");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(
    null,
  );

  if (detail.loading) return <Spinner />;
  if (detail.error || !detail.data) return <Alert>{errorMessage(detail.error)}</Alert>;
  const { order, items, payments, paidCents, downloadCount } = detail.data;
  const remaining = Math.max(order.totalCents - paidCents, 0);

  async function record(event: FormEvent) {
    event.preventDefault();
    const cents = parsePesos(amount || centsToInput(remaining));
    if (!cents || Number.isNaN(cents)) {
      setMessage({ tone: "error", text: "Ingresá un monto válido." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await ordersApi.recordPayment(storeId, orderId, {
        amountCents: cents,
        method,
        reference,
      });
      setMessage(
        result.status === "paid"
          ? { tone: "ok", text: "Pago confirmado. Le enviamos al cliente el enlace de descarga." }
          : { tone: "info", text: `Pago registrado. Falta ${formatMoney(result.remainingCents)}.` },
      );
      setAmount("");
      setReference("");
      detail.reload();
      onChanged();
    } catch (caught) {
      setMessage({ tone: "error", text: errorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm("¿Cancelar este pedido? El cliente no va a poder pagarlo.")) return;
    try {
      await ordersApi.cancel(storeId, orderId);
      detail.reload();
      onChanged();
    } catch (caught) {
      setMessage({ tone: "error", text: errorMessage(caught) });
    }
  }

  async function copyLink() {
    try {
      const { link } = await ordersApi.link(storeId, orderId);
      await navigator.clipboard.writeText(link);
      setMessage({ tone: "ok", text: "Enlace del cliente copiado." });
    } catch (caught) {
      setMessage({ tone: "error", text: errorMessage(caught) });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-2xl">{order.code}</h2>
        <Badge tone={STATUS[order.status].tone}>{STATUS[order.status].label}</Badge>
      </div>
      <p className="text-sm text-fg-muted">
        {order.customerName} ·{" "}
        <a className="text-accent-soft" href={`mailto:${order.customerEmail}`}>
          {order.customerEmail}
        </a>
        <br />
        <span className="text-fg-dim">
          Creado {formatDate(order.createdAt)}
          {order.paidAt ? ` · Pagado ${formatDate(order.paidAt)}` : ""}
        </span>
      </p>

      <ul className="divide-y divide-line rounded-ui border border-line">
        {items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3 px-3 py-2 text-sm">
            <span>
              {item.kind === "album" ? "Galería: " : ""}
              {item.title}
              {item.kind === "album" ? (
                <span className="text-fg-dim"> ({item.photoCount} fotos)</span>
              ) : null}
            </span>
            <span>{formatMoney(item.priceCents)}</span>
          </li>
        ))}
        {order.discountCents ? (
          <li className="flex justify-between px-3 py-2 text-sm text-ok">
            <span>Cupón {order.couponCode}</span>
            <span>−{formatMoney(order.discountCents)}</span>
          </li>
        ) : null}
        <li className="flex justify-between px-3 py-2 text-sm font-medium">
          <span>Total</span>
          <span>{formatMoney(order.totalCents)}</span>
        </li>
      </ul>

      {payments.length ? (
        <div>
          <p className="mb-1 font-mono text-xs uppercase tracking-wider text-fg-dim">
            Pagos registrados
          </p>
          <ul className="space-y-1 text-sm">
            {payments.map((payment) => (
              <li key={payment.id} className="flex justify-between gap-3">
                <span>
                  {METHODS[payment.method]}
                  {payment.reference ? (
                    <span className="text-fg-dim"> · {payment.reference}</span>
                  ) : null}
                  <span className="text-fg-dim"> · {formatDate(payment.createdAt)}</span>
                </span>
                <span>{formatMoney(payment.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {order.status === "paid" ? (
        <p className="text-sm text-fg-dim">Descargas realizadas: {downloadCount}</p>
      ) : null}

      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

      {order.status === "pending_payment" ? (
        <form
          onSubmit={(event) => void record(event)}
          className="space-y-3 rounded-ui border border-line p-4"
        >
          {order.checkoutMethod === "mercadopago" ? (
            <p className="text-sm text-fg-dim">
              El cliente eligió Mercado Pago: el pedido se confirma solo cuando se aprueba el pago.
              Usá esto solo si te pagó por otro medio.
            </p>
          ) : null}
          <p className="text-sm text-fg-muted">
            Cuando recibas el dinero, registralo acá. Las descargas se habilitan cuando lo pagado
            cubre el total ({formatMoney(remaining)} pendiente).
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="Monto"
              inputMode="decimal"
              placeholder={centsToInput(remaining)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <SelectField
              label="Medio"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            >
              {MANUAL_METHODS.map((value) => (
                <option key={value} value={value}>
                  {METHODS[value]}
                </option>
              ))}
            </SelectField>
            <Field
              label="Referencia"
              placeholder="N° de operación"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy}>
              Registrar pago
            </Button>
            <Button variant="danger" onClick={() => void cancel()}>
              Cancelar pedido
            </Button>
          </div>
        </form>
      ) : null}

      <Button variant="ghost" onClick={() => void copyLink()}>
        Copiar enlace del cliente
      </Button>
    </div>
  );
}

export function OrdersPage() {
  const { currentStore } = useWorkspace();
  const storeId = currentStore?.id ?? "";
  const [filter, setFilter] = useState<OrderStatus | "">("pending_payment");
  const orders = useLoad(() => ordersApi.list(storeId, filter || undefined), [storeId, filter]);
  const [selected, setSelected] = useState<string | null>(null);

  if (!currentStore) return <Spinner />;
  if (currentStore.role !== "OWNER" && currentStore.role !== "ADMIN") {
    return (
      <Alert tone="info">Solo el propietario o un administrador pueden ver los pedidos.</Alert>
    );
  }

  return (
    <>
      <PageHeader title="Pedidos" subtitle="Confirmá los pagos para habilitar las descargas." />
      <div className="mb-4 flex flex-wrap gap-2">
        {(["pending_payment", "paid", "cancelled", ""] as const).map((value) => (
          <Button
            key={value || "all"}
            variant={filter === value ? "primary" : "ghost"}
            onClick={() => setFilter(value)}
          >
            {value ? STATUS[value].label : "Todos"}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          {orders.loading ? <Spinner /> : null}
          {orders.error ? <Alert>{errorMessage(orders.error)}</Alert> : null}
          {orders.data && orders.data.orders.length === 0 ? (
            <p className="text-sm text-fg-dim">No hay pedidos en este estado.</p>
          ) : null}
          <ul className="divide-y divide-line">
            {orders.data?.orders.map((order) => (
              <li key={order.id}>
                <button
                  type="button"
                  onClick={() => setSelected(order.id)}
                  className={`flex w-full items-center justify-between gap-3 px-2 py-3 text-left text-sm hover:bg-raised ${selected === order.id ? "bg-raised" : ""}`}
                >
                  <span>
                    <span className="font-mono">{order.code}</span> · {order.customerName}
                    <br />
                    <span className="text-xs text-fg-dim">
                      {formatDate(order.createdAt)} ·{" "}
                      {order.checkoutMethod === "mercadopago" ? "Mercado Pago" : "Transferencia"}
                    </span>
                  </span>
                  <span className="text-right">
                    {formatMoney(order.totalCents)}
                    <br />
                    <Badge tone={STATUS[order.status].tone}>{STATUS[order.status].label}</Badge>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          {selected ? (
            <OrderDetailPanel
              key={selected}
              storeId={storeId}
              orderId={selected}
              onChanged={orders.reload}
            />
          ) : (
            <p className="text-sm text-fg-dim">Elegí un pedido para ver el detalle.</p>
          )}
        </Card>
      </div>
    </>
  );
}
