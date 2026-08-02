import {
  getCityBoard,
  getCountryBoard,
  getFlaggedAccounts,
  getHistory,
  getManifest,
  getOrganizations,
  getRepositories,
  getUser,
  getWorldwide,
} from "@/lib/data";
import { calendarFor, monthlyFrom, streaksFrom } from "@/lib/calendar";
import { loadSearchIndex, type SearchRow } from "@/lib/api/search-index";
import type {
  HistorySeries,
  Leaderboard,
  LeaderboardEntry,
  Manifest,
  Organization,
  Place,
  RankedUser,
  Repository,
} from "@/lib/types";

/**
 * The one query layer.
 *
 * Both the MCP server (lib/mcp) and the REST mirror (app/api/v1) call these and
 * nothing else, so the two surfaces cannot drift apart. Everything here is a
 * thin composition over lib/data.ts and lib/calendar.ts — no new data logic and
 * no network.
 */

export const MAX_PAGE = 200;
export const DEFAULT_PAGE = 50;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

function paginate<T>(items: T[], limit = DEFAULT_PAGE, offset = 0): Page<T> {
  const size = Math.min(Math.max(1, limit), MAX_PAGE);
  const start = Math.max(0, offset);
  return {
    items: items.slice(start, start + size),
    total: items.length,
    limit: size,
    offset: start,
    hasMore: start + size < items.length,
  };
}

/* ------------------------------------------------------------------ scopes */

export type Scope =
  | { kind: "worldwide" }
  | { kind: "country"; id: string }
  | { kind: "city"; id: string };

/** Parses `worldwide`, `country:japan`, `city:jp-tokyo`. Bare ids are rejected
 *  rather than guessed at — `japan` and `jp-tokyo` are different namespaces and
 *  silently picking one would make the API lie about what it looked up. */
export function parseScope(scope: string): Scope | { error: string } {
  const value = scope.trim().toLowerCase();
  if (value === "worldwide") return { kind: "worldwide" };

  const [prefix, ...rest] = value.split(":");
  const id = rest.join(":");
  if (prefix === "country" && id) return { kind: "country", id };
  if (prefix === "city" && id) return { kind: "city", id };

  return {
    error:
      `Unrecognised scope "${scope}". Use "worldwide", "country:{id}" or "city:{id}" — ` +
      `call commitgraph_list_places for valid ids.`,
  };
}

export async function getLeaderboard(
  scope: string,
  limit = DEFAULT_PAGE,
  offset = 0,
): Promise<{ board: Leaderboard; page: Page<LeaderboardEntry> } | { error: string }> {
  const parsed = parseScope(scope);
  if ("error" in parsed) return parsed;

  const board =
    parsed.kind === "worldwide"
      ? await getWorldwide()
      : parsed.kind === "country"
        ? await getCountryBoard(parsed.id)
        : await getCityBoard(parsed.id);

  if (!board) {
    return {
      error: `No leaderboard for scope "${scope}". Call commitgraph_list_places for valid ids.`,
    };
  }

  return { board, page: paginate(board.entries, limit, offset) };
}

/* ------------------------------------------------------------------ places */

export interface PlaceFilters {
  kind?: "country" | "city" | "all";
  region?: string;
  countryId?: string;
  query?: string;
}

export async function listPlaces(
  filters: PlaceFilters = {},
  limit = DEFAULT_PAGE,
  offset = 0,
): Promise<Page<Place & { kind: "country" | "city" }>> {
  const manifest = await getManifest();
  const kind = filters.kind ?? "all";

  const tagged: (Place & { kind: "country" | "city" })[] = [
    ...(kind !== "city" ? manifest.countries.map((p) => ({ ...p, kind: "country" as const })) : []),
    ...(kind !== "country" ? manifest.cities.map((p) => ({ ...p, kind: "city" as const })) : []),
  ];

  const needle = filters.query?.trim().toLowerCase();
  const filtered = tagged.filter((place) => {
    if (filters.region && place.region !== filters.region) return false;
    if (filters.countryId && place.countryId !== filters.countryId) return false;
    if (needle && !`${place.name} ${place.id}`.toLowerCase().includes(needle)) return false;
    return true;
  });

  filtered.sort((a, b) => b.totalContributions - a.totalContributions || a.id.localeCompare(b.id));
  return paginate(filtered, limit, offset);
}

export async function getPlaceDetail(
  id: string,
): Promise<{ place: Place & { kind: "country" | "city" }; board: Leaderboard | null } | null> {
  const manifest = await getManifest();

  const country = manifest.countries.find((p) => p.id === id);
  if (country) {
    return { place: { ...country, kind: "country" }, board: await getCountryBoard(id) };
  }

  const city = manifest.cities.find((p) => p.id === id);
  if (city) return { place: { ...city, kind: "city" }, board: await getCityBoard(id) };

  return null;
}

/* -------------------------------------------------------------- developers */

export interface DeveloperFilters {
  query?: string;
  countryId?: string;
  cityId?: string;
  company?: string;
  minContributions?: number;
  maxContributions?: number;
  minFollowers?: number;
  hasProfile?: boolean;
  sort?: "contributions" | "followers" | "rank" | "login";
}

export async function searchDevelopers(
  filters: DeveloperFilters = {},
  limit = DEFAULT_PAGE,
  offset = 0,
): Promise<Page<SearchRow>> {
  const rows = await loadSearchIndex();
  const needle = filters.query?.trim().toLowerCase();
  const company = filters.company?.trim().toLowerCase();

  const matched = rows.filter((row) => {
    if (filters.countryId && row.countryId !== filters.countryId) return false;
    if (filters.cityId && row.cityId !== filters.cityId) return false;
    if (filters.hasProfile !== undefined && row.hasProfile !== filters.hasProfile) return false;
    if (filters.minContributions !== undefined && row.total < filters.minContributions) return false;
    if (filters.maxContributions !== undefined && row.total > filters.maxContributions) return false;
    if (filters.minFollowers !== undefined && row.followers < filters.minFollowers) return false;
    if (company && !(row.company ?? "").toLowerCase().includes(company)) return false;
    if (needle) {
      const haystack =
        `${row.login} ${row.name ?? ""} ${row.company ?? ""} ${row.location ?? ""}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  const sort = filters.sort ?? "contributions";
  matched.sort((a, b) => {
    if (sort === "followers") return b.followers - a.followers || a.login.localeCompare(b.login);
    if (sort === "login") return a.login.localeCompare(b.login);
    if (sort === "rank") {
      return (a.worldwideRank ?? Infinity) - (b.worldwideRank ?? Infinity) ||
        a.login.localeCompare(b.login);
    }
    return b.total - a.total || b.followers - a.followers || a.login.localeCompare(b.login);
  });

  return paginate(matched, limit, offset);
}

/**
 * A developer's full record.
 *
 * The snapshot ranks far more developers than it stores profile pages for, so a
 * miss here is usually *coverage*, not a bad login. Saying so explicitly — and
 * still returning the leaderboard row we do hold — is the difference between a
 * useful answer and one that reads as "no such user".
 */
export type DeveloperResult =
  | { found: true; user: RankedUser; calendar: ResolvedCalendar; indexRow: SearchRow | null }
  | { found: false; reason: "no-profile"; indexRow: SearchRow; note: string }
  | { found: false; reason: "unknown"; note: string };

export interface ResolvedCalendar {
  days: number[];
  estimated: boolean;
  monthly: number[];
  streak: { current: number; longest: number };
  busiestDay: number;
  activeDays: number;
}

export function resolveCalendar(
  login: string,
  total: number,
  stored: number[] | null,
): ResolvedCalendar {
  const { days, estimated } = calendarFor(login, total, stored);
  return {
    days,
    estimated,
    monthly: monthlyFrom(days),
    streak: streaksFrom(days),
    busiestDay: days.reduce((max, day) => (day > max ? day : max), 0),
    activeDays: days.filter((day) => day > 0).length,
  };
}

export async function getDeveloper(login: string): Promise<DeveloperResult> {
  const rows = await loadSearchIndex();
  const key = login.trim().toLowerCase().replace(/^@/, "");
  const indexRow = rows.find((row) => row.login.toLowerCase() === key) ?? null;

  const user = await getUser(indexRow?.login ?? login.replace(/^@/, ""));
  if (user) {
    return {
      found: true,
      user,
      calendar: resolveCalendar(user.login, user.contributions.total, user.calendar),
      indexRow,
    };
  }

  if (indexRow) {
    return {
      found: false,
      reason: "no-profile",
      indexRow,
      note:
        `${indexRow.login} is ranked in this snapshot but has no stored profile record. ` +
        `Profile records are generated for the worldwide top 500 and each place's leaders; ` +
        `everyone else is present as a leaderboard row only. The row is returned above.`,
    };
  }

  return {
    found: false,
    reason: "unknown",
    note:
      `No developer named "${login}" in this snapshot. The snapshot covers a ranked subset of ` +
      `GitHub, not every account — absence here does not mean the account does not exist.`,
  };
}

export async function compareDevelopers(logins: string[]): Promise<DeveloperResult[]> {
  return Promise.all(logins.map((login) => getDeveloper(login)));
}

/* -------------------------------------------------------------- aggregates */

export async function getStatistics() {
  const [manifest, worldwide] = await Promise.all([getManifest(), getWorldwide()]);
  const entries = worldwide.entries;

  const totalPublic = entries.reduce((sum, e) => sum + e.public, 0);
  const totalPrivate = entries.reduce((sum, e) => sum + e.private, 0);

  // Pearson correlation on log10 of both axes — the raw values span five orders
  // of magnitude, so an untransformed r would just describe the outliers.
  const pairs = entries.filter((e) => e.followers > 0 && e.total > 0);
  const xs = pairs.map((e) => Math.log10(e.followers));
  const ys = pairs.map((e) => Math.log10(e.total));
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / (values.length || 1);
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  const correlation = dx && dy ? num / Math.sqrt(dx * dy) : 0;

  const byRegion = new Map<string, { countries: number; users: number; contributions: number }>();
  for (const place of manifest.countries) {
    const region = place.region ?? "Unknown";
    const bucket = byRegion.get(region) ?? { countries: 0, users: 0, contributions: 0 };
    bucket.countries += 1;
    bucket.users += place.userCount;
    bucket.contributions += place.totalContributions;
    byRegion.set(region, bucket);
  }

  const sorted = [...entries].map((e) => e.total).sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

  return {
    snapshot: manifest.generatedAt,
    source: manifest.source,
    counts: manifest.counts,
    totals: manifest.totals,
    worldwideSample: entries.length,
    publicPrivateSplit: {
      public: totalPublic,
      private: totalPrivate,
      publicShare: totalPublic + totalPrivate > 0 ? totalPublic / (totalPublic + totalPrivate) : 0,
    },
    followersVsContributions: {
      correlationLogLog: Number(correlation.toFixed(4)),
      sample: pairs.length,
      note:
        "Pearson r on log10 of both axes. A low value is the finding, not a defect: " +
        "reputation and output are close to independent on GitHub.",
    },
    contributionPercentiles: {
      p10: percentile(0.1),
      p25: percentile(0.25),
      p50: percentile(0.5),
      p75: percentile(0.75),
      p90: percentile(0.9),
      p99: percentile(0.99),
    },
    byRegion: [...byRegion.entries()]
      .map(([region, value]) => ({ region, ...value }))
      .sort((a, b) => b.contributions - a.contributions),
  };
}

export async function getRankHistory(scope = "worldwide"): Promise<{
  history: HistorySeries | null;
  plottable: boolean;
  note: string;
}> {
  const history = await getHistory(scope);
  const dates = history?.dates.length ?? 0;
  return {
    history,
    plottable: dates >= 2,
    note:
      dates >= 2
        ? `${dates} snapshots recorded for scope "${scope}".`
        : dates === 1
          ? "One snapshot recorded. Movement needs a second scheduled crawl — this series stays " +
            "empty rather than inventing a trend."
          : `No history recorded for scope "${scope}".`,
  };
}

export {
  getManifest,
  getOrganizations,
  getRepositories,
  getFlaggedAccounts,
  type Manifest,
  type Organization,
  type Repository,
};
