/**
 * API responses in, `RankedUser` out.
 *
 * Pure functions only — no network, no disk. That is what lets the fixture test
 * assert on the real mapping, and what keeps two runs over the same input
 * byte-identical.
 *
 * The ranking rules here are the seeder's, deliberately: contributions desc,
 * followers desc, login ascending. If the crawler ordered ties differently from
 * `scripts/bootstrap-seed.ts` the first crawl would rewrite every file for no
 * reason.
 */

import { CALENDAR_DAYS, streaksFrom } from "../../lib/calendar.ts";
import type {
  Contributions,
  LanguageShare,
  LeaderboardEntry,
  Provenance,
  RankedUser,
} from "../../lib/types.ts";
import { COUNTRIES, type CountryDef } from "../lib/countries.ts";
import { parseCity } from "../lib/city.ts";
import type { ContributionWeek, GraphUser } from "./github.ts";

/**
 * Automation threshold — the seeder's number and the seeder's reasoning.
 *
 * 300,000 contributions in a twelve-month window is over 820 every single day
 * without a break. Genuine high-volume maintainers land in the low hundreds of
 * thousands, so this keeps them and removes only what no person could produce.
 * Flagged accounts are listed openly on /methodology, never quietly dropped.
 */
export const AUTOMATION_THRESHOLD = 300_000;

/** Enough of a language spread to be informative without bloating each file. */
const MAX_LANGUAGES = 8;

export interface TransformOptions {
  /** The country whose search turned this user up, when the tier knows it. */
  country?: CountryDef | null;
  avatarUrl?: string;
}

/**
 * Flattens the 53 weeks of contribution days into the flat 371-length array the
 * heatmap reads, oldest first.
 *
 * GitHub's first and last weeks are partial, so the raw flattening is usually a
 * few days short or long. We trim from the front and pad from the front, which
 * keeps the newest day at the end — the only alignment the UI assumes.
 */
export function calendarFrom(weeks: ContributionWeek[]): number[] {
  const days = weeks
    .flatMap((week) => week.contributionDays ?? [])
    .filter((day) => typeof day?.date === "string")
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => Math.max(0, Math.floor(day.contributionCount ?? 0)));

  if (days.length >= CALENDAR_DAYS) return days.slice(days.length - CALENDAR_DAYS);
  return [...new Array<number>(CALENDAR_DAYS - days.length).fill(0), ...days];
}

/**
 * Private contributions are counted in the calendar total but never attributed
 * to a day, so `restrictedContributionsCount` is the private slice of that same
 * total rather than something to add to it. The per-type counts below it are
 * public-only, which is why they do not sum to `total`.
 */
export function contributionsFrom(user: GraphUser): Contributions {
  const collection = user.contributionsCollection;
  const total = Math.max(0, Math.floor(collection.contributionCalendar.totalContributions ?? 0));
  const restricted = Math.max(0, Math.floor(collection.restrictedContributionsCount ?? 0));
  const priv = Math.min(total, restricted);

  return {
    total,
    public: total - priv,
    private: priv,
    commits: nonNegative(collection.totalCommitContributions),
    pullRequests: nonNegative(collection.totalPullRequestContributions),
    issues: nonNegative(collection.totalIssueContributions),
    reviews: nonNegative(collection.totalPullRequestReviewContributions),
  };
}

/**
 * Primary language of a user's own repositories, as a share. Only produced when
 * the enrichment asked for repository nodes; the base query does not, and an
 * absent breakdown is reported as `unavailable` rather than guessed at.
 */
export function languagesFrom(user: GraphUser): {
  languages: LanguageShare[];
  source: Provenance;
} {
  const nodes = user.repositories.nodes;
  if (!nodes) return { languages: [], source: "unavailable" };

  const counts = new Map<string, number>();
  for (const node of nodes) {
    const name = node?.primaryLanguage?.name;
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const tracked = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (tracked === 0) return { languages: [], source: "unavailable" };

  const languages = [...counts.entries()]
    .map(([name, count]) => ({ name, share: round4(count / tracked) }))
    .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name))
    .slice(0, MAX_LANGUAGES);

  return { languages, source: "measured" };
}

/**
 * Free-text location to a known country. Only used by the worldwide tier, where
 * the search query carried no country of its own; place-scoped tiers pass the
 * country they searched and never come through here.
 */
export function matchCountry(location: string | null): CountryDef | null {
  if (!location) return null;
  const haystack = location.toLowerCase();
  const segments = haystack
    .split(/[,/|·•]/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const country of COUNTRIES) {
    const name = country.name.toLowerCase();
    if (segments.includes(name)) return country;
    if (segments.includes(country.iso2.toLowerCase())) return country;
  }
  return null;
}

export function toRankedUser(user: GraphUser, options: TransformOptions = {}): RankedUser {
  const contributions = contributionsFrom(user);
  const calendar = calendarFrom(user.contributionsCollection.contributionCalendar.weeks ?? []);
  const location = clean(user.location);
  const country = options.country ?? matchCountry(location);
  const city = country ? parseCity(location, country) : null;
  const languages = languagesFrom(user);

  return {
    login: user.login,
    name: clean(user.name),
    avatarUrl: options.avatarUrl ?? user.avatarUrl ?? "",
    location,
    company: clean(user.company),
    bio: clean(user.bio),
    followers: nonNegative(user.followers?.totalCount) ?? 0,
    publicRepos: nonNegative(user.repositories?.totalCount),
    contributions,
    calendar,
    calendarSource: "measured",
    languages: languages.languages,
    languageSource: languages.source,
    streak: streaksFrom(calendar),
    rank: { worldwide: null, country: null, city: null },
    countryId: country?.slug ?? null,
    cityId: city?.id ?? null,
    flagged: contributions.total > AUTOMATION_THRESHOLD,
  };
}

/**
 * Deterministic ordering: contributions desc, then followers desc, then login
 * ascending. Ties broken by login means equal-ranked users never swap places
 * between runs, which is what keeps the committed diff small.
 */
export function byRank(a: RankedUser, b: RankedUser): number {
  return (
    b.contributions.total - a.contributions.total ||
    b.followers - a.followers ||
    a.login.localeCompare(b.login)
  );
}

/** The same ordering over already-trimmed leaderboard rows, for the passes that
 *  merge boards off disk rather than freshly crawled users. */
export function byEntryRank(a: LeaderboardEntry, b: LeaderboardEntry): number {
  return b.total - a.total || b.followers - a.followers || a.login.localeCompare(b.login);
}

export type RankField = "worldwide" | "country" | "city";

/** Sorts, numbers from 1, and returns the ordered list. Mutates `rank` in place
 *  because a user object is shared between the worldwide, country and city
 *  passes and must end up carrying all three. */
export function assignRanks(users: RankedUser[], field: RankField): RankedUser[] {
  const ordered = [...users].sort(byRank);
  ordered.forEach((user, index) => {
    user.rank[field] = index + 1;
  });
  return ordered;
}

/** Last write wins on login, so a re-crawl replaces rather than duplicates. */
export function dedupeByLogin(users: RankedUser[]): RankedUser[] {
  const byLogin = new Map<string, RankedUser>();
  for (const user of users) byLogin.set(user.login, user);
  return [...byLogin.values()];
}

export function toLeaderboardEntry(
  user: RankedUser,
  rank: number,
  options: { previousRank?: number | null; hasProfile?: boolean } = {},
): LeaderboardEntry {
  return {
    rank,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    location: user.location,
    company: user.company,
    followers: user.followers,
    total: user.contributions.total,
    public: user.contributions.public,
    private: user.contributions.private,
    countryId: user.countryId,
    cityId: user.cityId,
    previousRank: options.previousRank ?? null,
    hasProfile: options.hasProfile ?? false,
  };
}

/** Must match `shardOf` in lib/data.ts and scripts/bootstrap-seed.ts. */
export function shardOf(login: string): string {
  const key = login.toLowerCase().replace(/[^a-z0-9]/g, "_");
  return key.slice(0, 2).padEnd(2, "_");
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nonNegative(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

/** Four places is finer than any label the UI renders and keeps the JSON from
 *  churning on floating-point noise between runs. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
