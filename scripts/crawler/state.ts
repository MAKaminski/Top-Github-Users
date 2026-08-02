/**
 * Crawl state — `data/_state.json`.
 *
 * A single run cannot cover every place: search is 30 requests a minute and a
 * GitHub Actions job is not free. So a run works through its tier until the
 * budget is gone and records where it stopped; the next run picks the same list
 * up from there. Without this the crawler would re-crawl the alphabetically
 * first countries forever and never reach the last ones.
 *
 * The file lives alongside the snapshot and is committed with it, because the
 * cursor is only meaningful next to the data it produced.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeJson, DATA_DIR } from "../lib/io.ts";

export const STATE_FILE = "_state.json";
const STATE_VERSION = 1;

export interface PlaceState {
  /** ISO date of the last run that finished this place, null while in progress. */
  lastCrawledAt: string | null;
  /** Next search page to fetch. 1 means "start from the top". */
  cursor: number;
  /** True once the place has been walked to the end of its result set. */
  done: boolean;
}

export interface CrawlState {
  version: number;
  places: Record<string, PlaceState>;
  /**
   * ETags keyed by request URL. A REST response that comes back 304 does not
   * count against the primary rate limit, so on a re-crawl of mostly-unchanged
   * data this store is what makes the pass nearly free. Persisted next to the
   * records it describes, per the standing rules.
   */
  etags: Record<string, string>;
  /**
   * GH Archive hours already folded into discovery, so a re-run pulls only the
   * new ones instead of redownloading the whole window. Values are the event
   * count observed, which also lets a run report coverage.
   */
  archiveHours: Record<string, number>;
}

const FRESH: PlaceState = { lastCrawledAt: null, cursor: 1, done: false };

export function emptyState(): CrawlState {
  return { version: STATE_VERSION, places: {}, etags: {}, archiveHours: {} };
}

/**
 * A ConditionalStore backed by the persisted state, so ETags survive a run.
 * Handed to GitHubClient; nothing else should touch `state.etags` directly.
 */
export function conditionalStore(state: CrawlState) {
  return {
    get: (key: string) => state.etags[key],
    set: (key: string, etag: string) => {
      state.etags[key] = etag;
    },
  };
}

/** Hours not yet folded in, newest first. */
export function pendingHours(state: CrawlState, hours: string[]): string[] {
  return hours.filter((hour) => !(hour in state.archiveHours));
}

export function recordHour(state: CrawlState, hour: string, events: number): void {
  state.archiveHours[hour] = events;
}

/**
 * Old hours fall out of every window we would ever ask for, and the state file
 * is committed to git — left unbounded it would grow a line a day forever.
 */
export function pruneHours(state: CrawlState, keep: number): void {
  const hours = Object.keys(state.archiveHours).sort();
  for (const hour of hours.slice(0, Math.max(0, hours.length - keep))) {
    delete state.archiveHours[hour];
  }
}

export async function readState(dataDir: string = DATA_DIR): Promise<CrawlState> {
  let raw: string;
  try {
    raw = await readFile(path.join(dataDir, STATE_FILE), "utf8");
  } catch {
    return emptyState();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CrawlState>;
    // A state file from an older layout is discarded rather than migrated: the
    // worst case is one wasted re-crawl, and the snapshot itself is untouched.
    if (parsed.version !== STATE_VERSION || typeof parsed.places !== "object") return emptyState();
    return {
      version: STATE_VERSION,
      places: parsed.places ?? {},
      // Added after v1 shipped. Absent in an older file is not a reason to
      // discard the cursors — just start those maps empty.
      etags: parsed.etags ?? {},
      archiveHours: parsed.archiveHours ?? {},
    };
  } catch {
    return emptyState();
  }
}

export async function writeState(state: CrawlState, dataDir: string = DATA_DIR): Promise<void> {
  await writeJson(path.join(dataDir, STATE_FILE), state);
}

export function placeState(state: CrawlState, key: string): PlaceState {
  return state.places[key] ?? { ...FRESH };
}

/** Records that a place is partway through — the next run resumes at `cursor`. */
export function recordProgress(state: CrawlState, key: string, cursor: number): void {
  const current = placeState(state, key);
  state.places[key] = { ...current, cursor, done: false };
}

export function recordCompletion(state: CrawlState, key: string, at: string): void {
  state.places[key] = { lastCrawledAt: at, cursor: 1, done: true };
}

/**
 * Whether a place is worth spending budget on. Places that failed or ran out of
 * budget mid-way come back as due immediately; finished ones wait out the tier's
 * interval so a daily job does not redo a monthly tier.
 */
export function isDue(
  state: CrawlState,
  key: string,
  maxAgeDays: number,
  now: Date = new Date(),
): boolean {
  const current = placeState(state, key);
  if (!current.done || !current.lastCrawledAt) return true;

  const last = Date.parse(`${current.lastCrawledAt}T00:00:00Z`);
  if (!Number.isFinite(last)) return true;

  return (now.getTime() - last) / 86_400_000 >= maxAgeDays;
}

/** Due places first, then the ones idle longest — so a truncated run always
 *  spends its budget on the stalest data. */
export function orderByStaleness(state: CrawlState, keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const left = placeState(state, a);
    const right = placeState(state, b);
    const leftAge = left.lastCrawledAt ?? "";
    const rightAge = right.lastCrawledAt ?? "";
    return leftAge.localeCompare(rightAge) || a.localeCompare(b);
  });
}
