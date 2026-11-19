import type { SubscriptionStatus } from "../../db/schema/index.js";

export const STORES_MAX_FEATURE = "stores.max";
export const TEAM_ENABLED_FEATURE = "team.enabled";
export const TEAM_MAX_MEMBERS_FEATURE = "team.max_members";
export const CUSTOM_DOMAIN_ENABLED_FEATURE = "custom_domain.enabled";
export const SECTIONS_REORDER_FEATURE = "sections.reorder";
export const PURCHASES_ENABLED_FEATURE = "purchases.enabled";
export const STATS_ENABLED_FEATURE = "stats.enabled";

export type DefaultEntitlementDefinition = {
  featureKey: string;
  enabled: boolean;
  limitValue: number | null;
  config?: Record<string, unknown>;
};

export type DefaultPlanDefinition = {
  code: string;
  name: string;
  description: string;
  sortOrder: number;
  /** Monthly price, only used when the plan row is first created. */
  priceCents: number | null;
  entitlements: readonly DefaultEntitlementDefinition[];
};

// These are initial, provisional values. They live in the database so that
// commercial configuration can change without deploying functional code.
// In particular, the Business store/member limits are deliberately conservative
// placeholders until the commercial rules are finalized.
export const DEFAULT_PLAN_DEFINITIONS: readonly DefaultPlanDefinition[] = [
  {
    code: "base",
    name: "Base",
    description: "Tu tienda con cobro y entrega automática.",
    sortOrder: 10,
    priceCents: 1_500_000,
    entitlements: [
      { featureKey: STATS_ENABLED_FEATURE, enabled: false, limitValue: null },
      { featureKey: STORES_MAX_FEATURE, enabled: true, limitValue: 1 },
      { featureKey: TEAM_ENABLED_FEATURE, enabled: false, limitValue: null },
      { featureKey: TEAM_MAX_MEMBERS_FEATURE, enabled: false, limitValue: 0 },
      { featureKey: CUSTOM_DOMAIN_ENABLED_FEATURE, enabled: false, limitValue: null },
      { featureKey: SECTIONS_REORDER_FEATURE, enabled: false, limitValue: null },
      { featureKey: PURCHASES_ENABLED_FEATURE, enabled: true, limitValue: null },
    ],
  },
  {
    code: "pro",
    name: "Profesional",
    description: "Todo lo del plan Base más estadísticas de visitas y ventas.",
    sortOrder: 15,
    priceCents: 2_000_000,
    entitlements: [
      { featureKey: STATS_ENABLED_FEATURE, enabled: true, limitValue: null },
      { featureKey: STORES_MAX_FEATURE, enabled: true, limitValue: 1 },
      { featureKey: TEAM_ENABLED_FEATURE, enabled: false, limitValue: null },
      { featureKey: TEAM_MAX_MEMBERS_FEATURE, enabled: false, limitValue: 0 },
      { featureKey: CUSTOM_DOMAIN_ENABLED_FEATURE, enabled: false, limitValue: null },
      { featureKey: SECTIONS_REORDER_FEATURE, enabled: false, limitValue: null },
      { featureKey: PURCHASES_ENABLED_FEATURE, enabled: true, limitValue: null },
    ],
  },
  {
    code: "intermediate",
    name: "Intermedio",
    description: "Una tienda con dominio propio y secciones reordenables.",
    sortOrder: 20,
    priceCents: null,
    entitlements: [
      { featureKey: STORES_MAX_FEATURE, enabled: true, limitValue: 1 },
      { featureKey: TEAM_ENABLED_FEATURE, enabled: false, limitValue: null },
      { featureKey: TEAM_MAX_MEMBERS_FEATURE, enabled: false, limitValue: 0 },
      { featureKey: CUSTOM_DOMAIN_ENABLED_FEATURE, enabled: true, limitValue: null },
      { featureKey: SECTIONS_REORDER_FEATURE, enabled: true, limitValue: null },
      { featureKey: PURCHASES_ENABLED_FEATURE, enabled: true, limitValue: null },
    ],
  },
  {
    code: "business",
    name: "Business",
    description: "Múltiples tiendas y gestión de equipo.",
    sortOrder: 30,
    priceCents: null,
    entitlements: [
      { featureKey: STATS_ENABLED_FEATURE, enabled: true, limitValue: null },
      { featureKey: STORES_MAX_FEATURE, enabled: true, limitValue: 10 },
      { featureKey: TEAM_ENABLED_FEATURE, enabled: true, limitValue: null },
      { featureKey: TEAM_MAX_MEMBERS_FEATURE, enabled: true, limitValue: 10 },
      { featureKey: CUSTOM_DOMAIN_ENABLED_FEATURE, enabled: true, limitValue: null },
      { featureKey: SECTIONS_REORDER_FEATURE, enabled: true, limitValue: null },
      { featureKey: PURCHASES_ENABLED_FEATURE, enabled: true, limitValue: null },
    ],
  },
];

const USABLE_SUBSCRIPTION_STATUSES = new Set<SubscriptionStatus>(["trial", "active"]);

export function isSubscriptionUsable(status: SubscriptionStatus): boolean {
  return USABLE_SUBSCRIPTION_STATUSES.has(status);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
