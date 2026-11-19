import { describe, expect, it } from "vitest";
import { resolveAttribution } from "../../src/modules/analytics/attribution.js";

const OWN = ["galeriza.com.ar"];

describe("resolveAttribution", () => {
  it("uses the ad link parameters first, normalized", () => {
    expect(
      resolveAttribution(
        {
          utmSource: "Instagram",
          utmMedium: "Paid Social",
          utmCampaign: "Prueba Nov",
          utmContent: "Sin WeTransfer!",
          referrer: "https://l.instagram.com/",
        },
        OWN,
      ),
    ).toEqual({
      source: "instagram",
      medium: "paid-social",
      campaign: "prueba-nov",
      content: "sin-wetransfer",
    });
  });

  it("recognizes ad clicks without utm", () => {
    expect(resolveAttribution({ fbclid: true }, OWN)).toMatchObject({
      source: "facebook",
      medium: "paid",
    });
    expect(resolveAttribution({ gclid: true }, OWN)).toMatchObject({ source: "google" });
  });

  it("maps known referrers and keeps other sites by host", () => {
    expect(resolveAttribution({ referrer: "https://l.instagram.com/?u=x" }, OWN).source).toBe(
      "instagram",
    );
    expect(resolveAttribution({ referrer: "https://m.facebook.com/" }, OWN).source).toBe(
      "facebook",
    );
    expect(resolveAttribution({ referrer: "https://www.google.com.ar/" }, OWN).source).toBe(
      "google",
    );
    expect(resolveAttribution({ referrer: "https://blog.ejemplo.com/post" }, OWN)).toMatchObject({
      source: "blog.ejemplo.com",
      medium: "referral",
    });
  });

  it("treats own pages and missing data as direct", () => {
    expect(resolveAttribution({ referrer: "https://galeriza.com.ar/" }, OWN).source).toBe("");
    expect(resolveAttribution({ referrer: "https://daniela.galeriza.com.ar/" }, OWN).source).toBe(
      "",
    );
    expect(resolveAttribution({}, OWN).source).toBe("");
    expect(resolveAttribution({ referrer: "not a url" }, OWN).source).toBe("");
  });
});
