/** Prices travel as integer cents; the UI shows and edits whole pesos. */
export function formatMoney(cents: number | null | undefined, currency = "ARS"): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** "12.500" or "12500,50" → cents. Empty → null. Invalid → NaN. */
export function parsePesos(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\$|\s/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return Number.NaN;
  return Math.round(value * 100);
}

export function centsToInput(cents: number | null | undefined): string {
  return cents ? String(cents / 100).replace(".", ",") : "";
}
