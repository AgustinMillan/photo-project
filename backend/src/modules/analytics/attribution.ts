import { z } from "zod";
import { env } from "../../config/env.js";

export function platformHost(): string {
  return env.PLATFORM_DOMAIN.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Where a visit or a sign-up came from. Built from the ad link parameters
 * (utm_*) when present, otherwise from click ids or the referring site.
 * Values are short, lowercase labels; nothing personal is kept.
 */
export type Attribution = { source: string; medium: string; campaign: string; content: string };

export const EMPTY_ATTRIBUTION: Attribution = { source: "", medium: "", campaign: "", content: "" };

const text = z.string().max(300).optional();

export const attributionInputSchema = z
  .object({
    utmSource: text,
    utmMedium: text,
    utmCampaign: text,
    utmContent: text,
    referrer: text,
    fbclid: z.boolean().optional(),
    gclid: z.boolean().optional(),
    path: text,
  })
  .partial();

export type AttributionInput = z.infer<typeof attributionInputSchema>;

function clean(value: string | undefined, max = 60): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._ -]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, max);
}

const REFERRER_SOURCES: Array<[RegExp, string]> = [
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.me$/, "facebook"],
  [/(^|\.)whatsapp\.com$|(^|\.)wa\.me$/, "whatsapp"],
  [/(^|\.)google\.[a-z.]+$/, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/, "x"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/, "linkedin"],
  [/(^|\.)youtube\.com$/, "youtube"],
];

function referrerHost(referrer: string | undefined): string {
  if (!referrer) return "";
  try {
    return new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * @param ownHosts hosts that are this site; a referrer from them is internal
 * navigation, not a source.
 */
export function resolveAttribution(input: AttributionInput, ownHosts: string[]): Attribution {
  const campaign = clean(input.utmCampaign, 80);
  const content = clean(input.utmContent, 80);
  const utmSource = clean(input.utmSource);
  if (utmSource) {
    return { source: utmSource, medium: clean(input.utmMedium) || "", campaign, content };
  }
  if (input.fbclid) return { source: "facebook", medium: "paid", campaign, content };
  if (input.gclid) return { source: "google", medium: "paid", campaign, content };

  const host = referrerHost(input.referrer);
  if (!host || ownHosts.some((own) => host === own || host.endsWith(`.${own}`))) {
    return { ...EMPTY_ATTRIBUTION, campaign, content };
  }
  const known = REFERRER_SOURCES.find(([pattern]) => pattern.test(host));
  return {
    source: known ? known[1] : clean(host),
    medium: "referral",
    campaign,
    content,
  };
}
