import type { PhotoProtection, ProtectionFlags } from "../lib/types.ts";

export const DEFAULT_PROTECTION: PhotoProtection = {
  grid: { watermark: true, grayscale: false, reveal: false },
  full: { watermark: true, grayscale: false, reveal: false },
};

const CONTEXTS: Array<{ key: keyof PhotoProtection; title: string; hint: string }> = [
  { key: "grid", title: "Miniaturas", hint: "Las fotos chicas de la galería." },
  { key: "full", title: "Vista ampliada", hint: "Cuando tocan una foto para verla grande." },
];

const OPTIONS: Array<{ key: keyof ProtectionFlags; label: string; hint: string }> = [
  { key: "watermark", label: "Marca de agua", hint: "Tu texto repetido sobre la foto." },
  { key: "grayscale", label: "Blanco y negro", hint: "La ven sin color hasta que la compran." },
  {
    key: "reveal",
    label: "Difuminada",
    hint: "Se ve borrosa y se descubre al pasar el mouse o el dedo.",
  },
];

function warning(flags: ProtectionFlags, context: keyof PhotoProtection): string | null {
  if (!flags.watermark && !flags.grayscale && !flags.reveal) {
    return context === "full"
      ? "Sin protección: cualquiera puede guardar la foto grande tal como la ven."
      : "Sin protección: las miniaturas se ven tal cual.";
  }
  if (!flags.watermark && !flags.grayscale && flags.reveal) {
    return "El difuminado frena las capturas de pantalla, pero no evita que alguien descargue la imagen. Para protegerla de verdad, sumá la marca de agua.";
  }
  return null;
}

function Preview({
  src,
  flags,
  watermarkText,
}: {
  src: string | null;
  flags: ProtectionFlags;
  watermarkText: string;
}) {
  const filters = [flags.grayscale ? "grayscale(1)" : "", flags.reveal ? "blur(6px)" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="relative aspect-[4/3] w-full max-w-xs overflow-hidden rounded-ui bg-raised">
      {src ? (
        <img
          src={src}
          alt=""
          className="size-full scale-105 object-cover"
          style={{ filter: filters || undefined }}
        />
      ) : (
        <div
          className="size-full bg-gradient-to-br from-sky-800 via-slate-700 to-amber-700"
          style={{ filter: filters || undefined }}
        />
      )}
      {flags.watermark ? (
        <div className="pointer-events-none absolute -inset-1/2 flex -rotate-[30deg] flex-wrap content-center items-center justify-center gap-x-5 gap-y-5 font-bold text-white/40">
          {Array.from({ length: 48 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static decorative repetition
            <span key={index} className="text-[10px] whitespace-nowrap">
              {watermarkText.trim() || "Vista previa"}
            </span>
          ))}
        </div>
      ) : null}
      {flags.reveal ? (
        <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-void/70 px-2 py-0.5 font-mono text-[10px] text-fg-muted">
          PASÁ EL MOUSE PARA VER
        </span>
      ) : null}
    </div>
  );
}

export function ProtectionEditor({
  value,
  watermarkText,
  sampleUrl,
  onChange,
  onWatermarkTextChange,
}: {
  value: PhotoProtection | undefined;
  watermarkText: string;
  sampleUrl: string | null;
  onChange: (value: PhotoProtection) => void;
  onWatermarkTextChange: (value: string) => void;
}) {
  const protection = value ?? DEFAULT_PROTECTION;
  const usesWatermark = protection.grid.watermark || protection.full.watermark;

  return (
    <div className="space-y-5">
      <p className="text-sm text-fg-muted">
        Elegí cómo se ven tus fotos antes de que las compren. Podés combinar opciones y usar
        distintas para las miniaturas y para la vista ampliada. Quien compra siempre recibe la foto
        original, sin nada de esto.
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        {CONTEXTS.map((context) => {
          const flags = protection[context.key];
          const note = warning(flags, context.key);
          return (
            <fieldset key={context.key} className="space-y-3 border-0 p-0">
              <legend className="mb-1 font-display text-lg text-fg">{context.title}</legend>
              <p className="text-xs text-fg-dim">{context.hint}</p>
              <Preview src={sampleUrl} flags={flags} watermarkText={watermarkText} />
              {OPTIONS.map((option) => (
                <label key={option.key} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={flags[option.key]}
                    onChange={(event) =>
                      onChange({
                        ...protection,
                        [context.key]: { ...flags, [option.key]: event.target.checked },
                      })
                    }
                  />
                  <span>
                    <span className="text-fg">{option.label}</span>
                    <span className="block text-xs text-fg-dim">{option.hint}</span>
                  </span>
                </label>
              ))}
              {note ? (
                <p className="rounded-ui border border-danger/30 bg-danger/10 p-2 text-xs text-fg-muted">
                  {note}
                </p>
              ) : null}
            </fieldset>
          );
        })}
      </div>
      {usesWatermark ? (
        <label className="block max-w-sm text-sm">
          <span className="text-fg-muted">Texto de la marca de agua</span>
          <input
            value={watermarkText}
            maxLength={60}
            onChange={(event) => onWatermarkTextChange(event.target.value)}
            className="mt-1 w-full rounded-ui border border-line bg-raised px-3 py-2 text-fg focus:border-accent focus:outline-none"
          />
          <span className="mt-1 block text-xs text-fg-dim">
            Se aplica a todas tus fotos, también a las que ya subiste.
          </span>
        </label>
      ) : null}
      <p className="text-xs text-fg-dim">
        Los cambios se ven en tu tienda cuando tocás “Publicar”.
      </p>
    </div>
  );
}
