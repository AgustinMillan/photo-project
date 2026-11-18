// Client-side checks that mirror the backend Zod schemas (backend/src/modules/*/*.schemas.ts).
// The backend remains the source of truth; these only give faster, localized feedback.

export function validateRequired(value: string, label: string): string | null {
  return value.trim() ? null : `Ingresa ${label}.`;
}

export function validateEmail(value: string): string | null {
  const email = value.trim();

  if (!email) {
    return "Ingresa tu email.";
  }

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Ingresa un email válido.";
  }

  return null;
}

export function validatePassword(value: string): string | null {
  if (value.length < 12) {
    return "Usa al menos 12 caracteres.";
  }

  if (value.length > 128) {
    return "Usa como máximo 128 caracteres.";
  }

  return null;
}

export function validateSlug(value: string): string | null {
  const slug = value.trim().toLowerCase();

  if (slug.length < 3) {
    return "Usa al menos 3 caracteres.";
  }

  if (slug.length > 63) {
    return "Usa como máximo 63 caracteres.";
  }

  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    return "Solo letras minúsculas, números y guiones; no puede empezar ni terminar con guion.";
  }

  if (slug.includes("--")) {
    return "No uses dos guiones seguidos.";
  }

  return null;
}
