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

/**
 * Alias batching.
 *
 * CLAUDE.md §1 says to start at 100 and halve on timeout, because 100 aliases
 * cost a single point. The *points* part is true — a ten-alias query bills 1,
 * same as a one-alias query — but 100 is unreachable for this selection, and
 * the reason is not the rate limit at all.
 *
 * `contributionsCollection` makes GitHub aggregate a year of events per alias
 * inside one query's execution budget, and that budget is what runs out. The
 * `verify` tier measures the ceiling directly (see PROBE_SIZES in index.ts).
 * Measured 2026-08-02, on a personal token:
 *
 *     1 alias   cost 1   0.5s   ok
 *     2         cost 1   0.9s   ok
 *     3         cost 1   1.3s   ok
 *     5         cost 1   2.0s   ok
 *    10         cost 1   3.4s   ok
 *    25         —        7.0s   "Resource limits for this query exceeded."
 *
 * So: 10, and re-measure with `--tier=verify` rather than assuming it held.
 * Note the shape of the failure at 25 — a structured GraphQL error naming the
 * reason, not the gateway 502 an earlier run took at every size. Those 502s
 * were GitHub being unwell, and reading them as a hard ceiling was wrong.
 *
 * The ladder is for TIMEOUTS specifically. Measured `rateLimit.cost` separately
 * shrinks the batch when a selection turns out heavier than expected; the two
 * mechanisms answer different failures and both are needed.
 */
export const GRAPHQL_BATCH_START = 10;
const GRAPHQL_BATCH_MIN = 1;
const GRAPHQL_BATCH_MAX = 10;
/**
 * Walked down in order on timeout, to the floor the client itself supports.
 *
 * It used to stop at 25 while `GRAPHQL_BATCH_MIN` was 5, so a batch that could
 * not be served at 25 gave up with three viable sizes untried. That is not
 * hypothetical: a real run took fifteen consecutive 502/504s walking
 * 100 -> 50 -> 25 and then threw, losing 250,000 users of work.
 *
 * The floor is 1 because a single pathological account — someone with an
 * enormous year — can exceed the executor's budget on its own. At size 1 there
 * is nothing left to blame but that account, and it gets dead-lettered.
 */
const GRAPHQL_BATCH_LADDER = [10, 5, 3, 2, 1] as const;
/** Points we are willing to spend per enrichment request. Every batch size we
 *  can actually use bills 1, so this is a tripwire for the selection growing,
 *  not a budget to spend. */
const GRAPHQL_TARGET_COST = 1;
/** Below this many points left in the hour, wait for the reset rather than
 *  burning the remainder and having the run die mid-place. */
const GRAPHQL_RESERVE = 200;

/**
 * Enrichment requests in flight.
 *
 * §4: 4–8, never higher. It does not raise the 5,000-point ceiling — it is what
 * lets a run reach it. A ten-alias query takes ~3.4s, so a single-threaded pass
 * hydrates ~10,600 users an hour against a budget that allows 50,000; five
 * sixths of the wall clock would be spent waiting on the socket. Six workers
 * put the two roughly in line, and `adaptBatchSize` still parks the whole pool
 * when the hourly points run low.
 */
const CONCURRENCY = 6;
const MAX_CONCURRENCY = 8;

const MAX_ATTEMPTS = 5;

/**
 * Gateway errors get more attempts than other failures, but not more time.
 *
 * A 502/504 is not billed against the rate limit, so retrying one costs only
 * time — which is exactly the resource that then needs bounding. The first
 * version of this raised the attempt count and left the 60-second backoff
 * ceiling alone, and a probe spent twenty minutes on two thousand users without
 * reporting anything: eight attempts backing off to a minute is ~3 minutes per
 * rung, five rungs is ~15 minutes per batch, and three batches before the
 * circuit breaker is three quarters of an hour to learn one fact.
 *
 * Attempts are therefore capped by a wall-clock deadline as well. A gateway
 * that has not recovered in {@link REQUEST_DEADLINE_MS} is not going to inside
 * a retry loop, and the batch ladder is a better answer than more waiting.
 */
const MAX_GATEWAY_ATTEMPTS = 8;
/** Ceiling on one request's total wall clock, retries included. */
const REQUEST_DEADLINE_MS = 45_000;
/** Gateway retries back off fast — they are free, and the useful signal is
 *  whether the *next* rung down works, not whether a longer wait helps. */
const GATEWAY_BACKOFF_CEILING_MS = 8_000;

/**
 * Consecutive dead-lettered batches before the run gives up entirely.
 *
 * Dead-lettering exists so one pathological account cannot destroy a pass. It
 * must not become a way to grind through a quarter of a million logins during a
 * real outage, dropping every one of them and reporting "success". Three in a
 * row with no batch served in between is not a poison record, it is the API
 * being unavailable — and that deserves a failed job, loudly.
 */
const MAX_CONSECUTIVE_DEAD_LETTERS = 3;

/** Returned in place of a body when the server answers 304. */
export const NOT_MODIFIED = Symbol("not-modified");

/**
 * A sentinel array meaning "identical to the stored copy", distinct from an
 * empty array, which is the real answer "this place has no users". Conflating
 * the two would let a free 304 silently wipe a board.
 */
export const UNCHANGED: readonly never[] = Object.freeze([]);

export function isUnchanged<T>(result: T[]): boolean {
  return (result as unknown) === UNCHANGED;
}
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
      /** Absent on a scalars-only pass — see {@link EnrichOptions.calendar}. */
      weeks?: ContributionWeek[];
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

export interface EnrichOptions {
  /**
   * Whether to request the day-by-day contribution calendar.
   *
   * This is the field that decides what a hydration pass costs. Everything else
   * in the selection is a scalar; `weeks { contributionDays { … } }` is 371
   * nodes *per alias*, so a 100-alias batch asks for 37,100 of them and the
   * measured `rateLimit.cost` climbs accordingly. Hydrating a large corpus runs
   * in two passes: scalars for everyone, days only for the depth that has a
   * profile page to show them on.
   *
   * `contributionCalendar { totalContributions }` is kept either way. It is one
   * scalar, and it is the authoritative twelve-month total — the per-type counts
   * beneath it are public-only and do not sum to it, so dropping it would mean
   * ranking on a number GitHub does not agree with.
   *
   * Defaults to true, which is what every place-scoped tier wants.
   */
  calendar?: boolean;
  /**
   * Whether to request each user's top repositories, for the language mix.
   *
   * The same trap as `calendar`, and it caused the same failure: it adds a
   * *sorted connection* per alias —
   * `repositories(first: 25, orderBy: { field: STARGAZERS … })` — so a
   * 100-alias batch asks GitHub to rank a hundred people's repositories and
   * aggregate a hundred twelve-month contribution collections in one request.
   * That is the shape that comes back as a gateway 502 rather than data.
   *
   * Only the ~10,000 profile pages render the language donut, so only the
   * calendars pass needs this. Defaults to the client-level setting.
   */
  languages?: boolean;
  /**
   * Called after each batch is decoded.
   *
   * Lets a caller persist as it goes rather than holding a quarter of a million
   * records until the end — the standing rules require a resumable job, and a
   * run that only writes at the end is not one.
   */
  onBatch?: (batch: EnrichResult & { index: number }) => void | Promise<void>;
}

export interface GitHubApi {
  searchUsers(query: string, options?: SearchOptions): Promise<SearchUser[]>;
  searchRepositories(query: string, options?: SearchOptions): Promise<SearchRepository[]>;
  enrichUsers(
    logins: string[],
    window: ContributionWindow,
    options?: EnrichOptions,
  ): Promise<EnrichResult>;
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

/**
 * The message for a 401.
 *
 * Worth spelling out because the failure is confusing: the workflow's token
 * gate passes (the secret exists and is non-empty), the budget block prints,
 * and only then does GitHub reject the credential. "Bad credentials" alone
 * sends people to check whether the secret is set, which it is.
 */
export function badCredentials(): string {
  return [
    "GitHub rejected the token (HTTP 401 Bad credentials).",
    "",
    "The secret exists — an empty one is caught earlier — so the value itself is not accepted.",
    "In order of likelihood:",
    "  1. The token expired, or was revoked. Classic tokens expire by default.",
    "  2. Only part of it was pasted. A classic token is `ghp_` + 36 characters;",
    "     a fine-grained one is `github_pat_` + rather more.",
    "  3. It is a fine-grained token still awaiting approval, or scoped to an",
    "     organisation that has not granted it.",
    "",
    "Generate a replacement at https://github.com/settings/tokens/new — no scopes are needed,",
    "everything this crawler reads is public — and update the GH_CRAWL_TOKEN repository secret.",
  ].join("\n");
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
  /** Selected so the hourly ceiling is observed rather than hardcoded. */
  limit?: number;
  /** The node count this query actually consumed, against the 500,000 cap. */
  nodeCount?: number;
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

/**
 * The enrichment document, built for however many logins are in this batch.
 *
 * `calendar: false` drops the only connection field in the selection. What is
 * left is scalars, so the query bills at the shape the batching maths assumes —
 * about one point per hundred logins — and a corpus-wide pass is affordable.
 * With the calendar in, each alias adds 371 nodes and the same batch costs
 * several times as much. Both are legitimate; they are different passes.
 */
export function buildUserQuery(
  count: number,
  options: { languages?: boolean; calendar?: boolean } = {},
): string {
  const repositories = options.languages
    ? "repositories(first: 25, isFork: false, ownerAffiliations: OWNER, " +
      "orderBy: { field: STARGAZERS, direction: DESC }) " +
      "{ totalCount nodes { primaryLanguage { name } } }"
    : "repositories { totalCount }";

  const days =
    options.calendar === false ? "" : "\n        weeks { contributionDays { date contributionCount } }";

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
        totalContributions${days}
      }
    }
  }`,
    );
  }

  return `query Enrich(${params.join(", ")}) {
  rateLimit { cost limit remaining resetAt nodeCount }
${fields.join("\n")}
}`;
}

/**
 * Conditional-request store.
 *
 * A REST response that comes back `304 Not Modified` does NOT count against the
 * primary rate limit. On a re-crawl of mostly-unchanged data that makes the
 * whole pass close to free, which is the difference between a nightly refresh
 * being affordable and being the entire hourly budget. GraphQL has no
 * equivalent — there we skip on a stored `updatedAt` instead.
 */
export interface ConditionalStore {
  get(key: string): string | undefined;
  set(key: string, etag: string): void;
}

export interface ClientOptions {
  token: string;
  /** Injected so tests and the fixture client never touch the network. */
  fetchImpl?: typeof fetch;
  /** Off by default: the extra repository page roughly doubles the node count
   *  of an enrichment request for a field the UI can live without. */
  languages?: boolean;
  /** Persisted ETags. Omit and every REST call is unconditional. */
  etags?: ConditionalStore;
  /** Where a unit of work goes when it cannot be served at any batch size.
   *  Omit and such a batch is dropped with a log line but no record. */
  deadLetter?: DeadLetterSink;
  /** Enrichment requests in flight at once. §4 allows 4–8 and the constructor
   *  clamps to that; higher does not raise the ceiling, it just earns a
   *  secondary-limit block. Tests set 1 to keep batch order deterministic. */
  concurrency?: number;
  /** Injected so a test can exercise the retry and batch-ladder paths without
   *  actually waiting out the backoff. Production never sets it — and when a
   *  test replaces `sleepImpl`, `now` has to advance with it or the wall-clock
   *  deadline never fires. */
  sleepImpl?: (ms: number) => Promise<unknown>;
  now?: () => number;
  log?: (message: string) => void;
}

/** The slice of `limiter.ts`'s DeadLetter this client needs, named structurally
 *  so github.ts does not depend on the limiter module. */
export interface DeadLetterSink {
  record(unit: string, error: string, attempts: number): Promise<void>;
}

export class GitHubClient implements GitHubApi {
  /** Sentinel for a conditional hit — distinct from an empty result, which is a
   *  real answer meaning "this place has no users". */
  static readonly NOT_MODIFIED = NOT_MODIFIED;

  token: string;
  fetchImpl: typeof fetch;
  languages: boolean;
  etags?: ConditionalStore;
  deadLetter?: DeadLetterSink;
  sleep: (ms: number) => Promise<unknown>;
  now: () => number;
  /** Counts requests served from a 304, for the per-run budget report. */
  conditionalHits = 0;
  log: (message: string) => void;
  searchLimiter: TokenBucket;
  batchSize: number;
  concurrency: number;

  constructor(options: ClientOptions) {
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.languages = options.languages ?? false;
    this.etags = options.etags;
    this.deadLetter = options.deadLetter;
    this.sleep = options.sleepImpl ?? sleep;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => {});
    this.searchLimiter = new TokenBucket(SEARCH_REQUESTS_PER_MINUTE);
    this.batchSize = GRAPHQL_BATCH_START;
    // Clamped rather than trusted: §4's ceiling is 8, and a caller passing 32
    // would trade the whole run for a secondary-limit block. 1 stays reachable
    // because tests need batches to complete in a known order.
    this.concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, options.concurrency ?? CONCURRENCY));
  }

  /**
   * One point, spent to answer "will this token work at all?".
   *
   * Worth its own call because of where the alternative fails: hydration reads
   * 3.5 GB of GH Archive and prints a budget before it touches the API, so a
   * bad credential surfaces four minutes and a full discovery pass into the
   * run. This turns that into a one-second failure at the top of the job.
   */
  async verifyToken(): Promise<string> {
    const body = (await this.request(GRAPHQL_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ query: "query Verify { viewer { login } rateLimit { remaining } }" }),
    })) as { data?: { viewer?: { login?: string }; rateLimit?: { remaining?: number } } };

    const login = body.data?.viewer?.login;
    if (!login) throw new Error(badCredentials());

    this.log(`token accepted for @${login}; ${body.data?.rateLimit?.remaining ?? "?"} points left`);
    return login;
  }

  /**
   * N users in one query, using the same selection hydration uses.
   *
   * This exists to answer a question that cost a lot to guess at: when
   * enrichment 502s, is it the *size* of the batch or the query itself? A run
   * walked 100 -> 50 -> 25 -> 10 -> 5 with the light selection and took gateway
   * errors at every rung while a one-alias request answered in a second. So the
   * ceiling sits somewhere below 5, and the only honest way to find it is to
   * ask GitHub one alias count at a time.
   *
   * Deliberately impatient: two attempts, not the eight a hydrating batch gets.
   * A probe that rides out a gateway wobble reports the wrong ceiling, and a
   * size that needs three tries to answer is not a size we can run 250,000
   * users through anyway.
   *
   * Returns the measured cost so the §8 budget can stop being an assumption.
   */
  async probeEnrichment(
    logins: string[],
    window: ContributionWindow,
  ): Promise<{
    size: number;
    ok: boolean;
    cost: number | null;
    resolved: number;
    elapsedMs: number;
    detail: string;
  }> {
    const startedAt = this.now();
    const variables: Record<string, string> = { from: window.from, to: window.to };
    logins.forEach((login, index) => {
      variables[aliasFor(index)] = login;
    });

    const failure = (detail: string) => ({
      size: logins.length,
      ok: false,
      cost: null,
      resolved: 0,
      elapsedMs: this.now() - startedAt,
      detail,
    });

    try {
      const body = (await this.request(
        GRAPHQL_ENDPOINT,
        {
          method: "POST",
          body: JSON.stringify({
            query: buildUserQuery(logins.length, { languages: false, calendar: false }),
            variables,
          }),
        },
        { maxAttempts: 2 },
      )) as GraphQLBody;

      const fatal = fatalGraphQlError(body);
      if (fatal) return failure(`GraphQL error: ${fatal}`);

      const decoded = decodeGraphQlUsers(body, logins);
      const limit = rateLimitFrom(body);
      return {
        size: logins.length,
        // Every alias has to come back. A partial answer at size 10 is not a
        // working size 10 — it is a size we would have to dead-letter half of.
        ok: decoded.users.length === logins.length,
        cost: limit?.cost ?? null,
        resolved: decoded.users.length,
        elapsedMs: this.now() - startedAt,
        detail:
          decoded.users.length === logins.length
            ? `all ${logins.length} resolved`
            : `only ${decoded.users.length}/${logins.length} resolved` +
              (decoded.skipped.length ? ` (skipped ${decoded.skipped.join(", ")})` : ""),
      };
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
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

      // 304: this page is byte-identical to the last crawl and cost no budget.
      // Every later page of the same query would be too, so stop rather than
      // paging on — and signal "unchanged" by returning nothing, which lets the
      // caller keep the stored board instead of overwriting it with a partial.
      if (body === NOT_MODIFIED) {
        if (page === 1) return UNCHANGED as unknown as T[];
        break;
      }

      const items = decode(body);
      out.push(...items);

      // A short page is the end of the result set; there is no next one.
      if (items.length < SEARCH_PER_PAGE) break;
    }

    return out.slice(0, max);
  }

  async enrichUsers(
    logins: string[],
    window: ContributionWindow,
    options: EnrichOptions = {},
  ): Promise<EnrichResult> {
    const users: GraphUser[] = [];
    const skipped: string[] = [];
    const collect = options.onBatch === undefined;
    let batchIndex = 0;
    let dropped = 0;
    let consecutiveDrops = 0;

    // Shared work state. `cursor` walks the corpus; `requeued` holds logins
    // from a batch that has to be reissued at a smaller size, and is drained
    // first so a stepped-down rung is retried promptly rather than at the end.
    let cursor = 0;
    const requeued: string[] = [];
    let journal = Promise.resolve();

    const takeBatch = (): string[] | null => {
      if (requeued.length) return requeued.splice(0, this.batchSize);
      if (cursor >= logins.length) return null;
      const batch = logins.slice(cursor, cursor + this.batchSize);
      cursor += batch.length;
      return batch;
    };

    const worker = async (): Promise<void> => {
      for (let batch = takeBatch(); batch !== null; batch = takeBatch()) {
        // Captured before the request so a concurrent worker stepping the
        // ladder down mid-flight cannot make this batch look stale.
        const sizeSent = this.batchSize;

        const variables: Record<string, string> = { from: window.from, to: window.to };
        batch.forEach((login, position) => {
          variables[aliasFor(position)] = login;
        });

        let body: GraphQLBody;
        try {
          body = (await this.request(GRAPHQL_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({
              query: buildUserQuery(batch.length, {
                languages: options.languages ?? this.languages,
                calendar: options.calendar,
              }),
              variables,
            }),
          })) as GraphQLBody;
        } catch (error) {
          // A timeout is not a reason to fail the tier — it is the signal to
          // step down. Requeue the logins so they are retried at the smaller
          // size; a smaller batch is cheaper than a retry at the same size.
          if (isOversized(error) && this.stepDownFrom(sizeSent)) {
            requeued.unshift(...batch);
            continue;
          }
          if (!isOversized(error)) throw error;

          // Bottom of the ladder. §4: never retry a unit of work more than five
          // times — write it to the dead-letter file and move on. Throwing here
          // would discard every batch already hydrated, which is how a run that
          // had collected nothing yet still managed to lose 250,000 users.
          await this.deadLetter?.record(
            `enrich:${batch[0]}..${batch[batch.length - 1]}`,
            error instanceof Error ? error.message : String(error),
            GRAPHQL_BATCH_LADDER.length,
          );
          dropped += batch.length;
          consecutiveDrops++;

          if (consecutiveDrops >= MAX_CONSECUTIVE_DEAD_LETTERS) {
            throw new Error(
              `GraphQL served none of the last ${consecutiveDrops} batches at any size ` +
                `(${GRAPHQL_BATCH_LADDER.join(", ")}). Treating this as an outage rather than ` +
                `dead-lettering the remaining ${logins.length - cursor + requeued.length} logins. ` +
                `Last error: ${error instanceof Error ? error.message : String(error)}`,
            );
          }

          this.log(
            `batch of ${batch.length} unserved at every batch size; dead-lettered ` +
              `(${dropped} logins dropped so far) and continuing`,
          );
          this.resetBatchSize();
          continue;
        }

        const fatal = fatalGraphQlError(body);
        if (fatal) {
          if (isOversized(fatal) && this.stepDownFrom(sizeSent)) {
            requeued.unshift(...batch);
            continue;
          }
          throw new Error(`GraphQL enrichment failed: ${fatal}`);
        }

        consecutiveDrops = 0;

        const decoded = decodeGraphQlUsers(body, batch);
        // With a per-batch consumer the caller owns the records and this method
        // holds nothing: that is what lets a 250,000-login pass run in bounded
        // memory and resume from where it stopped.
        if (collect) {
          users.push(...decoded.users);
          skipped.push(...decoded.skipped);
        } else {
          // Serialised, unlike the requests. The consumer appends to a journal
          // file, and interleaved appends from six workers would corrupt the
          // very thing that makes the run resumable.
          const index = batchIndex;
          journal = journal.then(() => options.onBatch?.({ ...decoded, index }));
          await journal;
        }
        batchIndex++;

        await this.adaptBatchSize(rateLimitFrom(body), batch.length);
      }
    };

    // Concurrency does not raise the 5,000-point ceiling; it is what lets us
    // reach it. A ten-alias query takes ~3.4s, so one worker hydrates ~10,600
    // users an hour against a budget that allows 50,000 — the run would spend
    // five sixths of its wall clock waiting on the socket. §4 caps this at 8.
    await Promise.all(Array.from({ length: this.concurrency }, () => worker()));

    if (dropped > 0) {
      this.log(`${dropped} logins were never served and are listed in the dead-letter file`);
    }
    return { users, skipped };
  }

  /**
   * Back to the top of the ladder after a dead-letter.
   *
   * The batch that failed may have contained one pathological account rather
   * than being too large — staying at the floor for the remaining quarter of a
   * million would turn a 2,500-query pass into a 50,000-query one. If the size
   * really is the problem the ladder simply walks down again.
   */
  private resetBatchSize(): void {
    this.batchSize = GRAPHQL_BATCH_START;
  }

  /**
   * Walk down the 10 -> 5 -> 3 -> 2 -> 1 ladder. Returns false at the bottom,
   * so a genuine failure still surfaces instead of looping forever on a batch
   * size that was never the problem.
   *
   * `sentAt` is the size the failing batch was issued at. With several workers
   * in flight they all fail at roughly the same moment on a rung that is too
   * big, and letting each of them step would drop the ladder to its floor on
   * the strength of one bad rung. Only the first report moves it.
   */
  private stepDownFrom(sentAt: number): boolean {
    if (this.batchSize < sentAt) return true; // another worker already stepped down
    const next = GRAPHQL_BATCH_LADDER.find((size) => size < this.batchSize);
    if (next === undefined) return false;
    this.batchSize = next;
    this.log(`GraphQL could not serve ${sentAt} aliases; batch now ${next}`);
    return true;
  }

  /**
   * The documented cost of this query is a guess until the API answers; let the
   * measurement set the batch size so a heavier-than-expected selection shrinks
   * batches instead of exhausting the hourly budget halfway through a tier.
   */
  private async adaptBatchSize(limit: RateLimitInfo | null, batchSize: number): Promise<void> {
    if (!limit) return;

    // Cost is per query, not per login. One point for a hundred logins is the
    // expected shape; if the API bills more, shrink so a single request never
    // costs more than GRAPHQL_TARGET_COST points.
    const measured = Math.max(limit.cost, 1);
    const affordable = Math.floor((batchSize * GRAPHQL_TARGET_COST) / measured);
    this.batchSize = Math.max(
      GRAPHQL_BATCH_MIN,
      Math.min(GRAPHQL_BATCH_MAX, Math.max(affordable, GRAPHQL_BATCH_MIN)),
    );

    if (limit.nodeCount && limit.nodeCount > 400_000) {
      // The hard ceiling is 500,000 nodes per query; back off before hitting it.
      this.batchSize = Math.max(GRAPHQL_BATCH_MIN, Math.floor(this.batchSize / 2));
      this.log(`node count ${limit.nodeCount} near the 500k cap; batch now ${this.batchSize}`);
    }

    if (limit.remaining > GRAPHQL_RESERVE) return;

    const waitMs = Math.max(0, Date.parse(limit.resetAt) - Date.now()) + 1000;
    this.log(`GraphQL budget down to ${limit.remaining}; waiting ${Math.ceil(waitMs / 1000)}s`);
    await this.sleep(waitMs);
  }

  private async request(
    url: string,
    init: RequestInit,
    retry: { maxAttempts?: number } = {},
  ): Promise<unknown> {
    let lastError = "";
    let attempts = 0;
    let sawGateway = false;
    const startedAt = this.now();
    const conditional = init.method !== "POST" ? this.etags?.get(url) : undefined;

    // Grows to MAX_GATEWAY_ATTEMPTS the first time a 502/503/504 is seen, so a
    // flaky front end gets ridden out without giving every other failure the
    // same latitude.
    let budget = retry.maxAttempts ?? MAX_ATTEMPTS;

    for (let attempt = 0; attempt < budget; attempt++) {
      attempts = attempt + 1;
      const response = await this.fetchImpl(url, {
        ...init,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.token}`,
          "user-agent": USER_AGENT,
          ...(init.method === "POST" ? { "content-type": "application/json" } : {}),
          ...(conditional ? { "if-none-match": conditional } : {}),
        },
      });

      // Unchanged, and it cost us nothing. NOT_MODIFIED is a success.
      if (response.status === 304) {
        this.conditionalHits++;
        return NOT_MODIFIED;
      }

      if (response.ok) {
        const etag = response.headers.get("etag");
        if (etag && init.method !== "POST") this.etags?.set(url, etag);
        return response.json();
      }

      const text = await response.text();
      lastError = `HTTP ${response.status}: ${text.slice(0, 300)}`;

      // A 401 is never worth retrying and never worth a raw dump: the token is
      // present (the run got this far) but GitHub will not accept it, and the
      // fix is always the same handful of things.
      if (response.status === 401) throw new Error(badCredentials());

      const advised = retryAfterMs(response.headers);
      const transient = isTransient(response.status);
      const shouldRetry = transient || isSecondaryLimit(response.status, text) || advised !== null;

      if (!shouldRetry) throw new Error(`${url} — ${lastError}`);
      if (transient) {
        budget = retry.maxAttempts ?? MAX_GATEWAY_ATTEMPTS;
        sawGateway = true;
      }

      // Attempts left, but no time left. Stop here so the caller can try a
      // smaller batch instead of waiting out a gateway that is not recovering.
      const elapsed = this.now() - startedAt;
      if (elapsed > REQUEST_DEADLINE_MS) {
        throw new Error(
          `${url} — gave up after ${attempts} attempts in ${Math.round(elapsed / 1000)}s. ${lastError}`,
        );
      }

      const ceiling = sawGateway && advised === null ? GATEWAY_BACKOFF_CEILING_MS : MAX_BACKOFF_MS;
      const waitMs = Math.min(advised ?? backoffMs(attempt), ceiling);
      this.log(`retrying ${new URL(url).pathname} in ${Math.ceil(waitMs / 1000)}s — ${lastError}`);
      await this.sleep(waitMs);
    }

    throw new Error(`${url} — gave up after ${attempts} attempts. ${lastError}`);
  }
}

/**
 * "This query asked for too much" — the one failure the batch ladder answers.
 *
 * GitHub reports it four ways: a 502, a 504, a plain socket timeout, and a
 * structured `Resource limits for this query exceeded.` The last is the polite
 * one, and it is what a 25-alias `contributionsCollection` query actually
 * returns; missing it meant an over-sized batch threw instead of stepping down.
 */
export function isOversized(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|ETIMEDOUT|502|504|resource limits/i.test(message);
}

/** The trailing year the contribution calendar covers, ending on `date`. */
export function contributionWindow(date: Date): ContributionWindow {
  const to = new Date(date);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 365);
  return { from: from.toISOString(), to: to.toISOString() };
}
