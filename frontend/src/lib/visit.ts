// Cookie-free page view: the server counts one visitor per day without storing
// personal data. Where the visitor came from (ad link parameters or the
// referring site) is kept only for this browser tab (sessionStorage) so a
// sign-up in the same visit can be attributed to it. Fire and forget.

export type VisitAttribution = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  referrer?: string;
  fbclid?: boolean;
  gclid?: boolean;
  path?: string;
};

const KEY = "galeriza.origin";
let sent = false;

function readStored(): VisitAttribution | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as VisitAttribution) : null;
  } catch {
    return null;
  }
}

function fromLocation(): VisitAttribution {
  const params = new URLSearchParams(window.location.search);
  const pick = (name: string) => params.get(name)?.slice(0, 200) || undefined;
  return {
    utmSource: pick("utm_source"),
    utmMedium: pick("utm_medium"),
    utmCampaign: pick("utm_campaign"),
    utmContent: pick("utm_content"),
    fbclid: params.has("fbclid") || undefined,
    gclid: params.has("gclid") || undefined,
    referrer: document.referrer ? document.referrer.slice(0, 300) : undefined,
    path: `${window.location.pathname}${window.location.search}`.slice(0, 200),
  };
}

/** First touch of this tab: the ad or site that brought the visitor. */
export function visitAttribution(): VisitAttribution {
  if (typeof window === "undefined") return {};
  const stored = readStored();
  if (stored) return stored;
  const current = fromLocation();
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // storage blocked: attribution simply stays in this page
  }
  return current;
}

export function trackVisit(): void {
  if (sent || typeof window === "undefined") return;
  sent = true;
  try {
    void fetch("/api/v1/public/visit", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(visitAttribution()),
    }).catch(() => {});
  } catch {
    // ignore
  }
}
