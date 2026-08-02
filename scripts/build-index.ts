/**
 * Flattens the snapshot into data/index/search.json and data/index/order.json.
 *
 * The per-place files are the right shape for rendering a page and the wrong
 * shape for searching or for ranking the whole corpus: answering "which
 * developers work at Arch Linux" would otherwise mean opening 207 files, and
 * sorting everyone by followers would mean opening all of them and sorting the
 * union on every request.
 *
 * This walks them once at build time and emits:
 *
 *   search.json   one compact tuple per developer, deduplicated, carrying the
 *                 best rank known from each scope plus a streak
 *   order.json    three arrays of row indices — contributions, followers,
 *                 streak — so serving any sorted page is a slice
 *
 * The tuple layout lives in lib/api/search-index.ts and is imported rather than
 * duplicated here; positions written by hand on both sides is the one way this
 * format can silently rot.
 *
 *   pnpm build:index      (also runs automatically as `prebuild`)
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, writeJson } from "./lib/io.ts";
import {
  CALENDAR_MEASURED,
  F,
  HAS_PROFILE,
  TUPLE_LENGTH,
  searchRowSchema,
  type RowTuple,
} from "../lib/api/search-index.ts";
import { calendarFor, streaksFrom } from "../lib/calendar.ts";
import type { Leaderboard, Manifest, RankedUser } from "../lib/types.ts";

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function listBoards(dir: string): Promise<string[]> {
  try {
    const names = await readdir(path.join(DATA_DIR, dir));
    return names.filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

/** Must match lib/data.ts `shardOf` and the crawler. */
function shardOf(login: string): string {
  return login.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 2).padEnd(2, "_");
}

/**
 * GitHub's numeric account id, recovered from the avatar URL.
 *
 * Every avatar the API returns is `avatars.githubusercontent.com/u/{id}?…`, so
 * the id is already in the data — it just costs ~90 bytes a row to store it as
 * a URL. Anything that does not match keeps id 0 and falls back to
 * `github.com/{login}.png` at render time.
 */
function accountIdFrom(avatarUrl: string): number {
  const match = /\/u\/(\d+)/.exec(avatarUrl);
  return match ? Number(match[1]) : 0;
}

/** An interned string table, so `"china"` is written once and referenced by
 *  index a quarter of a million times. */
class Dictionary {
  private readonly ids = new Map<string, number>();
  readonly values: string[] = [];

  /** -1 is the null index: `values[-1]` is `undefined`, which decodes to null. */
  intern(value: string | null): number {
    if (!value) return -1;
    const existing = this.ids.get(value);
    if (existing !== undefined) return existing;
    const id = this.values.length;
    this.values.push(value);
    this.ids.set(value, id);
    return id;
  }
}

interface Draft {
  login: string;
  accountId: number;
  name: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  total: number;
  public: number;
  countryId: string | null;
  cityId: string | null;
  worldwideRank: number | null;
  countryRank: number | null;
  cityRank: number | null;
  previousRank: number | null;
}

/**
 * Streak, and whether it was measured.
 *
 * A fetched calendar gives a real streak. Without one, `calendarFor` derives a
 * deterministic estimate from the measured contribution total — the same login
 * always produces the same calendar — and `measured` is false so every surface
 * downstream can mark the value rather than pass it off as fact.
 */
async function streakFor(
  login: string,
  total: number,
  hasProfile: boolean,
): Promise<{ current: number; longest: number; measured: boolean }> {
  let stored: number[] | null = null;

  if (hasProfile) {
    const user = await readJson<RankedUser>(
      path.join(DATA_DIR, "user", shardOf(login), `${login}.json`),
    );
    stored = user?.calendar ?? null;
  }

  const { days, estimated } = calendarFor(login, total, stored);
  return { ...streaksFrom(days), measured: !estimated };
}

/** Bounded concurrency: a quarter of a million `readFile` calls fired at once
 *  exhausts the file-descriptor table long before it saturates the disk. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        out[index] = await fn(items[index], index);
      }
    }),
  );

  return out;
}

async function main(): Promise<void> {
  const manifest = await readJson<Manifest>(path.join(DATA_DIR, "manifest.json"));
  if (!manifest) {
    throw new Error("data/manifest.json is missing. Run `pnpm seed` or `pnpm crawl` first.");
  }

  const profileLogins = new Set(
    (await readJson<string[]>(path.join(DATA_DIR, "user", "index.json"))) ?? [],
  );

  const drafts = new Map<string, Draft>();

  /** Later scopes must not clobber a rank an earlier scope already established. */
  const absorb = (board: Leaderboard, scope: "worldwide" | "country" | "city") => {
    for (const entry of board.entries) {
      const existing = drafts.get(entry.login);
      const draft: Draft = existing ?? {
        login: entry.login,
        accountId: accountIdFrom(entry.avatarUrl),
        name: entry.name,
        company: entry.company,
        location: entry.location,
        followers: entry.followers,
        total: entry.total,
        public: entry.public,
        countryId: entry.countryId,
        cityId: entry.cityId,
        worldwideRank: null,
        countryRank: null,
        cityRank: null,
        previousRank: null,
      };

      if (scope === "worldwide") {
        draft.worldwideRank ??= entry.rank;
        // Movement is only ever recorded against the worldwide board, so this
        // is the one scope allowed to set it.
        draft.previousRank ??= entry.previousRank;
      }
      if (scope === "country") draft.countryRank ??= entry.rank;
      if (scope === "city") draft.cityRank ??= entry.rank;

      drafts.set(entry.login, draft);
    }
  };

  // The worldwide board is written as `worldwide.json` plus `worldwide.2.json`,
  // `worldwide.3.json` … once it outgrows a single reviewable file. Each shard
  // carries its own slice of ranks, and `absorb` dedupes by login, so reading
  // them in order reconstructs the whole board.
  for (const file of await listBoards("leaderboard")) {
    if (!/^worldwide(\.\d+)?\.json$/.test(file)) continue;
    const board = await readJson<Leaderboard>(path.join(DATA_DIR, "leaderboard", file));
    if (board) absorb(board, "worldwide");
  }

  for (const file of await listBoards("country")) {
    const board = await readJson<Leaderboard>(path.join(DATA_DIR, "country", file));
    if (board) absorb(board, "country");
  }

  for (const file of await listBoards("city")) {
    const board = await readJson<Leaderboard>(path.join(DATA_DIR, "city", file));
    if (board) absorb(board, "city");
  }

  // Sorted by login so the committed file diffs cleanly between runs, exactly
  // like every other artefact the pipeline writes. Every ordering downstream is
  // an index into this array, so it has to be settled before streaks are read.
  const sorted = [...drafts.values()].sort((a, b) => a.login.localeCompare(b.login));

  const streaks = await mapWithConcurrency(sorted, 32, (draft) =>
    streakFor(draft.login, draft.total, profileLogins.has(draft.login)),
  );

  const countries = new Dictionary();
  const cities = new Dictionary();

  const rows: RowTuple[] = sorted.map((draft, i) => {
    const streak = streaks[i];
    const flags =
      (profileLogins.has(draft.login) ? HAS_PROFILE : 0) |
      (streak.measured ? CALENDAR_MEASURED : 0);

    return [
      draft.login,
      draft.accountId,
      draft.name ?? "",
      draft.company ?? "",
      draft.location ?? "",
      draft.followers,
      draft.total,
      draft.public,
      countries.intern(draft.countryId),
      cities.intern(draft.cityId),
      draft.worldwideRank ?? 0,
      draft.countryRank ?? 0,
      draft.cityRank ?? 0,
      draft.previousRank ?? 0,
      flags,
      streak.current,
      streak.longest,
    ];
  });

  // The loader validates the envelope only — parsing a quarter of a million
  // rows through zod on every cold start would cost more than reading the file.
  // So the guarantee is made here instead, against the same schema, while it is
  // cheap and offline.
  verify(rows, countries.values, cities.values);

  await writeJson(path.join(DATA_DIR, "index", "search.json"), {
    generatedAt: manifest.generatedAt,
    countries: countries.values,
    cities: cities.values,
    rows,
  });

  /** Every ordering breaks ties on login, so a rerun over identical data
   *  produces an identical file rather than reshuffling equal rows. */
  const order = (compare: (a: number, b: number) => number) =>
    rows.map((_, i) => i).sort((a, b) => compare(a, b) || rows[a][F.LOGIN].localeCompare(rows[b][F.LOGIN]));

  await writeJson(path.join(DATA_DIR, "index", "order.json"), {
    generatedAt: manifest.generatedAt,
    contributions: order((a, b) => rows[b][F.TOTAL] - rows[a][F.TOTAL] ||
      rows[b][F.FOLLOWERS] - rows[a][F.FOLLOWERS]),
    followers: order((a, b) => rows[b][F.FOLLOWERS] - rows[a][F.FOLLOWERS] ||
      rows[b][F.TOTAL] - rows[a][F.TOTAL]),
    streak: order((a, b) => rows[b][F.STREAK_LONGEST] - rows[a][F.STREAK_LONGEST] ||
      rows[b][F.STREAK_CURRENT] - rows[a][F.STREAK_CURRENT] ||
      rows[b][F.TOTAL] - rows[a][F.TOTAL]),
  });

  const withProfile = rows.filter((row) => (row[F.FLAGS] & HAS_PROFILE) !== 0).length;
  const measured = rows.filter((row) => (row[F.FLAGS] & CALENDAR_MEASURED) !== 0).length;
  console.log(
    `Indexed ${rows.length} developers (${withProfile} with a profile record, ` +
      `${measured} with a measured calendar) from snapshot ${manifest.generatedAt}`,
  );
}

/**
 * Decodes every tuple back through `searchRowSchema`.
 *
 * This is the only place the two halves of the format meet, so it is the only
 * place a mismatch can be caught. It runs the real decode rather than a shape
 * check, which is what makes a wrong slot index fail here instead of surfacing
 * as a follower count in the location column.
 */
function verify(rows: RowTuple[], countries: string[], cities: string[]): void {
  for (const row of rows) {
    if (row.length !== TUPLE_LENGTH) {
      throw new Error(`Row for ${row[F.LOGIN]} has ${row.length} slots, expected ${TUPLE_LENGTH}`);
    }

    const total = row[F.TOTAL];
    const parsed = searchRowSchema.safeParse({
      login: row[F.LOGIN],
      accountId: row[F.ACCOUNT_ID],
      avatarUrl: "https://example.invalid/checked-at-render-time",
      name: row[F.NAME] || null,
      company: row[F.COMPANY] || null,
      location: row[F.LOCATION] || null,
      followers: row[F.FOLLOWERS],
      total,
      public: row[F.PUBLIC],
      private: Math.max(0, total - row[F.PUBLIC]),
      countryId: countries[row[F.COUNTRY]] ?? null,
      cityId: cities[row[F.CITY]] ?? null,
      worldwideRank: row[F.WORLDWIDE_RANK] || null,
      countryRank: row[F.COUNTRY_RANK] || null,
      cityRank: row[F.CITY_RANK] || null,
      previousRank: row[F.PREVIOUS_RANK] || null,
      hasProfile: (row[F.FLAGS] & HAS_PROFILE) !== 0,
      streak: { current: row[F.STREAK_CURRENT], longest: row[F.STREAK_LONGEST] },
      calendarMeasured: (row[F.FLAGS] & CALENDAR_MEASURED) !== 0,
    });

    if (!parsed.success) {
      throw new Error(`Row for ${row[F.LOGIN]} does not decode to a valid SearchRow`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
