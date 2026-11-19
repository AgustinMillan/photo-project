import { useState } from "react";
import { Link } from "react-router-dom";
import { storefrontApi } from "../lib/endpoints.ts";
import type { OnboardingProgress } from "../lib/types.ts";
import { useLoad } from "../lib/useLoad.ts";
import { Button, Card } from "./ui.tsx";

const DEMO_STORE_URL = `https://ejemplo.${import.meta.env.VITE_PLATFORM_DOMAIN || "localhost"}`;

type Step = {
  key: keyof Omit<OnboardingProgress, "photoCount" | "mercadoPago">;
  title: string;
  text: string;
  to?: string;
  action?: string;
};

const STEPS: Step[] = [
  {
    key: "photos",
    title: "Sube tus fotos",
    text: "Crea una galería por evento o tema (por ejemplo, “Egresados 2026”), ponle precio a la galería completa y a cada foto, y súbelas. La marca de agua se agrega sola.",
    to: "/app/catalog",
    action: "Ir a Catálogo",
  },
  {
    key: "profile",
    title: "Personaliza tu vitrina",
    text: "Elige una foto de portada, escribe dos líneas sobre ti y, si quieres, agrega los servicios que ofreces con su precio “desde”.",
    to: "/app/storefront",
    action: "Ir a Vitrina",
  },
  {
    key: "payments",
    title: "Elige cómo cobrar",
    text: "Conecta tu Mercado Pago para que tus clientes paguen y reciban sus fotos solos, al instante. También puedes dejar tus datos para transferencia.",
    to: "/app/payments",
    action: "Ir a Cobros",
  },
  {
    key: "published",
    title: "Publica tu tienda",
    text: "Cuando esté como te gusta, toca “Publicar” en Vitrina. Puedes seguir editando y volver a publicar las veces que quieras.",
    to: "/app/storefront",
    action: "Publicar",
  },
  {
    key: "firstVisit",
    title: "Comparte tu link",
    text: "Ponlo en la bio de Instagram y mándalo por WhatsApp a tus clientes después de cada sesión o evento.",
  },
  {
    key: "firstSale",
    title: "Tu primera venta",
    text: "Cuando un cliente paga, recibe el link de descarga por email y tú ves el pedido en Pedidos. No tienes que enviar nada a mano.",
    to: "/app/orders",
    action: "Ver pedidos",
  },
];

export function FirstSteps({ storeId, storeLink }: { storeId: string; storeLink: string | null }) {
  const { data } = useLoad(() => storefrontApi.onboarding(storeId), [storeId]);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const progress = data?.progress;
  if (!progress) return null;

  const done = STEPS.filter((step) => progress[step.key]).length;
  if (done === STEPS.length) return null;

  const next = STEPS.find((step) => !progress[step.key]);
  const expanded = open ?? next?.key ?? null;

  return (
    <Card title="Primeros pasos">
      <div className="mb-4 flex items-center gap-3">
        <div className="h-2 flex-1 rounded-sm bg-raised">
          <div
            className="h-2 rounded-sm bg-accent transition-all"
            style={{ width: `${(done / STEPS.length) * 100}%` }}
          />
        </div>
        <span className="font-mono text-xs text-fg-dim">
          {done} de {STEPS.length}
        </span>
      </div>

      <ol className="divide-y divide-line">
        {STEPS.map((step, index) => {
          const isDone = progress[step.key];
          const isOpen = expanded === step.key;
          return (
            <li key={step.key} className="py-2">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? "" : step.key)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 text-left"
              >
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs ${
                    isDone ? "border-ok bg-ok/15 text-ok" : "border-line text-fg-dim"
                  }`}
                >
                  {isDone ? "✓" : index + 1}
                </span>
                <span
                  className={`flex-1 text-sm ${isDone ? "text-fg-dim line-through" : "text-fg"}`}
                >
                  {step.title}
                  {step.key === "photos" && progress.photoCount > 0 && !isDone
                    ? ` (${progress.photoCount} subidas, falta publicarlas)`
                    : ""}
                </span>
                <span className="text-xs text-fg-dim">{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen ? (
                <div className="mt-2 pl-9 text-sm text-fg-muted">
                  <p>{step.text}</p>
                  {step.key === "firstVisit" && storeLink ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <code className="rounded-ui bg-raised px-2 py-1 text-xs text-fg">
                        {storeLink}
                      </code>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          void navigator.clipboard?.writeText(storeLink).then(() => {
                            setCopied(true);
                            window.setTimeout(() => setCopied(false), 1500);
                          });
                        }}
                      >
                        {copied ? "Copiado" : "Copiar link"}
                      </Button>
                    </div>
                  ) : null}
                  {step.to && step.action && !isDone ? (
                    <Link
                      to={step.to}
                      className="mt-3 inline-block rounded-ui bg-accent px-3 py-1.5 text-sm font-medium text-void hover:bg-accent-soft"
                    >
                      {step.action}
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <p className="mt-4 text-xs text-fg-dim">
        ¿Quieres ver cómo queda una tienda terminada?{" "}
        <a
          className="text-accent hover:text-accent-soft"
          href={DEMO_STORE_URL}
          target="_blank"
          rel="noreferrer"
        >
          Mira la tienda de ejemplo
        </a>
        .
      </p>
    </Card>
  );
}
