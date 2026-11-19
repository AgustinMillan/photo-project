import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contrast,
  DEFAULT_THEME,
  TEMPLATE_ORDER,
  templateDefaults,
  themeVars,
  themeWarnings,
} from "../src/lib/theme.ts";
import type { StorefrontTheme } from "../src/lib/types.ts";

function readable(theme: StorefrontTheme) {
  const vars = themeVars(theme);
  const ratio = (name: string) => contrast(vars[name] ?? "", theme.background);
  return {
    fg: ratio("--color-fg"),
    muted: ratio("--color-fg-muted"),
    dim: ratio("--color-fg-dim"),
  };
}

describe("storefront themes", () => {
  it("ships three templates whose own colors raise no warnings", () => {
    for (const template of TEMPLATE_ORDER) {
      const theme = templateDefaults(template);
      assert.deepEqual(themeWarnings(theme), [], template);
      const vars = themeVars(theme);
      assert.ok(contrast(vars["--color-on-accent"] ?? "", theme.primary) >= 4.5, template);
    }
  });

  it("keeps small text readable on any background the photographer picks", () => {
    for (const background of ["#000000", "#ffffff", "#faf7f4", "#1e3a8a", "#ffcc00"]) {
      const { fg, muted, dim } = readable({ ...DEFAULT_THEME, template: "claro", background });
      assert.ok(fg >= 7, `${background} fg ${fg}`);
      assert.ok(muted >= 4.5, `${background} muted ${muted}`);
      assert.ok(dim >= 4.5, `${background} dim ${dim}`);
    }
  });

  it("does its best on mid-tone backgrounds and says so", () => {
    const theme: StorefrontTheme = { ...DEFAULT_THEME, background: "#2f855a" };
    const { fg, dim } = readable(theme);
    assert.ok(fg >= 4.5 && dim >= 4.5);
    assert.ok(themeWarnings(theme).some((warning) => warning.includes("tono medio")));
  });

  it("warns in plain words when the main color melts into the background", () => {
    const warnings = themeWarnings({
      template: "claro",
      primary: "#f5f0f0",
      secondary: "#6f8268",
      background: "#ffffff",
    });
    assert.ok(warnings.some((warning) => warning.includes("color principal")));
  });

  it("falls back to the template colors when a stored value is broken", () => {
    const vars = themeVars({
      template: "neon",
      primary: "pink",
      secondary: "#22f3ff",
      background: "",
    });
    assert.equal(vars["--color-accent"], "#ff2bd6");
    assert.equal(vars["--color-void"], "#07030f");
  });
});
