/**
 * Typed GitHub client for the crawler.
 *
 * Two surfaces, because GitHub gives us no single one that answers the
 * question: REST search finds *who* is in a place (and is the only thing that
 * ranks by followers), GraphQL then tells us what those people actually did.
 * Everything the crawler needs goes through this file so the rate-limit
 * bookkeeping lives in exactly one place.
 *
 * The decoders are exported separately from the transport. The fixture client
 * in `fixtures.ts` reuses them verbatim, so the offline test exercises the same
 * parsing path a live run would.
 */

import { setTimeout as sleep } from "node:timers/promises";

const API_ROOT = "https://api.github.com";
const GRAPHQL_ENDPOINT = `${API_ROOT}/graphql`;
const USER_AGENT = "commitgraph-crawler";

/**
 * Search refuses to page past the thousandth result no matter what
 * `total_count` claims, so a place with 40,000 developers is still only ever
 * knowable down to its top 1000. Stated on /methodology rather than hidden.
 */
export const SEARCH_PER_PAGE = 100;
export const SEARCH_MAX_PAGES = 10;
export const SEARCH_RESULT_CAP = SEARCH_PER_PAGE * SEARCH_MAX_PAGES;

/** Authenticated search has its own 30-per-minute budget, far tighter than the
 *  5000-per-hour core limit, and exceeding it earns a secondary-limit block. */
const SEARCH_REQUESTS_PER_MINUTE = 30;

/** Alias batching. 25 logins keeps a single request well inside the node limit
 *  even for accounts with enormous calendars; the measured cost moves it. */
export const GRAPHQL_BATCH_START = 25;
const GRAPHQL_BATCH_MIN = 5;
const GRAPHQL_BATCH_MAX = 50;
/** Points we are willing to spend per enrichment request. */
const GRAPHQL_TARGET_COST = 25;
/** Below this many points left in the hour, wait for the reset rather than
 *  burning the remainder and having the run die mid-place. */
const GRAPHQL_RESERVE = 200;

const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 1000;
const MAX_BACKOFF_MS = 60_000;

export interface SearchUser {
  login: string;
  avatarUrl: string;
}

export interface SearchRepository {
  nameWithOwner: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  ownerAvatarUrl: string;
}

export interface ContributionDay {
  date: string;
  contributionCount: number;
}

export interface ContributionWeek {
  contributionDays: ContributionDay[];
}

export interface GraphUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  location: string | null;
  company: string | null;
  bio: string | null;
  followers: { totalCount: number };
  repositories: {
    totalCount: number;
    nodes?: ({ primaryLanguage: { name: string } | null } | null)[] | null;
  };
  contributionsCollection: {
    totalCommitContributions: number;
    totalPullRequestContributions: number;
    totalIssueContributions: number;
    totalPullRequestReviewContributions: number;
    restrictedContributionsCount: number;
    contributionCalendar: {
      totalContributions: number;
      weeks: ContributionWeek[];
    };
  };
}

export interface ContributionWindow {
  from: string;
  to: string;
}

export interface EnrichResult {
  users: GraphUser[];
  /** Logins the API no longer resolves — deleted, renamed or suspended. Kept
   *  so a run can report them instead of silently shrinking a leaderboard. */
  skipped: string[];
}

export interface SearchOptions {
  /** Hard ceiling on results, below the 1000 the API itself enforces. */
  max?: number;
}

export interface GitHubApi {
  searchUsers(query: string, options?: SearchOptions): Promise<SearchUser[]>;
  searchRepositories(query: string, options?: SearchOptions): Promise<SearchRepository[]>;
  enrichUsers(logins: string[], window: ContributionWindow): Promise<EnrichResult>;
}

/**
 * The token is not optional and a missing one must never look like "this place
 * has no developers". Unauthenticated search allows 10 requests a minute and
 * GraphQL none at all, so a tokenless run would write a plausible-looking empty
 * snapshot over good data.
 */
export function requireToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = env.GH_CRAWL_TOKEN?.trim() || env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "No GitHub token. Set GH_CRAWL_TOKEN (preferred) or GITHUB_TOKEN to a classic or " +
        "fine-grained token with public read access. Refusing to crawl unauthenticated — " +
        "that would overwrite the committed snapshot with an empty one.",
    );
  }
  return token;
}

/** Escapes a free-text place name for use inside a quoted search qualifier. */
export function locationQuery(place: string): string {
  return `location:"${place.replace(/"/g, "")}" type:user`;
}

/**
 * Minute-window token bucket. Search is the only endpoint tight enough to need
 * one; GraphQL is governed by its point budget instead.
 */
export class TokenBucket {
  capacity: number;
  perMinute: number;
  tokens: number;
  updatedAt: number;

  constructor(perMinute: number) {
    this.capacity = perMinute;
    this.perMinute = perMinute;
    this.tokens = perMinute;
    this.updatedAt = Date.now();
  }

  refill(now: number): void {
    const gained = ((now - this.updatedAt) / 60_000) * this.perMinute;
    if (gained <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + gained);
    this.updatedAt = now;
  }

  async take(): Promise<void> {
    this.refill(Date.now());
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = Math.ceil(((1 - this.tokens) / this.perMinute) * 60_000);
    await sleep(waitMs);
    this.refill(Date.now());
    this.tokens = Math.max(0, this.tokens - 1);
  }
}

/** Full jitter: retrying clients that back off in lockstep re-collide. */
function backoffMs(attempt: number): number {
  const ceiling = Math.min(MAX_BACKOFF_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.round(ceiling * (0.5 + Math.random() * 0.5));
}

function retryAfterMs(headers: Headers): number | null {
  const explicit = headers.get("retry-after");
  if (explicit) {
    const seconds = Number(explicit);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  }
  // A primary limit hands back the reset instant instead of a delay.
  if (headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(headers.get("x-ratelimit-reset"));
    if (Number.isFinite(reset)) return Math.max(0, reset * 1000 - Date.now());
  }
  return null;
}

function isSecondaryLimit(status: number, body: string): boolean {
  if (status !== 403 && status !== 429) return false;
  return /secondary rate limit|abuse detection/i.test(body);
}

function isTransient(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

export interface RestSearchPage<T> {
  total_count: number;
  incomplete_results: boolean;
  items: T[];
}

interface RestSearchUserItem {
  login: string;
  avatar_url: string;
}

interface RestSearchRepoItem {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  owner: { avatar_url: string } | null;
}

export function decodeSearchUsers(body: unknown): SearchUser[] {
  const page = body as RestSearchPage<RestSearchUserItem>;
  if (!page || !Array.isArray(page.items)) return [];
  return page.items
    .filter((item) => typeof item?.login === "string")
    .map((item) => ({
      login: item.login,
      // The search payload pins avatars at their default size; ask for one that
      // survives a retina card, matching what the seeder stores.
      avatarUrl: withAvatarSize(item.avatar_url ?? ""),
    }));
}

export function decodeSearchRepositories(body: unknown): SearchRepository[] {
  const page = body as RestSearchPage<RestSearchRepoItem>;
  if (!page || !Array.isArray(page.items)) return [];
  return page.items
    .filter((item) => typeof item?.full_name === "string")
    .map((item) => ({
      nameWithOwner: item.full_name,
      description: item.description ?? null,
      stars: Math.max(0, Math.floor(item.stargazers_count ?? 0)),
      forks: Math.max(0, Math.floor(item.forks_count ?? 0)),
      language: item.language ?? null,
      ownerAvatarUrl: withAvatarSize(item.owner?.avatar_url ?? ""),
    }));
}

export function withAvatarSize(url: string, size = 160): string {
  if (!url) return url;
  if (/[?&]s=\d+/.test(url)) return url.replace(/([?&])s=\d+/, `$1s=${size}`);
  return `${url}${url.includes("?") ? "&" : "?"}s=${size}`;
}

export interface GraphQLBody {
  data?: Record<string, GraphUser | null> & { rateLimit?: RateLimitInfo };
  errors?: { type?: string; message?: string; path?: (string | number)[] }[];
}

export interface RateLimitInfo {
  cost: number;
  remaining: number;
  resetAt: string;
}

/**
 * Pulls the aliased users out of a batch response. A null alias is a deleted or
 * renamed account: those are reported, not thrown on, because one dead login in
 * a batch of 25 must not cost us the other 24.
 */
export function decodeGraphQlUsers(body: GraphQLBody, logins: string[]): EnrichResult {
  const users: GraphUser[] = [];
  const skipped: string[] = [];
  const data = body.data ?? {};

  logins.forEach((login, index) => {
    const value = data[aliasFor(index)];
    if (value && typeof value.login === "string") users.push(value);
    else skipped.push(login);
  });

  return { users, skipped };
}

export function rateLimitFrom(body: GraphQLBody): RateLimitInfo | null {
  const limit = body.data?.rateLimit;
  return limit && typeof limit.cost === "number" ? limit : null;
}

function aliasFor(index: number): string {
  return `u${index}`;
}

/**
 * Anything that is not an aliased NOT_FOUND is a real failure — a bad query, a
 * revoked token — and must stop the run rather than quietly thin the corpus.
 */
export function fatalGraphQlError(body: GraphQLBody): string | null {
  const errors = body.errors ?? [];
  const fatal = errors.filter((error) => error.type !== "NOT_FOUND");
  return fatal.length > 0 ? fatal.map((error) => error.message ?? error.type).join("; ") : null;
}

/** The enrichment document, built for however many logins are in this batch. */
export function buildUserQuery(count: number, options: { languages?: boolean } = {}): string {
  const repositories = options.languages
    ? "repositories(first: 25, isFork: false, ownerAffiliations: OWNER, " +
      "orderBy: { field: STARGAZERS, direction: DESC }) " +
      "{ totalCount nodes { primaryLanguage { name } } }"
    : "repositories { totalCount }";

  const params = ["$from: DateTime!", "$to: DateTime!"];
  const fields: string[] = [];

  for (let index = 0; index < count; index++) {
    params.push(`$${aliasFor(index)}: String!`);
    fields.push(
      `  ${aliasFor(index)}: user(login: $${aliasFor(index)}) {
    login
    name
    avatarUrl
    location
    company
    bio
    followers { totalCount }
    ${repositories}
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      totalPullRequestReviewContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }`,
    );
  }

  return `query Enrich(${params.join(", ")}) {
  rateLimit { cost remaining resetAt }
${fields.join("\n")}
}`;
}

export interface ClientOptions {
  token: string;
  /** Injected so tests and the fixture client never touch the network. */
  fetchImpl?: typeof fetch;
  /** Off by default: the extra repository page roughly doubles the node count
   *  of an enrichment request for a field the UI can live without. */
  languages?: boolean;
  log?: (message: string) => void;
}

export class GitHubClient implements GitHubApi {
  token: string;
  fetchImpl: typeof fetch;
  languages: boolean;
  log: (message: string) => void;
  searchLimiter: TokenBucket;
  batchSize: number;

  constructor(options: ClientOptions) {
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.languages = options.languages ?? false;
    this.log = options.log ?? (() => {});
    this.searchLimiter = new TokenBucket(SEARCH_REQUESTS_PER_MINUTE);
    this.batchSize = GRAPHQL_BATCH_START;
  }

  async searchUsers(query: string, options: SearchOptions = {}): Promise<SearchUser[]> {
    return this.searchPaged(`${API_ROOT}/search/users`, query, "followers", options, (body) =>
      decodeSearchUsers(body),
    );
  }

  async searchRepositories(
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchRepository[]> {
    return this.searchPaged(
      `${API_ROOT}/search/repositories`,
      query,
      "stars",
      options,
      (body) => decodeSearchRepositories(body),
    );
  }

  private async searchPaged<T>(
    endpoint: string,
    query: string,
    sort: string,
    options: SearchOptions,
    decode: (body: unknown) => T[],
  ): Promise<T[]> {
    const max = Math.min(options.max ?? SEARCH_RESULT_CAP, SEARCH_RESULT_CAP);
    const out: T[] = [];

    for (let page = 1; page <= SEARCH_MAX_PAGES && out.length < max; page++) {
      const url = new URL(endpoint);
      url.searchParams.set("q", query);
      url.searchParams.set("sort", sort);
      url.searchParams.set("order", "desc");
      url.searchParams.set("per_page", String(SEARCH_PER_PAGE));
      url.searchParams.set("page", String(page));

      await this.searchLimiter.take();
      const body = await this.request(url.toString(), { method: "GET" });
      const items = decode(body);
      out.push(...items);

      // A short page is the end of the result set; there is no next one.
      if (items.length < SEARCH_PER_PAGE) break;
    }

    return out.slice(0, max);
  }

  async enrichUsers(logins: string[], window: ContributionWindow): Promise<EnrichResult> {
    const users: GraphUser[] = [];
    const skipped: string[] = [];

    for (let index = 0; index < logins.length; ) {
      const batch = logins.slice(index, index + this.batchSize);
      index += batch.length;

      const variables: Record<string, string> = { from: window.from, to: window.to };
      batch.forEach((login, position) => {
        variables[aliasFor(position)] = login;
      });

      const body = (await this.request(GRAPHQL_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          query: buildUserQuery(batch.length, { languages: this.languages }),
          variables,
        }),
      })) as GraphQLBody;

      const fatal = fatalGraphQlError(body);
      if (fatal) throw new Error(`GraphQL enrichment failed: ${fatal}`);

      const decoded = decodeGraphQlUsers(body, batch);
      users.push(...decoded.users);
      skipped.push(...decoded.skipped);

      await this.adaptBatchSize(rateLimitFrom(body), batch.length);
    }

    return { users, skipped };
  }

  /**
   * The documented cost of this query is a guess until the API answers; let the
   * measurement set the batch size so a heavier-than-expected selection shrinks
   * batches instead of exhausting the hourly budget halfway through a tier.
   */
  private async adaptBatchSize(limit: RateLimitInfo | null, batchSize: number): Promise<void> {
    if (!limit) return;

    const costPerLogin = Math.max(limit.cost, 1) / Math.max(batchSize, 1);
    const target = Math.round(GRAPHQL_TARGET_COST / costPerLogin);
    this.batchSize = Math.max(GRAPHQL_BATCH_MIN, Math.min(GRAPHQL_BATCH_MAX, target));

    if (limit.remaining > GRAPHQL_RESERVE) return;

    const waitMs = Math.max(0, Date.parse(limit.resetAt) - Date.now()) + 1000;
    this.log(`GraphQL budget down to ${limit.remaining}; waiting ${Math.ceil(waitMs / 1000)}s`);
    await sleep(waitMs);
  }

  private async request(url: string, init: RequestInit): Promise<unknown> {
    let lastError = "";

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const response = await this.fetchImpl(url, {
        ...init,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.token}`,
          "user-agent": USER_AGENT,
          ...(init.method === "POST" ? { "content-type": "application/json" } : {}),
        },
      });

      if (response.ok) return response.json();

      const text = await response.text();
      lastError = `HTTP ${response.status}: ${text.slice(0, 300)}`;

      const advised = retryAfterMs(response.headers);
      const shouldRetry =
        isTransient(response.status) ||
        isSecondaryLimit(response.status, text) ||
        advised !== null;

      if (!shouldRetry) throw new Error(`${url} — ${lastError}`);

      const waitMs = advised ?? backoffMs(attempt);
      this.log(`retrying ${new URL(url).pathname} in ${Math.ceil(waitMs / 1000)}s — ${lastError}`);
      await sleep(Math.min(waitMs, MAX_BACKOFF_MS));
    }

    throw new Error(`${url} — gave up after ${MAX_ATTEMPTS} attempts. ${lastError}`);
  }
}

/** The trailing year the contribution calendar covers, ending on `date`. */
export function contributionWindow(date: Date): ContributionWindow {
  const to = new Date(date);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 365);
  return { from: from.toISOString(), to: to.toISOString() };
}
