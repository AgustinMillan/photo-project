---
name: Nocturne Cyanotype
colors:
  surface: '#10131b'
  surface-dim: '#10131b'
  surface-bright: '#363941'
  surface-container-lowest: '#0b0e15'
  surface-container-low: '#181b23'
  surface-container: '#1d2027'
  surface-container-high: '#272a32'
  surface-container-highest: '#32353d'
  on-surface: '#e0e2ed'
  on-surface-variant: '#bdc8d1'
  inverse-surface: '#e0e2ed'
  inverse-on-surface: '#2d3038'
  outline: '#87929a'
  outline-variant: '#3e484f'
  surface-tint: '#7bd0ff'
  primary: '#8ed5ff'
  on-primary: '#00354a'
  primary-container: '#38bdf8'
  on-primary-container: '#004965'
  inverse-primary: '#00668a'
  secondary: '#bcc6e3'
  on-secondary: '#263047'
  secondary-container: '#3f4961'
  on-secondary-container: '#aeb8d4'
  tertiary: '#83d7ff'
  on-tertiary: '#003547'
  tertiary-container: '#64bbe3'
  on-tertiary-container: '#004961'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#c4e7ff'
  primary-fixed-dim: '#7bd0ff'
  on-primary-fixed: '#001e2c'
  on-primary-fixed-variant: '#004c69'
  secondary-fixed: '#d9e2ff'
  secondary-fixed-dim: '#bcc6e3'
  on-secondary-fixed: '#111b31'
  on-secondary-fixed-variant: '#3d465e'
  tertiary-fixed: '#c0e8ff'
  tertiary-fixed-dim: '#7bd1fa'
  on-tertiary-fixed: '#001e2b'
  on-tertiary-fixed-variant: '#004d66'
  background: '#10131b'
  on-background: '#e0e2ed'
  surface-variant: '#32353d'
typography:
  display-lg:
    fontFamily: Playfair Display
    fontSize: 4.5rem
    fontWeight: '400'
    lineHeight: 5rem
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Playfair Display
    fontSize: 2.75rem
    fontWeight: '400'
    lineHeight: 3.25rem
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Playfair Display
    fontSize: 3rem
    fontWeight: '400'
    lineHeight: 3.5rem
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Playfair Display
    fontSize: 2rem
    fontWeight: '400'
    lineHeight: 2.5rem
    letterSpacing: 0em
  headline-md:
    fontFamily: Playfair Display
    fontSize: 2rem
    fontWeight: '400'
    lineHeight: 2.5rem
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Playfair Display
    fontSize: 1.5rem
    fontWeight: '500'
    lineHeight: 2rem
    letterSpacing: 0em
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.125rem
    fontWeight: '300'
    lineHeight: 1.875rem
    letterSpacing: 0.01em
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 1rem
    fontWeight: '300'
    lineHeight: 1.625rem
    letterSpacing: 0.01em
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.375rem
    letterSpacing: 0.015em
  label-md:
    fontFamily: Space Grotesk
    fontSize: 0.8125rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: 0.08em
  label-sm:
    fontFamily: Space Grotesk
    fontSize: 0.6875rem
    fontWeight: '500'
    lineHeight: 0.875rem
    letterSpacing: 0.12em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 4rem
  margin-mobile: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 2rem
  space-xl: 4rem
---

## Brand & Style

This design system embodies the contemplative atmosphere of a museum-grade archival gallery at midnight. Designed for fine-art photographer Éléna Vance, it translates historical cyanotype contact prints, nocturnal large-format exposures, and architectural shadows into an immersive digital monograph. 

The emotional tone is quiet, reverent, and impeccably curated. Imagery remains the central source of light, framed by vast reaches of obsidian, deep indigo, and oceanic midnight layers.

### Design Movement
**Minimalist Neo-Archival:** The aesthetic relies on severe structural restraint, generous negative space, gossamer hairline rules, and high typographic contrast. Classical editorial elegance is balanced against precise, utilitarian metadata.

## Colors

The palette reproduces the chemical depth of Prussian blue ferric solutions transitioning into deep silver-halide shadows.

### Surface Tiers
- **Void Background (`#080b12`):** Base canvas; total absorption for full-bleed photography.
- **Deep Indigo Surface (`#0d131f`):** Structural backdrops, navigation docks, and page segments.
- **Midnight Elevated (`#131b2e`):** Floating frames, modal overlays, and elevated cards.
- **Muted Slate Container (`#1a243a`):** Active segments, hovering surfaces, and technical callouts.

### Accents & Luminescence
- **Cyan Core (`#38bdf8`):** Focus rings, active states, and curated collection indicators.
- **Ice Cyan Glow (`#7dd3fc`):** Hover highlights, illuminated metadata, and cursor interactions.
- **Steel Dividers (`#243352`):** Hairline structure and framing borders at 40–80% opacity.

### Typography & Monchrome Tones
- **Silver-White High Contrast (`#f0f6fc`):** Primary display headings, titles, and artist statements.
- **Muted Ice Gray (`#cbd5e1`):** Body narratives, curatorial notes, and descriptions.
- **Slate Secondary (`#94a3b8`):** EXIF data, technical plate indices, and caption footnotes.

## Typography

Typographic hierarchy relies on the tension between classical fine-art tradition and technical precision:

- **Headlines (Playfair Display):** Evokes mid-century gallery catalogs, luxury monographs, and literary depth. Italic variants are reserved for plate titles, series subtitles, and curatorial quotes.
- **Narratives & Statements (Plus Jakarta Sans):** Set at light weights (`300` / `400`) with relaxed line heights to promote unhurried, comfortable reading on luminous dark surfaces.
- **Archival Metadata & Indices (Space Grotesk):** Scaled down, tracked widely, and capitalized. Used exclusively for camera metrics (shutter speed, emulsion type, aperture), plate numbering (e.g., `PL. 014 // CYANOTYPE`), and UI navigation labels.

## Layout & Spacing

The layout is built upon an asymmetrical 12-column architectural grid with vast, deliberate voids that let single photographic plates command attention.

- **Desktop (12 Columns):** 64px margins with 24px gutters. Visual compositions alternate between centered monumental solo exposures and asymmetric offset pairs with narrative captions aligned to outer columns.
- **Tablet (8 Columns):** 32px margins with 16px gutters. Structural multi-column galleries reflow into alternating full-width and half-width pairings.
- **Mobile (4 Columns):** 20px margins with 16px gutters. Single-column vertical scroll mimicking a handheld folio.

Generous vertical rhythm enforces breathing room: sections are separated by `space-xl` (4rem) to `space-xl * 2` (8rem) intervals, preventing neighboring works from bleeding into each other's visual field.

## Elevation & Depth

To maintain the flat, archival quality of fine-art paper and contact prints, physical drop shadows are eliminated. Depth is communicated strictly through surface luminosity, tonal contrast, and optical glows.

- **Level 0 (Floor):** Base `#080b12`. Matte, light-absorbing plane.
- **Level 1 (Mounting Boards):** `#0d131f` framed with 1px hairline border of `#243352` (alpha 0.5). Used for framing photographs and essay sections.
- **Level 2 (Curatorial Overlays):** `#131b2e` with `backdrop-filter: blur(12px)`. Used for lightbox viewports, slide-out index drawers, and floating menus.
- **Cyan Halation (Focal Hover):** Active photographic plates and primary controls emit a faint, wide, diffuse cyan aura: `box-shadow: 0 0 40px -10px rgba(56, 189, 248, 0.12)`.

## Shapes

The shape architecture is sharp and disciplined, reflecting cut mat boards, glass negatives, and sheet film.

- **Corners:** Minimal rounding (`roundedness: 1`, 0.25rem / 4px) softens the edge slightly on interactive elements without breaking structural rigidity.
- **Image Containers:** Strictly 0px sharp corners to honor the photographic crop and avoid distorting frame edges.
- **Pills / Tags:** Archival labels and micro badges employ subtle 4px geometry, avoiding playful capsule silhouettes.

## Components

### Buttons & Interactive Links
- **Primary Action (Acquisition / Inquiry):** Minimal high-contrast button. Dark indigo interior (`#0d131f`), solid 1px border of `#7dd3fc`, label set in uppercase `label-md` (`#f0f6fc`). On hover, transitions to solid `#38bdf8` background with `#080b12` text.
- **Text Action / Index Link:** Playfair italic headline or Space Grotesk metadata link featuring a faint 1px bottom rule in `#243352` that expands and brightens to `#7dd3fc` upon hover.

### Photographic Cards & Framing
- Artwork frames feature a 1px border of `#243352`. Photographs sit flush or framed with a matte margin of `#0d131f`. Hovering reveals curatorial metadata (Series, Year, Print Dimensions) via a subtle fade-up transition.

### Chips & Archival Filters
- Small, tactile rectangles (`space-xs` vertical, `space-sm` horizontal) set against `#0d131f` with hairline `#243352` borders. Text uses `label-sm`. Active filters illuminate with a faint `#38bdf8` outline and text color.

### Form Inputs (Inquiry / Commission)
- Inputs utilize bottom-border-only styling: a 1px rule of `#243352` against transparent backgrounds. On focus, the rule brightens to `#38bdf8` accompanied by a soft 1px cyan glow. Placeholder text is rendered in `body-sm` (`#94a3b8`).

### Lightbox & Inspection Mode
- Fullscreen `#080b12` environment (98% opacity blur). Floating utility bar displaying zoom ratios, print dimensions, and chemical process details in `label-sm` along the bottom margin.