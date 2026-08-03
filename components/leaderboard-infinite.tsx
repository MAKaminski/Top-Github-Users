"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LeaderboardRow } from "./leaderboard-rows";
import type { LeaderboardEntry } from "@/lib/types";

/**
 * Continues a server-rendered leaderboard page as the reader scrolls.
 *
 * The board is the whole corpus, so two things have to be true at once: any
 * rank must be reachable, and the DOM must not grow without bound. A quarter of
 * a million rows is roughly two million nodes — the tab does not survive it.
 *
 * The resolution is a **bounded window plus a jump**. Scrolling appends pages
 * until {@link MAX_ROWS} are on the page, then stops and says so; jumping to a
 * rank *replaces* the window rather than extending it. Dropping rows off the
 * top as new ones arrive would be the other option, but it moves the scroll
 * anchor under the reader's cursor, which is worse than an honest boundary.
 *
 * The first page is rendered on the server and passed in as `initial`, so this
 * component never renders an empty list and the route works with JavaScript
 * switched off.
 */

const PAGE = 200;
const MAX_ROWS = 5_000;

interface Props {
  scope: string;
  sort: string;
  initial: LeaderboardEntry[];
  /** Rank of `initial[0]`, one-based — the window does not always start at 1. */
  startRank: number;
  total: number;
}

export function LeaderboardInfinite({ scope, sort, initial, startRank, total }: Props) {
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [offset, setOffset] = useState(startRank - 1 + initial.length);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const windowStart = startRank - 1;
  const loaded = initial.length + rows.length;
  const atCap = loaded >= MAX_ROWS;
  const exhausted = offset >= total;

  const loadMore = useCallback(async () => {
    if (loading || atCap || exhausted) return;
    setLoading(true);
    try {
      const response = await fetch(
        `/api/v1/leaderboard/${encodeURIComponent(scope)}?sort=${sort}&limit=${PAGE}&offset=${offset}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { items?: LeaderboardEntry[] };
      const items = body.items ?? [];
      setRows((current) => [...current, ...items]);
      setOffset((current) => current + items.length);
      // A page that comes back empty when the total says otherwise would
      // otherwise spin forever against the sentinel.
      if (items.length === 0) setError("No further rows were returned.");
      else setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more rows.");
    } finally {
      setLoading(false);
    }
  }, [atCap, exhausted, loading, offset, scope, sort]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    // rootMargin gives the fetch a screen of runway so rows are usually in place
    // before the reader reaches them.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void loadMore();
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  return (
    <>
      {rows.map((entry) => (
        <LeaderboardRow key={entry.login} entry={entry} sparkline={false} />
      ))}

      <div ref={sentinel} aria-hidden="true" className="h-px" />

      <p
        role="status"
        aria-live="polite"
        className="mono py-[var(--space-sm)] text-center text-caption uppercase tracking-[var(--tracking-caption)] text-muted"
      >
        {error
          ? error
          : loading
            ? "Loading…"
            : exhausted
              ? `End of the board — ${total.toLocaleString("en-US")} developers.`
              : atCap
                ? `Showing ranks ${(windowStart + 1).toLocaleString("en-US")}–` +
                  `${(windowStart + loaded).toLocaleString("en-US")} of ` +
                  `${total.toLocaleString("en-US")}. Jump to a rank to continue.`
                : ""}
      </p>
    </>
  );
}
