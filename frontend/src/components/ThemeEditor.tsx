import { type CSSProperties, useEffect, useState } from "react";
import {
  isHexColor,
  loadTemplateFonts,
  TEMPLATE_ORDER,
  TEMPLATES,
  templateDefaults,
  themeVars,
  themeWarnings,
} from "../lib/theme.ts";
import type { StorefrontTheme } from "../lib/types.ts";

type ColorKey = "primary" | "secondary" | "background";

const COLOR_FIELDS: Array<{ key: ColorKey; label: string; hint: string }> = [
  { key: "primary", label: "Principal", hint: "Botones, precios y títulos de sección" },
  { key: "secondary", label: "Secundario", hint: "Detalles y efecto al pasar el mouse" },
  { key: "background", label: "Fondo", hint: "Fondo de toda la tienda" },
];

/** Mini storefront drawn with the theme's own variables and template rules. */
export function ThemeSample({
  theme,
  name,
  photos = [],
  titles = ["Casamiento", "Quince", "Retratos"],
  tagline = "Fotografía de eventos y retratos",
  compact = false,
}: {
  theme: StorefrontTheme;
  name: string;
  photos?: string[];
  titles?: string[];
  tagline?: string;
  compact?: boolean;
}) {
  useEffect(() => loadTemplateFonts(theme.template), [theme.template]);
  const style = themeVars(theme) as CSSProperties;
  const cards = [0, 1, 2];

  if (compact) {
    return (
      <div
        data-template={theme.template}
        style={style}
        className="theme-preview pointer-events-none h-28 overflow-hidden p-3 text-left"
      >
        <p className="font-display text-lg leading-tight text-fg">{name}</p>
        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.3em] text-accent">Galerías</p>
        <div className="mt-2 flex gap-1.5">
          {cards.map((i) => (
            <div
              key={i}
              className="h-9 flex-1 rounded-ui border border-line bg-gradient-to-br from-overlay to-raised"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      data-template={theme.template}
      style={style}
      className="theme-preview pointer-events-none overflow-hidden rounded-ui border border-line text-left"
      aria-hidden
    >
      <div className="flex items-center justify-between border-b border-line/60 px-4 py-3">
        <span className="font-display text-base text-fg">{name}</span>
        <span className="rounded-ui border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          Carrito <span className="text-accent">(2)</span>
        </span>
      </div>
      <div className="relative flex h-40 items-end overflow-hidden">
        {photos[0] ? (
          <img
            src={photos[0]}
            alt=""
            className="hero-cover absolute inset-0 size-full object-cover opacity-60"
          />
        ) : (
          <div className="hero-fallback absolute inset-0 bg-gradient-to-br from-overlay via-surface to-void" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-void via-void/40 to-transparent" />
        <div className="relative px-4 pb-4">
          <p className="font-display text-3xl text-fg">{name}</p>
          <p className="mt-1 text-sm text-fg-muted">{tagline}</p>
        </div>
      </div>
      <div className="px-4 pt-5 pb-5">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
          Galerías
        </p>
        <div className="grid grid-cols-3 gap-3">
          {cards.map((i) => (
            <div key={i} className={i === 1 ? "group" : undefined}>
              <div className="aspect-[4/5] overflow-hidden rounded-ui bg-surface">
                {(photos[i + 1] ?? photos[i]) ? (
                  <img src={photos[i + 1] ?? photos[i]} alt="" className="size-full object-cover" />
                ) : (
                  <div className="size-full bg-gradient-to-br from-overlay to-raised" />
                )}
              </div>
              <p
                className={`mt-2 font-display text-sm ${i === 1 ? "text-accent-soft" : "text-fg"}`}
              >
                {titles[i]}
              </p>
              <p className="text-[11px] text-fg-dim">24 fotos</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-ui border border-line/60 bg-surface p-3">
          <span className="flex-1 text-sm text-fg">Sesión de fotos · Desde $ 45.000</span>
          <span className="rounded-ui border border-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-accent">
            Consultar
          </span>
          <span className="rounded-ui bg-accent px-4 py-2 text-xs font-medium text-on-accent">
            Comprar · $ 3.000
          </span>
        </div>
      </div>
    </div>
  );
}

export function ThemeEditor({
  value,
  displayName,
  photos,
  onChange,
}: {
  value: StorefrontTheme;
  displayName: string;
  photos: string[];
  onChange: (theme: StorefrontTheme) => void;
}) {
  // Text drafts so a half-typed hex doesn't reset the color.
  const [drafts, setDrafts] = useState<Record<ColorKey, string>>({
    primary: value.primary,
    secondary: value.secondary,
    background: value.background,
  });
  useEffect(
    () =>
      setDrafts({
        primary: value.primary,
        secondary: value.secondary,
        background: value.background,
      }),
    [value.primary, value.secondary, value.background],
  );

  const defaults = templateDefaults(value.template);
  const customized =
    value.primary !== defaults.primary ||
    value.secondary !== defaults.secondary ||
    value.background !== defaults.background;
  const warnings = themeWarnings(value);
  const name = displayName.trim() || "Tu estudio";

  function setColor(key: ColorKey, color: string) {
    setDrafts((previous) => ({ ...previous, [key]: color }));
    if (isHexColor(color)) onChange({ ...value, [key]: color.toLowerCase() });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_26rem]">
      <div className="space-y-6">
        <fieldset>
          <legend className="mb-2 font-mono text-xs uppercase tracking-wider text-fg-dim">
            Plantilla
          </legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {TEMPLATE_ORDER.map((template) => {
              const selected = value.template === template;
              return (
                <button
                  key={template}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    if (!selected) onChange(templateDefaults(template));
                  }}
                  className={`overflow-hidden rounded-ui border text-left transition-colors ${selected ? "border-accent ring-1 ring-accent" : "border-line hover:border-fg-dim"}`}
                >
                  <ThemeSample theme={templateDefaults(template)} name={name} compact />
                  <div className="border-t border-line bg-surface px-3 py-2">
                    <p className="text-sm font-medium text-fg">
                      {TEMPLATES[template].name}
                      {selected ? (
                        <span className="ml-2 text-xs text-accent">✓ elegida</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-fg-dim">
                      {TEMPLATES[template].description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-fg-dim">
            Las tres tienen las mismas secciones. Al cambiar de plantilla se cargan sus colores;
            después los podés cambiar.
          </p>
        </fieldset>

        <fieldset>
          <legend className="mb-2 font-mono text-xs uppercase tracking-wider text-fg-dim">
            Colores
          </legend>
          <div className="grid gap-4 sm:grid-cols-3">
            {COLOR_FIELDS.map((field) => (
              <div key={field.key}>
                <label htmlFor={`theme-${field.key}`} className="block text-sm text-fg">
                  {field.label}
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    id={`theme-${field.key}`}
                    type="color"
                    value={value[field.key]}
                    onChange={(event) => setColor(field.key, event.target.value)}
                    className="h-10 w-12 cursor-pointer rounded-ui border border-line bg-raised p-1"
                  />
                  <input
                    aria-label={`${field.label} (código)`}
                    value={drafts[field.key]}
                    maxLength={7}
                    onChange={(event) => {
                      const raw = event.target.value.trim();
                      setColor(field.key, raw.startsWith("#") ? raw : `#${raw}`);
                    }}
                    onBlur={() =>
                      setDrafts((previous) => ({ ...previous, [field.key]: value[field.key] }))
                    }
                    className="w-24 border-0 border-b border-line bg-raised px-2 py-2 font-mono text-sm text-fg uppercase focus:border-accent focus:outline-none"
                  />
                </div>
                <p className="mt-1 text-xs text-fg-dim">{field.hint}</p>
              </div>
            ))}
          </div>
          {customized ? (
            <button
              type="button"
              onClick={() => onChange(defaults)}
              className="mt-3 text-xs text-fg-dim underline hover:text-fg"
            >
              Volver a los colores de {TEMPLATES[value.template].name}
            </button>
          ) : null}
          {warnings.length ? (
            <ul className="mt-3 space-y-1 rounded-ui border border-accent/40 p-3 text-xs text-fg-muted">
              {warnings.map((warning) => (
                <li key={warning}>⚠ {warning}</li>
              ))}
            </ul>
          ) : null}
        </fieldset>
      </div>

      <div>
        <p className="mb-2 font-mono text-xs uppercase tracking-wider text-fg-dim">Vista previa</p>
        <ThemeSample theme={value} name={name} photos={photos} />
        <p className="mt-2 text-xs text-fg-dim">
          Los textos se ajustan solos para que se lean bien sobre el fondo que elijas.
        </p>
      </div>
    </div>
  );
}
