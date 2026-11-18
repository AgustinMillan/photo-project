import type { PublicationStatus, SalesStatus, StoreRole, SubscriptionStatus } from "./types.ts";

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" }).format(date);
}

/** Whole days from `now` until `value` (rounded up). Null when there is no valid date. */
export function daysUntil(value: string | null | undefined, now: Date = new Date()): number | null {
  if (!value) {
    return null;
  }

  const target = new Date(value).getTime();

  if (Number.isNaN(target)) {
    return null;
  }

  return Math.ceil((target - now.getTime()) / 86_400_000);
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}

const ROLE_LABELS: Record<StoreRole, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  PHOTOGRAPHER: "Fotógrafo",
  EDITOR: "Editor",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as StoreRole] ?? role;
}

const SUBSCRIPTION_LABELS: Record<SubscriptionStatus, string> = {
  trial: "Prueba gratuita",
  active: "Activa",
  expired: "Vencida",
  cancelled: "Cancelada",
  suspended: "Suspendida",
};

export function subscriptionStatusLabel(status: SubscriptionStatus): string {
  return SUBSCRIPTION_LABELS[status] ?? status;
}

const PUBLICATION_LABELS: Record<PublicationStatus, string> = {
  draft: "Borrador",
  published: "Publicada",
  unpublished: "Despublicada",
};

export function publicationLabel(status: PublicationStatus): string {
  return PUBLICATION_LABELS[status] ?? status;
}

const FEATURE_LABELS: Record<string, string> = {
  "stores.max": "Tiendas (máximo)",
  "team.enabled": "Gestión de equipo",
  "team.max_members": "Miembros de equipo (máximo)",
  "custom_domain.enabled": "Dominio propio",
  "sections.reorder": "Reordenar secciones",
  "purchases.enabled": "Compras habilitadas",
};

export function featureLabel(featureKey: string): string {
  return FEATURE_LABELS[featureKey] ?? featureKey;
}

const SALES_REASONS: Record<NonNullable<SalesStatus["reason"]>, string> = {
  STORE_NOT_FOUND: "No se encontró la tienda.",
  STORE_INACTIVE: "La tienda no está activa.",
  ACCOUNT_INACTIVE: "La cuenta no está activa.",
  SUBSCRIPTION_MISSING: "La cuenta todavía no tiene una suscripción.",
  SUBSCRIPTION_INACTIVE: "La suscripción no está activa (prueba vencida, cancelada o suspendida).",
  PLAN_PURCHASES_DISABLED: "Tu plan no habilita compras.",
};

export function salesReasonLabel(reason: SalesStatus["reason"]): string {
  return reason ? (SALES_REASONS[reason] ?? reason) : "";
}

/** Public URL of a storefront from its hostname, keeping the dev port when present. */
export function storeUrl(
  hostname: string | null,
  location: { protocol: string; port: string },
): string | null {
  if (!hostname) {
    return null;
  }

  const port = location.port ? `:${location.port}` : "";
  return `${location.protocol}//${hostname}${port}`;
}
