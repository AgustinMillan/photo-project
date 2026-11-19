// Cookie-free page view: the server counts one visitor per day without storing
// personal data. Fire and forget; never blocks or breaks the page.
let sent = false;

export function trackVisit(): void {
  if (sent || typeof window === "undefined") return;
  sent = true;
  try {
    void fetch("/api/v1/public/visit", { method: "POST", keepalive: true }).catch(() => {});
  } catch {
    // ignore
  }
}
