import { z } from "zod";

/** Mirrors lib/types.ts. Every file read off disk is validated through here so
 *  a malformed crawl commit fails the build rather than rendering nonsense. */

export const provenanceSchema = z.enum(["measured", "estimated", "unavailable"]);

export const contributionsSchema = z.object({
  total: z.number().int().nonnegative(),
  public: z.number().int().nonnegative(),
  private: z.number().int().nonnegative(),
  commits: z.number().int().nonnegative().nullable(),
  pullRequests: z.number().int().nonnegative().nullable(),
  issues: z.number().int().nonnegative().nullable(),
  reviews: z.number().int().nonnegative().nullable(),
});

export const languageShareSchema = z.object({
  name: z.string(),
  share: z.number().min(0).max(1),
});

export const rankedUserSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string(),
  location: z.string().nullable(),
  company: z.string().nullable(),
  bio: z.string().nullable(),
  followers: z.number().int().nonnegative(),
  publicRepos: z.number().int().nonnegative().nullable(),
  contributions: contributionsSchema,
  calendar: z.array(z.number().int().nonnegative()).nullable(),
  calendarSource: provenanceSchema,
  languages: z.array(languageShareSchema),
  languageSource: provenanceSchema,
  streak: z.object({ current: z.number().int(), longest: z.number().int() }).nullable(),
  rank: z.object({
    worldwide: z.number().int().nullable(),
    country: z.number().int().nullable(),
    city: z.number().int().nullable(),
  }),
  countryId: z.string().nullable(),
  cityId: z.string().nullable(),
  flagged: z.boolean(),
});

export const leaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string(),
  location: z.string().nullable(),
  company: z.string().nullable(),
  followers: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  public: z.number().int().nonnegative(),
  private: z.number().int().nonnegative(),
  countryId: z.string().nullable(),
  cityId: z.string().nullable(),
  previousRank: z.number().int().nullable(),
  hasProfile: z.boolean(),
  /** Attached from the search index when a board is served, not stored in the
   *  committed board files — see `lib/types.ts`. */
  streak: z.object({ current: z.number().int(), longest: z.number().int() }).nullish(),
  calendarMeasured: z.boolean().nullish(),
});

export const placeSchema = z.object({
  id: z.string(),
  name: z.string(),
  iso2: z.string().nullable(),
  region: z.string().nullable(),
  countryId: z.string().nullable(),
  userCount: z.number().int().nonnegative(),
  totalContributions: z.number().int().nonnegative(),
  totalFollowers: z.number().int().nonnegative(),
  top: z.array(
    z.object({ login: z.string(), avatarUrl: z.string(), total: z.number().int() }),
  ),
});

export const organizationSchema = z.object({
  rank: z.number().int().positive(),
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string(),
  location: z.string().nullable(),
  followers: z.number().int().nonnegative(),
  publicRepos: z.number().int().nonnegative().nullable(),
});

export const repositorySchema = z.object({
  rank: z.number().int().positive(),
  nameWithOwner: z.string(),
  description: z.string().nullable(),
  stars: z.number().int().nonnegative(),
  forks: z.number().int().nonnegative(),
  language: z.string().nullable(),
  ownerAvatarUrl: z.string(),
});

export const leaderboardSchema = z.object({
  scope: z.string(),
  name: z.string(),
  generatedAt: z.string(),
  entries: z.array(leaderboardEntrySchema),
});

export const historySeriesSchema = z.object({
  scope: z.string(),
  dates: z.array(z.string()),
  series: z.array(
    z.object({
      login: z.string(),
      ranks: z.array(z.number().int().nullable()),
      totals: z.array(z.number().int().nullable()),
    }),
  ),
});

export const manifestSchema = z.object({
  generatedAt: z.string(),
  source: z.enum(["crawler", "bootstrap"]),
  sourceNote: z.string(),
  counts: z.object({
    users: z.number().int(),
    countries: z.number().int(),
    cities: z.number().int(),
    organizations: z.number().int(),
    repositories: z.number().int(),
    flagged: z.number().int(),
  }),
  totals: z.object({
    contributions: z.number().int(),
    publicContributions: z.number().int(),
    privateContributions: z.number().int(),
    followers: z.number().int(),
  }),
  snapshotDates: z.array(z.string()),
  countries: z.array(placeSchema),
  cities: z.array(placeSchema),
});
