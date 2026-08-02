/**
 * The shapes every page and chart reads. `lib/schema.ts` mirrors these as zod
 * schemas — change one, change the other.
 */

/**
 * How a field was obtained. The site never presents an estimate as a
 * measurement: anything marked `estimated` is labelled in the UI and explained
 * on /methodology.
 */
export type Provenance = "measured" | "estimated" | "unavailable";

export interface Contributions {
  /** public + private over the trailing window. */
  total: number;
  public: number;
  private: number;
  /** Only the GraphQL enrichment pass can break the total down this far. */
  commits: number | null;
  pullRequests: number | null;
  issues: number | null;
  reviews: number | null;
}

export interface LanguageShare {
  name: string;
  /** 0..1 share of the user's tracked code. */
  share: number;
}

export interface Ranks {
  worldwide: number | null;
  country: number | null;
  city: number | null;
}

export interface RankedUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  location: string | null;
  company: string | null;
  bio: string | null;
  followers: number;
  publicRepos: number | null;

  contributions: Contributions;

  /**
   * 371 daily counts (53 weeks x 7 days), oldest first — the heatmap.
   * Flat numbers rather than dated objects because this is the largest field
   * per user and the date axis is derivable from the snapshot date.
   */
  calendar: number[] | null;
  calendarSource: Provenance;

  languages: LanguageShare[];
  languageSource: Provenance;

  streak: { current: number; longest: number } | null;

  rank: Ranks;
  countryId: string | null;
  cityId: string | null;

  /**
   * True when the account's activity is implausible for a human and is almost
   * certainly automation. Flagged accounts are excluded from every default
   * ranking and listed openly on /methodology rather than quietly dropped.
   */
  flagged: boolean;
}

/** A leaderboard row — the trimmed record used by index pages. */
export interface LeaderboardEntry {
  rank: number;
  login: string;
  name: string | null;
  avatarUrl: string;
  location: string | null;
  company: string | null;
  followers: number;
  total: number;
  public: number;
  private: number;
  countryId: string | null;
  cityId: string | null;
  /** Rank at the previous snapshot, null when there is no history yet. */
  previousRank: number | null;
  /** True when a profile page exists for this login; otherwise the row links
   *  out to github.com rather than to a page we did not build. */
  hasProfile: boolean;
}

export interface Place {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 where known — drives the choropleth and flags. */
  iso2: string | null;
  /** Countries only. */
  region: string | null;
  /** Cities only. */
  countryId: string | null;
  userCount: number;
  totalContributions: number;
  totalFollowers: number;
  /** Top few logins, for card previews without loading the full file. */
  top: { login: string; avatarUrl: string; total: number }[];
}

export interface Organization {
  rank: number;
  login: string;
  name: string | null;
  avatarUrl: string;
  location: string | null;
  followers: number;
  publicRepos: number | null;
}

export interface Repository {
  rank: number;
  nameWithOwner: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  ownerAvatarUrl: string;
}

export interface Leaderboard {
  scope: string;
  name: string;
  generatedAt: string;
  entries: LeaderboardEntry[];
}

/** Compacted rank history — what the bump chart and bar race consume.
 *  Deliberately not the full snapshots, which stay on disk but are never read
 *  at render time. */
export interface HistorySeries {
  scope: string;
  dates: string[];
  series: { login: string; ranks: (number | null)[]; totals: (number | null)[] }[];
}

export interface Manifest {
  generatedAt: string;
  /** Where this snapshot came from, so the UI can be honest about it. */
  source: "crawler" | "bootstrap";
  sourceNote: string;
  counts: {
    users: number;
    countries: number;
    cities: number;
    organizations: number;
    repositories: number;
    /** Accounts excluded from rankings as automation. */
    flagged: number;
  };
  totals: {
    contributions: number;
    publicContributions: number;
    privateContributions: number;
    followers: number;
  };
  snapshotDates: string[];
  countries: Place[];
  cities: Place[];
}
