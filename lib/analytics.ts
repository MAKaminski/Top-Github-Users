/**
 * Analytics configuration, and the one place that decides whether to load it.
 *
 * The key is public by design — PostHog project keys are write-only ingest
 * tokens meant to ship in client bundles, which is why the variable is
 * `NEXT_PUBLIC_`. It is not a secret and does not read anything back.
 *
 * Absent key means no analytics and no banner: a fork, a local clone or a
 * preview without the variable set renders a site with no third-party requests
 * at all, rather than a broken script and a cookie prompt for nothing.
 */
export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
export const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export const ANALYTICS_ENABLED = POSTHOG_KEY.length > 0;

/** Where the consent decision is stored. `localStorage` rather than a cookie:
 *  the record of a consent choice should not itself need consent. */
export const CONSENT_KEY = "commitgraph.analytics-consent";
export type Consent = "granted" | "denied";

export function readConsent(): Consent | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(CONSENT_KEY);
    return stored === "granted" || stored === "denied" ? stored : null;
  } catch {
    // Private-browsing modes throw on localStorage access. No stored answer is
    // the same as no answer given, which is the safe reading.
    return null;
  }
}

export function writeConsent(consent: Consent): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, consent);
  } catch {
    // Non-fatal: the banner reappears next visit, which is the conservative
    // failure and never the other way round.
  }
}
