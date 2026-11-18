import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Badge, Button, Card, PageHeader, Spinner } from "../components/ui.tsx";
import { paymentsApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import { formatDate } from "../lib/format.ts";
import { useLoad } from "../lib/useLoad.ts";
import { useWorkspace } from "../workspace/WorkspaceContext.tsx";

const RETURN_MESSAGES: Record<string, { tone: "ok" | "error" | "info"; text: string }> = {
  connected: { tone: "ok", text: "¡Listo! Tu cuenta de Mercado Pago quedó conectada." },
  error: { tone: "error", text: "No pudimos conectar tu cuenta. Probá de nuevo en unos minutos." },
  cancelled: { tone: "info", text: "La conexión se canceló. Podés intentarlo cuando quieras." },
};

export function PaymentsPage() {
  const { currentStore } = useWorkspace();
  const storeId = currentStore?.id ?? "";
  const connection = useLoad(() => paymentsApi.mercadoPago(storeId), [storeId]);
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const returned = RETURN_MESSAGES[params.get("mp") ?? ""];

  if (!currentStore || connection.loading) return <Spinner />;
  if (connection.error || !connection.data) return <Alert>{errorMessage(connection.error)}</Alert>;
  const data = connection.data;
  const isOwner = currentStore.role === "OWNER";

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await paymentsApi.connectMercadoPago(storeId);
      window.location.assign(url);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  async function disconnect() {
    if (
      !window.confirm(
        "¿Desconectar Mercado Pago? Tus clientes solo van a poder pagar por transferencia.",
      )
    )
      return;
    setBusy(true);
    try {
      await paymentsApi.disconnectMercadoPago(storeId);
      connection.reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Cobros" subtitle="Cómo te pagan tus clientes." />

      {returned ? (
        <div className="mb-4">
          <Alert tone={returned.tone}>
            {returned.text}{" "}
            <button type="button" className="underline" onClick={() => setParams({})}>
              Cerrar
            </button>
          </Alert>
        </div>
      ) : null}
      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Mercado Pago"
          action={
            <Badge tone={data.connected ? "ok" : "neutral"}>
              {data.connected ? "Conectado" : "Sin conectar"}
            </Badge>
          }
        >
          <div className="space-y-4 text-sm text-fg-muted">
            <p>
              Tus clientes pagan con tarjeta, dinero en cuenta o cualquier medio de Mercado Pago. La
              plata va directo a tu cuenta y, apenas se aprueba el pago, le enviamos las fotos por
              email automáticamente.
            </p>
            {data.connected && data.account ? (
              <dl className="grid grid-cols-2 gap-3 rounded-ui border border-line p-3">
                <div>
                  <dt className="font-mono text-xs uppercase tracking-wider text-fg-dim">Cuenta</dt>
                  <dd className="mt-1 text-fg">#{data.account.providerUserId}</dd>
                </div>
                <div>
                  <dt className="font-mono text-xs uppercase tracking-wider text-fg-dim">
                    Conectada
                  </dt>
                  <dd className="mt-1 text-fg">{formatDate(data.account.connectedAt)}</dd>
                </div>
                {!data.account.liveMode ? (
                  <div className="col-span-2">
                    <Badge tone="warn">Modo prueba</Badge>
                  </div>
                ) : null}
              </dl>
            ) : null}
            {!data.available ? (
              <Alert tone="info">
                Estamos terminando de habilitar Mercado Pago en la plataforma. Muy pronto vas a
                poder conectarlo.
              </Alert>
            ) : isOwner ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void connect()} loading={busy}>
                  {data.connected ? "Volver a conectar" : "Conectar Mercado Pago"}
                </Button>
                {data.connected ? (
                  <Button variant="danger" onClick={() => void disconnect()} disabled={busy}>
                    Desconectar
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-fg-dim">
                Solo el propietario de la tienda puede conectar la cuenta.
              </p>
            )}
            <p className="text-xs text-fg-dim">
              Mercado Pago cobra su comisión habitual sobre cada venta.
              {data.platformFeePercent > 0
                ? ` La plataforma retiene además un ${data.platformFeePercent}% por venta.`
                : " La plataforma no cobra comisión por venta."}
            </p>
          </div>
        </Card>

        <Card title="Transferencia">
          <div className="space-y-3 text-sm text-fg-muted">
            <p>
              Si cargás instrucciones de pago en <strong>Vitrina → Cobros</strong> y publicás, tus
              clientes también pueden elegir transferir. En ese caso confirmás el pago a mano desde{" "}
              <strong>Pedidos</strong>.
            </p>
            <p className="text-xs text-fg-dim">
              Si no conectás Mercado Pago, la transferencia es el único medio disponible.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
