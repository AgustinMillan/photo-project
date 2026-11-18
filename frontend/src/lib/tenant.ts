// Hostnames like <slug>.<platformDomain> are public storefronts. Anything else is the
// photographer panel. The backend still resolves the tenant from the Host header; this
// only decides which UI to render.

const NON_TENANT_LABELS = new Set(["www", "app", "api", "admin", "mail"]);

export function resolveTenantSlug(hostname: string, platformDomain: string): string | null {
  const host = hostname.trim().toLowerCase();
  const domain = platformDomain.trim().toLowerCase();

  if (!domain || host === domain || !host.endsWith(`.${domain}`)) {
    return null;
  }

  const label = host.slice(0, -(domain.length + 1));

  if (!label || label.includes(".") || NON_TENANT_LABELS.has(label)) {
    return null;
  }

  return label;
}
