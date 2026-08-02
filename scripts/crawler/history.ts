/**
 * Rank history — `data/history/{scope}.json`.
 *
 * The bump chart wants "where was this login on each snapshot", not the
 * snapshots themselves. Full snapshots stay on disk as leaderboards; this file
 * is the compacted `{login, date, rank, total}` series pivoted into parallel
 * arrays, which is both what the chart consumes and what keeps the committed
 * history from growing a megabyte a week.
 *
 * Retention: daily points for 30 days, then one a week for a year, then one a
 * month. Ages are measured from the newest snapshot rather than from the wall
 * clock, so re-running the compaction over the same file is a no-op.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeJson, DATA_DIR } from "../lib/io.ts";
import type { HistorySeries } from "../../lib/types.ts";

const DAY_MS = 86_400_000;

export const DAILY_WINDOW_DAYS = 30;
export const WEEKLY_WINDOW_DAYS = 365;

/** How many logins a series tracks. The chart plots far fewer; the surplus is
 *  what lets a rank recover after a few snapshots outside the top of the board. */
export const DEFAULT_DEPTH = 25;
const RETAINED_MULTIPLE = 4;

export interface HistoryPoint {
  login: string;
  rank: number;
  total: number;
}

export function emptySeries(scope: string): HistorySeries {
  return { scope, dates: [], series: [] };
}

/**
 * Adds one snapshot column. Re-running on a date that is already the newest
 * overwrites it instead of appending a duplicate, so a re-triggered workflow
 * produces the same file rather than a doubled day.
 */
export function appendSnapshot(
  previous: HistorySeries | null,
  scope: string,
  date: string,
  points: HistoryPoint[],
  depth: number = DEFAULT_DEPTH,
): HistorySeries {
  const base = previous ?? emptySeries(scope);
  const replacing = base.dates[base.dates.length - 1] === date;
  const dates = replacing ? [...base.dates] : [...base.dates, date];
  const width = dates.length;

  // Existing rows keep every column but the one we are about to write; a
  // replaced date drops its old column here, an appended date has none to drop.
  const history = width - 1;
  const rows = new Map<string, { ranks: (number | null)[]; totals: (number | null)[] }>();
  for (const row of base.series) {
    rows.set(row.login, {
      ranks: padTo(row.ranks.slice(0, history), history),
      totals: padTo(row.totals.slice(0, history), history),
    });
  }

  const fresh = new Map(points.map((point) => [point.login, point]));
  for (const login of fresh.keys()) {
    if (rows.has(login)) continue;
    // Someone new to the board has no past; leading nulls, not a fabricated one.
    rows.set(login, { ranks: padTo([], history), totals: padTo([], history) });
  }

  const series = [...rows.entries()].map(([login, row]) => {
    const point = fresh.get(login) ?? null;
    return {
      login,
      ranks: [...row.ranks, point ? point.rank : null],
      totals: [...row.totals, point ? point.total : null],
    };
  });

  return orderSeries({ scope, dates, series }, depth);
}

/**
 * Drops columns the retention policy no longer keeps, then drops any login left
 * with nothing to plot.
 */
export function applyRetention(series: HistorySeries): HistorySeries {
  if (series.dates.length === 0) return series;

  const newest = Date.parse(`${series.dates[series.dates.length - 1]}T00:00:00Z`);
  if (!Number.isFinite(newest)) return series;

  // One survivor per bucket, and the newest date in a bucket is the survivor —
  // a chart should end on the most recent reading, not a week-old one.
  const survivors = new Map<string, number>();
  series.dates.forEach((date, index) => {
    const age = Math.max(0, Math.round((newest - Date.parse(`${date}T00:00:00Z`)) / DAY_MS));
    survivors.set(bucketFor(age), index);
  });

  const keep = [...survivors.values()].sort((a, b) => a - b);
  if (keep.length === series.dates.length) return series;

  return {
    scope: series.scope,
    dates: keep.map((index) => series.dates[index]),
    series: series.series
      .map((row) => ({
        login: row.login,
        ranks: keep.map((index) => row.ranks[index] ?? null),
        totals: keep.map((index) => row.totals[index] ?? null),
      }))
      .filter((row) => row.ranks.some((rank) => rank !== null)),
  };
}

function bucketFor(age: number): string {
  if (age <= DAILY_WINDOW_DAYS) return `d${age}`;
  if (age <= WEEKLY_WINDOW_DAYS) return `w${Math.floor(age / 7)}`;
  return `m${Math.floor(age / 30)}`;
}

/**
 * Newest rank ascending, logins that have dropped off the bottom last. Stable
 * on login so the file does not reshuffle when two people share a rank.
 */
function orderSeries(series: HistorySeries, depth: number): HistorySeries {
  const scored = series.series.map((row) => ({
    row,
    newest: row.ranks[row.ranks.length - 1],
    best: bestRank(row.ranks),
  }));

  const ranked = scored
    .filter((entry) => entry.best !== null && entry.best <= depth)
    .sort(
      (a, b) =>
        (a.newest ?? Number.MAX_SAFE_INTEGER) - (b.newest ?? Number.MAX_SAFE_INTEGER) ||
        (a.best ?? 0) - (b.best ?? 0) ||
        a.row.login.localeCompare(b.row.login),
    )
    .slice(0, depth * RETAINED_MULTIPLE);

  return { scope: series.scope, dates: series.dates, series: ranked.map((entry) => entry.row) };
}

function bestRank(ranks: (number | null)[]): number | null {
  let best: number | null = null;
  for (const rank of ranks) {
    if (rank === null) continue;
    if (best === null || rank < best) best = rank;
  }
  return best;
}

function padTo(values: (number | null)[], width: number): (number | null)[] {
  if (values.length >= width) return values.slice(0, width);
  return [...new Array<number | null>(width - values.length).fill(null), ...values];
}

export async function readHistory(
  file: string,
  dataDir: string = DATA_DIR,
): Promise<HistorySeries | null> {
  try {
    const raw = await readFile(path.join(dataDir, "history", `${file}.json`), "utf8");
    return JSON.parse(raw) as HistorySeries;
  } catch {
    return null;
  }
}

/** Reads, appends, compacts and writes in one step — the only call the crawler
 *  needs to make per scope. */
export async function updateHistory(options: {
  file: string;
  scope: string;
  date: string;
  points: HistoryPoint[];
  depth?: number;
  dataDir?: string;
}): Promise<HistorySeries> {
  const dataDir = options.dataDir ?? DATA_DIR;
  const previous = await readHistory(options.file, dataDir);
  const appended = appendSnapshot(
    previous,
    options.scope,
    options.date,
    options.points,
    options.depth ?? DEFAULT_DEPTH,
  );
  const compacted = applyRetention(appended);
  await writeJson(path.join(dataDir, "history", `${options.file}.json`), compacted);
  return compacted;
}

/** The previous snapshot's ranks, for the movement arrows on each row. Call it
 *  with the series as read from disk, before this run's column is appended. */
export function previousRanks(series: HistorySeries | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!series || series.dates.length < 1) return out;
  const column = series.dates.length - 1;
  for (const row of series.series) {
    const rank = row.ranks[column];
    if (typeof rank === "number") out.set(row.login, rank);
  }
  return out;
}
