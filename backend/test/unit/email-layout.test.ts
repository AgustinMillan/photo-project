import { describe, expect, it } from "vitest";
import { renderEmailHtml } from "../../src/shared/email/email.service.js";

describe("renderEmailHtml", () => {
  it("wraps the body with the brand and turns a lone link into a button", () => {
    const html = renderEmailHtml(
      '<p>Hola.</p><p><a href="https://galeriza.com.ar/x">Verificar mi email</a></p>',
    );
    expect(html).toContain(">Galeriza</td>");
    expect(html).toMatch(/<table role="presentation"[^>]*margin:24px 0/);
    expect(html).toContain('href="https://galeriza.com.ar/x"');
    expect(html).toContain("Verificar mi email");
    expect(html).toContain("galeriza.com.ar</td>");
  });

  it("keeps inline links as styled links and escapes the brand", () => {
    const html = renderEmailHtml(
      '<p>Podés <a href="https://a.test">descargar</a> tus fotos.</p>',
      "Estudio <Luz>",
      "Pie",
    );
    expect(html).toContain('<a style="color:#0284c7" href="https://a.test">descargar</a>');
    expect(html).toContain("Estudio &lt;Luz&gt;");
    expect(html).not.toContain("margin:24px 0");
    expect(html).toContain(">Pie</td>");
  });
});
