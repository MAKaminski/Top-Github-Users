/**
 * Shared pacing layer for every GitHub API call.
 *
 * `github.ts` already backs off per request, but per-request backoff cannot see
 * how much the *rest* of the run is spending. GitHub enforces its limits on the
 * token, not on the call site, so the only place a burst can be prevented is a
 * single object every caller passes through. That is this file: one concurrency
 * gate, one point budget per surface, one pause that every waiting task obeys.
 *
 * Nothing here touches the network or the clock directly — `fn` is supplied by
 * the caller and `now`/`sleep` are injectable — so the pacing rules are testable
 * without waiting out a real sixty-second window.
 */

import { setTimeout as realSleep } from "node:timers/promises";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../lib/io.ts";

export type ApiKind = "rest" | "graphql";

/** Six parallel requests is what a single token sustains without tripping the
 *  secondary limiter; the documented ceiling for concurrent requests is 8 and
 *  going past it is what earns an abuse-detection block, so it is a hard cap
 *  rather than a default a caller may raise. */
export const CONCURRENCY_DEFAULT = 6;
export const CONCURRENCY_CAP = 8;

/** Point budgets per surface, held well under the published 5000/hr so a run
 *  that misjudges its batch size degrades into waiting rather than into a
 *  primary exhaustion that stalls every other job on the same token. */
export const GRAPHQL_POINTS_PER_MINUTE = 2000;
export const REST_POINTS_PER_MINUTE = 900;

/** The budget is a *sliding* minute. GitHub's own reset is a fixed instant, and
 *  pacing against that lets a run spend the whole budget in the last second of
 *  one window and the first second of the next — a double-rate burst exactly at
 *  the boundary, which is what the secondary limiter looks for. */
const WINDOW_MS = 60_000;

/** A secondary-limit 403 without `retry-after` carries no advice at all. The
 *  documented guidance is to wait at least a minute before retrying. */
export const SECONDARY_LIMIT_MIN_WAIT_MS = 60_000;

/** Reads are cheap, writes are not: GitHub's own accounting charges mutating
 *  requests several times a read, so the pacing has to price them the same way
 *  or a run of writes will look five times cheaper than it is. */
export const REST_READ_POINTS = 1;
export const REST_WRITE_POINTS = 5;
export const GRAPHQL_QUERY_POINTS = 1;
export const GRAPHQL_MUTATION_POINTS = 5;

/** Unknown verbs are priced as writes: over-charging costs throughput, while
 *  under-charging costs the whole token a block. */
export function pointsForRest(method: string): number {
  switch (method.trim().toUpperCase()) {
    case "GET":
    case "HEAD":
    case "OPTIONS":
      return REST_READ_POINTS;
    default:
      return REST_WRITE_POINTS;
  }
}

export function pointsForGraphql(operation: "query" | "mutation"): number {
  return operation === "mutation" ? GRAPHQL_MUTATION_POINTS : GRAPHQL_QUERY_POINTS;
}

export interface RateLimiterOptions {
  /** Defaults to 6. Values above {@link CONCURRENCY_CAP} throw. */
  concurrency?: number;
  graphqlPointsPerMinute?: number;
  restPointsPerMinute?: number;
  log?: (msg: string) => void;
  /** Injected so tests can exercise a full minute of pacing instantly. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface LimiterSnapshot {
  inFlight: number;
  graphqlPointsInWindow: number;
  restPointsInWindow: number;
  /** Last `x-ratelimit-remaining` seen, or null before the first response. */
  primaryRemaining: number | null;
  /** Epoch ms; 0 when nothing is holding the run back. */
  pausedUntil: number;
}

interface Spend {
  at: number;
  points: number;
}

export class RateLimiter {
  private readonly concurrency: number;
  private readonly budgets: Record<ApiKind, number>;
  private readonly log: (msg: string) => void;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private inFlight = 0;
  /** Slots taken. Counted from acquisition rather than from the moment `fn`
   *  starts, because a task waiting out the point budget is still holding the
   *  slot — counting only executing tasks would let the queue past the cap. */
  private held = 0;
  /** Tasks parked because every slot is taken; resolving one hands over the
   *  slot rather than incrementing, so the count can never drift upward. */
  private readonly slotQueue: (() => void)[] = [];
  private readonly spend: Record<ApiKind, Spend[]> = { rest: [], graphql: [] };

  private pausedUntilMs = 0;
  private primaryRemaining: number | null = null;
  private primaryResetMs: number | null = null;
  private primaryUsed: number | null = null;

  constructor(options: RateLimiterOptions = {}) {
    const concurrency = options.concurrency ?? CONCURRENCY_DEFAULT;
    if (!Number.isFinite(concurrency) || concurrency < 1) {
      throw new Error(`concurrency must be at least 1, got ${concurrency}`);
    }
    if (concurrency > CONCURRENCY_CAP) {
      throw new Error(
        `concurrency ${concurrency} exceeds the hard cap of ${CONCURRENCY_CAP}. More parallel ` +
          "requests on one token trips GitHub's secondary rate limiter, which blocks the token " +
          "for minutes — raising this makes the crawl slower, not faster.",
      );
    }

    this.concurrency = Math.floor(concurrency);
    this.budgets = {
      graphql: options.graphqlPointsPerMinute ?? GRAPHQL_POINTS_PER_MINUTE,
      rest: options.restPointsPerMinute ?? REST_POINTS_PER_MINUTE,
    };
    this.log = options.log ?? (() => {});
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => realSleep(ms));
  }

  /**
   * Runs `fn` once a slot and the point budget are both available. The slot is
   * returned on throw as well as on success — a failing request still occupied
   * the connection, and leaking slots on the error path would silently choke a
   * long run down to zero concurrency.
   */
  async run<T>(kind: ApiKind, points: number, fn: () => Promise<T>): Promise<T> {
    await this.acquireSlot();
    try {
      await this.awaitBudget(kind, Math.max(0, points));
      this.inFlight += 1;
      try {
        return await fn();
      } finally {
        this.inFlight -= 1;
      }
    } finally {
      this.releaseSlot();
    }
  }

  /**
   * Folds a response's rate-limit headers into the shared state. Called for
   * every response, including failures: the headers on a 403 are the only
   * warning we get before the token is blocked outright.
   */
  observe(headers: Headers): void {
    const remaining = numeric(headers.get("x-ratelimit-remaining"));
    if (remaining !== null) this.primaryRemaining = remaining;

    const reset = numeric(headers.get("x-ratelimit-reset"));
    if (reset !== null) this.primaryResetMs = reset * 1000;

    const used = numeric(headers.get("x-ratelimit-used"));
    if (used !== null) this.primaryUsed = used;

    // `retry-after` is an instruction, not a hint: ignoring it is what turns a
    // temporary secondary block into a longer one.
    const retryAfter = retryAfterMs(headers, this.now());
    if (retryAfter !== null) {
      this.pauseUntil(this.now() + retryAfter, "retry-after header");
      return;
    }

    if (remaining === 0 && this.primaryResetMs !== null) {
      this.pauseUntil(this.primaryResetMs, "primary rate limit exhausted");
    }
  }

  /** Parks every task — in flight or queued — until `epochMs`. Only ever moves
   *  the pause later, so a short advisory cannot cancel a longer one. */
  pauseUntil(epochMs: number, reason: string): void {
    if (!Number.isFinite(epochMs) || epochMs <= this.pausedUntilMs) return;
    this.pausedUntilMs = epochMs;
    const seconds = Math.ceil(Math.max(0, epochMs - this.now()) / 1000);
    this.log(`pausing all GitHub calls for ${seconds}s — ${reason}`);
  }

  /**
   * Sleeps out a primary exhaustion in one call. Polling the API to find out
   * whether the limit has lifted spends requests against the very budget that
   * is empty, and each one restarts the block, so the wait is a single sleep
   * against `x-ratelimit-reset` and nothing else.
   */
  async waitForPrimaryReset(): Promise<void> {
    if (this.primaryRemaining !== 0 || this.primaryResetMs === null) return;
    const waitMs = Math.max(0, this.primaryResetMs - this.now());
    if (waitMs === 0) return;
    this.log(
      `primary rate limit exhausted (used ${this.primaryUsed ?? "?"}); ` +
        `sleeping ${Math.ceil(waitMs / 1000)}s until reset without polling`,
    );
    await this.sleep(waitMs);
  }

  snapshot(): LimiterSnapshot {
    const now = this.now();
    return {
      inFlight: this.inFlight,
      graphqlPointsInWindow: this.pointsInWindow("graphql", now),
      restPointsInWindow: this.pointsInWindow("rest", now),
      primaryRemaining: this.primaryRemaining,
      pausedUntil: this.pausedUntilMs,
    };
  }

  private async acquireSlot(): Promise<void> {
    if (this.slotQueue.length === 0 && this.held < this.concurrency) {
      this.held += 1;
      return;
    }
    // The releasing task hands its slot over instead of freeing it, so a queued
    // task never has to re-check and never races another waiter for it.
    await new Promise<void>((resolve) => this.slotQueue.push(resolve));
  }

  private releaseSlot(): void {
    const next = this.slotQueue.shift();
    if (next) next();
    else this.held -= 1;
  }

  /**
   * Charges `points` against the sliding window, waiting for the oldest spend
   * to age out when the minute is already full.
   */
  private async awaitBudget(kind: ApiKind, points: number): Promise<void> {
    for (;;) {
      const now = this.now();

      if (this.pausedUntilMs > now) {
        await this.sleep(this.pausedUntilMs - now);
        continue;
      }

      const window = this.prune(kind, now);
      const used = window.reduce((sum, entry) => sum + entry.points, 0);

      // An empty window that still cannot fit the request means the request is
      // larger than the whole budget. Admitting it is the only way forward —
      // blocking would deadlock the run on a limit no wait can satisfy.
      if (used + points <= this.budgets[kind] || window.length === 0) {
        window.push({ at: now, points });
        return;
      }

      await this.sleep(Math.max(1, window[0].at + WINDOW_MS - now));
    }
  }

  private prune(kind: ApiKind, now: number): Spend[] {
    const window = this.spend[kind];
    while (window.length > 0 && window[0].at + WINDOW_MS <= now) window.shift();
    return window;
  }

  private pointsInWindow(kind: ApiKind, now: number): number {
    return this.prune(kind, now).reduce((sum, entry) => sum + entry.points, 0);
  }
}

export type FailureKind =
  | "retry-after"
  | "secondary"
  | "primary-exhausted"
  | "retryable"
  | "fatal";

export interface Failure {
  kind: FailureKind;
  /** How long to wait before the next attempt. Zero means "use backoff". */
  waitMs: number;
}

/**
 * Sorts a failed response into the four things GitHub actually means by it.
 *
 * The order matters. A secondary-limit 403 and a primary exhaustion look alike
 * from the status code alone, and treating a secondary block as a retryable
 * error — hammering it with quick retries — extends the block instead of
 * clearing it. `now` is injected so the primary reset arithmetic is testable.
 */
export function classifyFailure(
  status: number,
  headers: Headers,
  body: string,
  now: () => number = Date.now,
): Failure {
  const at = now();
  const advised = retryAfterMs(headers, at);

  if ((status === 403 || status === 429) && advised !== null) {
    return { kind: "retry-after", waitMs: advised };
  }

  // No `retry-after` on a secondary block means GitHub told us nothing; the
  // documented floor is a minute before trying again.
  if ((status === 403 || status === 429) && isSecondaryLimit(body)) {
    return { kind: "secondary", waitMs: SECONDARY_LIMIT_MIN_WAIT_MS };
  }

  if (headers.get("x-ratelimit-remaining") === "0") {
    const reset = numeric(headers.get("x-ratelimit-reset"));
    return {
      kind: "primary-exhausted",
      waitMs: reset === null ? SECONDARY_LIMIT_MIN_WAIT_MS : Math.max(0, reset * 1000 - at),
    };
  }

  if (status === 502 || status === 503 || status === 504) {
    return { kind: "retryable", waitMs: 0 };
  }

  return { kind: "fatal", waitMs: 0 };
}

/**
 * Full jitter, floored at a minute and capped at fifteen.
 *
 * Every task in a run hits the same limit at the same moment, so a shared
 * deterministic backoff makes them all retry in lockstep and collide again.
 * Picking uniformly from `[0, ceiling]` — not `[ceiling/2, ceiling]` — is what
 * actually spreads the herd.
 */
export function backoffWithJitter(
  attempt: number,
  minMs = 60_000,
  capMs = 900_000,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, Math.floor(attempt));
  const ceiling = Math.min(capMs, minMs * 2 ** exponent);
  return Math.round(random() * ceiling);
}

/** Attempts on one unit of work before it is written off. Retrying past this
 *  spends budget re-failing instead of on the places not yet crawled. */
export const DEAD_LETTER_ATTEMPTS = 5;

export const DEAD_LETTER_FILE = "_dead-letter.jsonl";

export interface DeadLetterOptions {
  /** Defaults to the repo's `data/`; overridable so tests never touch it. */
  dataDir?: string;
  now?: () => number;
}

export interface DeadLetterRecord {
  at: string;
  unit: string;
  error: string;
  attempts: number;
}

/**
 * Give-up log for units of work that failed {@link DEAD_LETTER_ATTEMPTS} times.
 *
 * A crawl covers thousands of independent places and one poisoned login must
 * not end the run — but it must not vanish either, or the snapshot quietly
 * loses rows with nothing to explain the gap. JSONL because it is appended to
 * across runs and one corrupt line stays one corrupt line.
 */
export class DeadLetter {
  private readonly filePath: string;
  private readonly now: () => number;
  private written = 0;

  constructor(options: DeadLetterOptions = {}) {
    this.filePath = path.join(options.dataDir ?? DATA_DIR, DEAD_LETTER_FILE);
    this.now = options.now ?? Date.now;
  }

  async record(unit: string, error: string, attempts: number): Promise<void> {
    const entry: DeadLetterRecord = {
      at: new Date(this.now()).toISOString(),
      unit,
      error,
      attempts,
    };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
    this.written += 1;
  }

  count(): number {
    return this.written;
  }

  get path(): string {
    return this.filePath;
  }
}

function numeric(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `retry-after` is seconds in practice, but the HTTP spec also allows a date;
 *  a misread here becomes an instant retry into an active block. */
function retryAfterMs(headers: Headers, now: number): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function isSecondaryLimit(body: string): boolean {
  return /secondary rate limit|abuse detection/i.test(body);
}
