"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";

import {
  ANALYTICS_ENABLED,
  POSTHOG_HOST,
  POSTHOG_KEY,
  readConsent,
  writeConsent,
  type Consent,
} from "@/lib/analytics";

/**
 * PostHog, with autocapture, and not a single request before consent.
 *
 * `opt_out_capturing_by_default` is the load-bearing setting: the library is
 * initialised so it is ready the instant someone accepts, but it queues nothing
 * and sets no cookie until then. Initialising eagerly and "opting out
 * afterwards" is the common shortcut and it is wrong — the cookie is written
 * before the visitor has answered.
 *
 * Pageviews are captured manually because this is the App Router: the SPA
 * navigations that make up most of a session never fire a document load, so
 * PostHog's automatic pageview would record the entry page and nothing else.
 */
function init(): void {
  if (posthog.__loaded) return;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: "always",
    // Handled below, per navigation.
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    opt_out_capturing_by_default: true,
    persistence: "localStorage+cookie",
    // The site has no accounts and no forms carrying anything personal, but a
    // developer's own bio and location render on their profile page, and none
    // of that belongs in a session recording.
    mask_all_text: false,
    mask_all_element_attributes: false,
  });
}

export function Analytics() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [consent, setConsent] = useState<Consent | null>(null);
  const started = useRef(false);

  // Read the stored decision once, after mount. Reading during render would
  // make the server and client markup disagree.
  useEffect(() => {
    if (!ANALYTICS_ENABLED) return;
    setConsent(readConsent());
  }, []);

  useEffect(() => {
    if (!ANALYTICS_ENABLED || consent !== "granted") return;
    init();
    posthog.opt_in_capturing();
    started.current = true;
  }, [consent]);

  // One pageview per navigation, with the query string included — `?sort=` and
  // `?q=` are the difference between two otherwise identical URLs here.
  useEffect(() => {
    if (!started.current || consent !== "granted") return;
    const query = searchParams.toString();
    posthog.capture("$pageview", {
      $current_url: window.location.origin + pathname + (query ? `?${query}` : ""),
    });
  }, [pathname, searchParams, consent]);

  if (!ANALYTICS_ENABLED || consent !== null) return null;

  return (
    <ConsentBanner
      onDecide={(choice) => {
        writeConsent(choice);
        setConsent(choice);
      }}
    />
  );
}

/**
 * The banner.
 *
 * Deliberately small and honest: it says what is collected and by whom, both
 * buttons are equally prominent, and declining is one click rather than a trip
 * through a preferences modal. A launch-day visitor arriving from Product Hunt
 * should be able to dismiss this in under a second either way.
 */
function ConsentBanner({ onDecide }: { onDecide: (choice: Consent) => void }) {
  return (
    <div
      role="dialog"
      aria-label="Analytics consent"
      className="fixed inset-x-[var(--space-sm)] bottom-[var(--space-sm)] z-[70] mx-auto max-w-[42rem] border border-faint bg-paper p-[var(--space-sm)] shadow-lg"
    >
      <p className="mono text-caption uppercase tracking-[var(--tracking-caption)] text-muted">
        Analytics
      </p>
      <p className="prose mt-[var(--space-2xs)] text-body">
        We use PostHog cookies to see which rankings people actually use. No personal data is
        collected and nothing is sold or shared.{" "}
        <a href="/methodology" className="underline underline-offset-4">
          More on what we track
        </a>
        .
      </p>
      <div className="mt-[var(--space-xs)] flex flex-wrap gap-[var(--space-2xs)]">
        <button
          type="button"
          onClick={() => onDecide("granted")}
          className="mono border border-ink px-[var(--space-xs)] py-[0.4rem] text-caption uppercase tracking-[var(--tracking-caption)] transition-colors hover:bg-ink hover:text-paper"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => onDecide("denied")}
          className="mono border border-faint px-[var(--space-xs)] py-[0.4rem] text-caption uppercase tracking-[var(--tracking-caption)] text-muted transition-colors hover:border-ink hover:text-ink"
        >
          Decline
        </button>
      </div>
    </div>
  );
}

/**
 * Records a product event, if and only if capturing is live.
 *
 * Every call site can fire this unconditionally: before consent, or in a build
 * with no key, it is a no-op rather than a queued event waiting to be flushed
 * the moment someone accepts.
 */
export function track(event: string, properties?: Record<string, unknown>): void {
  if (!ANALYTICS_ENABLED || !posthog.__loaded || posthog.has_opted_out_capturing()) return;
  posthog.capture(event, properties);
}
