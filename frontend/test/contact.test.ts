import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serviceContactUrl } from "../src/lib/contact.ts";

const base = { displayName: "Daniela", phone: "", contactEmail: "", instagram: "" };

describe("service contact button", () => {
  it("prefers WhatsApp with a prefilled message", () => {
    const url = serviceContactUrl(
      { ...base, phone: "+54 9 381 555-1234", contactEmail: "d@x.com" },
      "Eventos",
    );
    assert.equal(url?.startsWith("https://wa.me/5493815551234?text="), true);
    assert.match(decodeURIComponent(url ?? ""), /quiero consultar por: Eventos/);
  });

  it("falls back to email, then Instagram, then nothing", () => {
    assert.match(
      serviceContactUrl({ ...base, contactEmail: "d@x.com" }, "Productos") ?? "",
      /^mailto:d@x.com\?subject=/,
    );
    assert.equal(
      serviceContactUrl({ ...base, instagram: "@dani.foto" }, "X"),
      "https://instagram.com/dani.foto",
    );
    assert.equal(serviceContactUrl(base, "X"), null);
  });
});
