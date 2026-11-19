import { ApiError } from "./api.ts";

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "Email o contraseña incorrectos.",
  EMAIL_NOT_VERIFIED: "Todavía no verificaste tu email. Revisa tu correo o reenvía el enlace.",
  EMAIL_ALREADY_REGISTERED: "Ya existe una cuenta con ese email.",
  ACCOUNT_DISABLED: "Esta cuenta está deshabilitada.",
  INVALID_OR_EXPIRED_TOKEN: "El enlace no es válido o venció. Solicita uno nuevo.",
  ACCOUNT_ALREADY_EXISTS: "Ya tienes una cuenta comercial.",
  ACCOUNT_REQUIRED: "Primero crea tu cuenta comercial.",
  SLUG_TAKEN: "Ese subdominio ya está en uso. Prueba con otro.",
  SLUG_RESERVED: "Ese subdominio está reservado. Prueba con otro.",
  STORE_LIMIT_REACHED: "Tu plan no permite crear más tiendas.",
  STORE_NOT_FOUND: "No encontramos esa tienda.",
  TEAM_FEATURE_DISABLED: "Tu plan actual no incluye gestión de equipo.",
  TEAM_MEMBER_LIMIT_REACHED: "Alcanzaste el máximo de miembros de tu plan.",
  INSUFFICIENT_STORE_ROLE: "Tu rol no permite esta operación.",
  OWNER_REQUIRED: "Solo el propietario puede hacer esto.",
  OWNER_MEMBERSHIP_IMMUTABLE: "La membresía del propietario no se puede modificar.",
  ADMIN_CANNOT_INVITE_ADMINS: "Solo el propietario puede invitar administradores.",
  ADMIN_CANNOT_MANAGE_ADMINS: "Solo el propietario puede gestionar administradores.",
  ALREADY_STORE_MEMBER: "Esa persona ya es miembro de la tienda.",
  INVITATION_ALREADY_PENDING: "Ya hay una invitación pendiente para ese email.",
  INVITATION_EMAIL_MISMATCH:
    "Esta invitación es para otro email. Inicia sesión con el email invitado.",
  INVITATION_EXPIRED: "La invitación venció. Pide que te inviten de nuevo.",
  INVITATION_INVALID: "La invitación no es válida.",
  INVITATION_NOT_FOUND: "No encontramos esa invitación.",
  STORE_MEMBER_NOT_FOUND: "No encontramos a ese miembro.",
  SUBSCRIPTION_INACTIVE: "Tu suscripción no está activa.",
  COUPON_NOT_FOUND: "Ese cupón no existe o no está activo.",
  COUPON_EXPIRED: "Ese cupón ya venció.",
  COUPON_NOT_STARTED: "Ese cupón todavía no está vigente.",
  COUPON_EXHAUSTED: "Ese cupón ya se usó todas las veces permitidas.",
  COUPON_NOT_APPLICABLE: "Ese cupón no aplica a lo que tenés en el carrito.",
  COUPON_CODE_TAKEN: "Ya tienes un cupón con ese código.",
  STATS_NOT_IN_PLAN: "Las estadísticas están incluidas en el plan Profesional.",
  BILLING_UNAVAILABLE: "El pago automático no está disponible en este momento.",
  SUBSCRIPTION_IS_PILOT: "Como cliente piloto no tienes que pagar nada.",
  AUTO_PAYMENT_MISSING: "No tienes un pago automático activo.",
  PAYMENT_PROVIDER_ERROR:
    "Mercado Pago no respondió como esperábamos. Revisa el email de Mercado Pago e inténtalo de nuevo.",
  PLAN_NOT_FOUND: "Ese plan no está disponible.",
  VALIDATION_ERROR: "Revisa los datos ingresados.",
  NETWORK_ERROR: "No pudimos conectar con el servidor. Reintenta en unos segundos.",
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return "Demasiados intentos. Espera un momento e inténtalo de nuevo.";
    }

    return MESSAGES[error.code] ?? "Ocurrió un error inesperado. Inténtalo de nuevo.";
  }

  return "Ocurrió un error inesperado. Inténtalo de nuevo.";
}

export function isApiError(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
}
