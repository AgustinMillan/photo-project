import type { StorefrontTemplate, StorefrontTheme } from "./types.ts";

type TemplateInfo = {
  name: string;
  description: string;
  colors: Omit<StorefrontTheme, "template">;
  radius: string;
  fonts: { display: string; sans: string; mono: string };
  /** Google Fonts stylesheet to load (null when index.html already loads them). */
  fontsHref: string | null;
};

export const TEMPLATES: Record<StorefrontTemplate, TemplateInfo> = {
  nocturne: {
    name: "Nocturna",
    description: "Oscura y elegante. Deja que las fotos brillen.",
    colors: { primary: "#38bdf8", secondary: "#7dd3fc", background: "#080b12" },
    radius: "4px",
    fonts: {
      display: '"Playfair Display", Georgia, serif',
      sans: '"Plus Jakarta Sans", system-ui, sans-serif',
      mono: '"Space Grotesk", ui-monospace, monospace',
    },
    fontsHref: null,
  },
  claro: {
    name: "Clara",
    description:
      "Luminosa, bordes suaves y tipografía delicada. Ideal para bodas, bebés y retratos.",
    colors: { primary: "#8e5e68", secondary: "#6f8268", background: "#faf7f4" },
    radius: "18px",
    fonts: {
      display: '"Cormorant Garamond", Georgia, serif',
      sans: '"Nunito Sans", system-ui, sans-serif',
      mono: '"Nunito Sans", system-ui, sans-serif',
    },
    fontsHref:
      "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Nunito+Sans:wght@300;400;600&display=swap",
  },
  neon: {
    name: "Neón",
    description: "Colores que brillan sobre negro. Para fiestas, recitales, deportes y noche.",
    colors: { primary: "#ff2bd6", secondary: "#22f3ff", background: "#07030f" },
    radius: "2px",
    fonts: {
      display: '"Unbounded", system-ui, sans-serif',
      sans: '"Plus Jakarta Sans", system-ui, sans-serif',
      mono: '"Space Grotesk", ui-monospace, monospace',
    },
    fontsHref: "https://fonts.googleapis.com/css2?family=Unbounded:wght@400;600&display=swap",
  },
};

export const TEMPLATE_ORDER: StorefrontTemplate[] = ["nocturne", "claro", "neon"];

export const DEFAULT_THEME: StorefrontTheme = {
  template: "nocturne",
  ...TEMPLATES.nocturne.colors,
};

export function isTemplate(value: unknown): value is StorefrontTemplate {
  return typeof value === "string" && value in TEMPLATES;
}

export function templateDefaults(template: StorefrontTemplate): StorefrontTheme {
  return { template, ...TEMPLATES[template].colors };
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

// --- color math ---------------------------------------------------------------

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** a → b by `amount` (0 = a, 1 = b). */
export function mix(a: string, b: string, amount: number): string {
  const ca = toRgb(a);
  const cb = toRgb(b);
  return toHex([0, 1, 2].map((i) => (ca[i] ?? 0) + ((cb[i] ?? 0) - (ca[i] ?? 0)) * amount) as Rgb);
}

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The lightest step from `from` toward `to` that reaches `target` contrast against `bg`. */
function reach(bg: string, from: string, to: string, target: number): string {
  for (let step = 0; step <= 50; step++) {
    const candidate = mix(from, to, step / 50);
    if (contrast(candidate, bg) >= target) return candidate;
  }
  return to;
}

function safe(theme: StorefrontTheme | undefined | null): StorefrontTheme {
  if (!theme || !TEMPLATES[theme.template]) return DEFAULT_THEME;
  const fallback = TEMPLATES[theme.template].colors;
  return {
    template: theme.template,
    primary: isHexColor(theme.primary) ? theme.primary : fallback.primary,
    secondary: isHexColor(theme.secondary) ? theme.secondary : fallback.secondary,
    background: isHexColor(theme.background) ? theme.background : fallback.background,
  };
}

/** Light when dark text reads better on it than white text. */
export function isLightBackground(background: string): boolean {
  return contrast(background, "#000000") >= contrast(background, "#ffffff");
}

/**
 * The whole palette from the three chosen colors. Text shades are pushed until they
 * meet WCAG contrast on the chosen background, so any background stays readable.
 */
export function themeVars(input: StorefrontTheme | undefined | null): Record<string, string> {
  const theme = safe(input);
  const info = TEMPLATES[theme.template];
  const bg = theme.background;
  const light = isLightBackground(bg);
  const extreme = light ? "#000000" : "#ffffff";
  const ink = reach(bg, mix(bg, extreme, light ? 0.86 : 0.94), extreme, 7);
  const tint = mix(ink, theme.primary, 0.5);

  const surface = light
    ? luminance(bg) > 0.9
      ? mix(bg, ink, 0.035)
      : mix(bg, "#ffffff", 0.6)
    : mix(bg, tint, 0.05);
  const raised = light ? mix(surface, ink, 0.05) : mix(bg, tint, 0.1);
  const overlay = light ? mix(surface, ink, 0.09) : mix(bg, tint, 0.15);
  const line =
    theme.template === "neon"
      ? mix(bg, theme.primary, 0.35)
      : light
        ? mix(bg, ink, 0.13)
        : mix(bg, tint, 0.22);

  const onAccentOptions = [bg, "#ffffff", "#111111"];
  const onAccent =
    contrast(bg, theme.primary) >= 4.5
      ? bg
      : (onAccentOptions.sort(
          (a, b) => contrast(b, theme.primary) - contrast(a, theme.primary),
        )[0] ?? bg);

  return {
    "--color-void": bg,
    "--color-surface": surface,
    "--color-raised": raised,
    "--color-overlay": overlay,
    "--color-line": line,
    "--color-fg": ink,
    "--color-fg-muted": reach(bg, mix(bg, ink, 0.6), extreme, 6),
    "--color-fg-dim": reach(bg, mix(bg, ink, 0.4), extreme, 4.6),
    "--color-accent": theme.primary,
    "--color-accent-soft": theme.secondary,
    "--color-on-accent": onAccent,
    "--color-ok": light ? "#15803d" : "#4ade80",
    "--color-danger": light ? "#b91c1c" : "#f87171",
    "--font-display": info.fonts.display,
    "--font-sans": info.fonts.sans,
    "--font-mono": info.fonts.mono,
    "--radius-ui": info.radius,
  };
}

/** Plain-language problems with the chosen colors (empty when everything reads well). */
export function themeWarnings(input: StorefrontTheme): string[] {
  const theme = safe(input);
  const vars = themeVars(theme);
  const warnings: string[] = [];
  if (contrast(vars["--color-fg"] ?? "#000000", theme.background) < 7) {
    warnings.push(
      "Con este fondo de tono medio el texto queda con poco contraste. Probá uno más claro o más oscuro.",
    );
  }
  if (contrast(theme.primary, theme.background) < 3) {
    warnings.push(
      "El color principal se parece mucho al fondo: los títulos de sección, precios y botones se van a ver poco.",
    );
  }
  if (contrast(theme.secondary, theme.background) < 2.5) {
    warnings.push(
      "El color secundario casi no se ve sobre el fondo (se usa al pasar el mouse por galerías y enlaces).",
    );
  }
  if (contrast(vars["--color-on-accent"] ?? "#000000", theme.primary) < 4.5) {
    warnings.push(
      "El texto de los botones va a costar leerse. Probá un principal más oscuro o más claro.",
    );
  }
  return warnings;
}

const loadedFonts = new Set<string>();

export function loadTemplateFonts(template: StorefrontTemplate) {
  const href = TEMPLATES[template]?.fontsHref;
  if (!href || loadedFonts.has(href)) return;
  loadedFonts.add(href);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(link);
}

const THEME_CACHE_KEY = "galeriza-theme";

/** Apply the store look to the whole page (public storefront only). */
export function applyThemeToDocument(theme: StorefrontTheme | undefined | null, remember = true) {
  const root = document.documentElement;
  const resolved = safe(theme);
  for (const [name, value] of Object.entries(themeVars(resolved))) {
    root.style.setProperty(name, value);
  }
  root.dataset.template = resolved.template;
  loadTemplateFonts(resolved.template);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved.background);
  if (!remember) return;
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(resolved));
  } catch {
    // Only avoids a flash of the default look on the next visit.
  }
}

/** Re-apply the last look seen on this store before its data loads (no flash). */
export function applyCachedTheme() {
  try {
    const cached = localStorage.getItem(THEME_CACHE_KEY);
    if (cached) applyThemeToDocument(JSON.parse(cached) as StorefrontTheme);
  } catch {
    // Ignore: the real theme is applied once the store loads.
  }
}
