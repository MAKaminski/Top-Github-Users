import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";

/**
 * Discovery from GH Archive — free, and the reason a full refresh can be timely.
 *
 * The alternative is REST user search, which is capped at 30 requests/minute and
 * 1,000 results per query. Covering every country and city that way costs
 * thousands of requests and hours of wall clock before a single profile is
 * hydrated, and it only ever finds people whose free-text profile location
 * happens to match a place name we guessed.
 *
 * GH Archive publishes every public GitHub event as one gzipped JSON-lines file
 * per hour at data.gharchive.org. Measured from this project: 22.4 MB per hour,
 * about 160,000 events and 63,000 distinct actors, downloaded and parsed in
 * roughly a second. No account, no token, no API budget.
 *
 * What it CANNOT give us (per the standing rules, and confirmed against real
 * files): actor records carry only `login`, `id` and `avatar_url`. There is no
 * bio, company, location, follower count or creation date — those still come
 * from GraphQL hydration. It also only contains accounts that did something
 * *public*, so a developer working mostly in private repositories never appears
 * here. That is why search is kept as a supplementary pass rather than deleted.
 */

const BASE = "https://data.gharchive.org";

/** Marker in the bucket's error body. Verified against the live archive: a
 *  missing hour answers 404 with `application/xml` carrying this code. The
 *  archive genuinely has gaps — two of three hours I sampled at random were
 *  absent — so this is an expected outcome, not an error path. */
const MISSING_KEY_MARKER = "NoSuchKey";

export interface ActorActivity {
  login: string;
  /** GitHub's numeric account id, useful for detecting renames later. */
  id: number;
  avatarUrl: string;
  /** Public events observed in the window. This is the filter signal. */
  events: number;
  /** ISO hour key of the most recent event seen, e.g. 2026-08-01-14. */
  lastSeen: string;
  /** Distinct repositories touched — separates one big push from broad work. */
  repos: number;
}

export interface HourResult {
  hour: string;
  status: "ok" | "missing" | "failed";
  events: number;
  actors: number;
  bytes: number;
  elapsedMs: number;
  error?: string;
}

/** `2026-08-01-14` for the hour beginning at that UTC time. */
export function hourKey(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)}-${Number(iso.slice(11, 13))}`;
}

/**
 * The trailing `hours` hour-keys, most recent first.
 *
 * Starts one hour back: the current hour is still being written and would give
 * a partial file that we would then cache as complete.
 */
export function recentHours(hours: number, now: Date): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= hours; i++) {
    keys.push(hourKey(new Date(now.getTime() - i * 3_600_000)));
  }
  return keys;
}

export function urlForHour(hour: string): string {
  return `${BASE}/${hour}.json.gz`;
}

/**
 * Event types that count as authorship.
 *
 * WatchEvent is a star, ForkEvent is a fork, and neither says the actor wrote
 * anything — counting them would rank the most enthusiastic browsers alongside
 * the most prolific authors. Everything here represents work landing.
 */
const AUTHORSHIP_EVENTS = new Set([
  "PushEvent",
  "PullRequestEvent",
  "PullRequestReviewEvent",
  "PullRequestReviewCommentEvent",
  "IssuesEvent",
  "IssueCommentEvent",
  "CommitCommentEvent",
  "CreateEvent",
  "ReleaseEvent",
  "GollumEvent",
]);

interface ArchiveEvent {
  type?: string;
  actor?: { id?: number; login?: string; avatar_url?: string };
  repo?: { id?: number; name?: string };
}

/**
 * Streams one hour into the accumulator.
 *
 * The file is gunzipped and read line by line — never buffered whole. A single
 * hour is 22 MB compressed and roughly 200 MB expanded; seven days of that in
 * memory at once would kill an Actions runner.
 */
export async function collectHour(
  hour: string,
  into: Map<string, ActorActivity>,
  reposByActor: Map<string, Set<number>>,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<HourResult> {
  const startedAt = Date.now();
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(urlForHour(hour), { signal: options.signal });
  } catch (error) {
    return {
      hour,
      status: "failed",
      events: 0,
      actors: 0,
      bytes: 0,
      elapsedMs: Date.now() - startedAt,
      error: (error as Error).message,
    };
  }

  // An absent hour is a 404 with `application/xml` (verified against the live
  // archive). A caching layer could serve the same body with a 200, and feeding
  // XML to gunzip would surface as an unexplained decompression failure rather
  // than the known gap it is — so the content type is checked too.
  const contentType = response.headers.get("content-type") ?? "";
  const looksLikeError = contentType.includes("xml") || contentType.includes("html");

  if (!response.ok || !response.body || looksLikeError) {
    // A genuinely absent hour is not a failure — the archive has known gaps and
    // a run must not abort because 2019-03-04-08 was never published.
    const body = await response.text().catch(() => "");
    const missing = response.status === 404 || body.includes(MISSING_KEY_MARKER) || looksLikeError;
    return {
      hour,
      status: missing ? "missing" : "failed",
      events: 0,
      actors: 0,
      bytes: 0,
      elapsedMs: Date.now() - startedAt,
      error: missing ? undefined : `HTTP ${response.status}`,
    };
  }

  let bytes = 0;
  let events = 0;
  const before = into.size;

  const source = Readable.fromWeb(response.body as never);
  source.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
  });

  const lines = createInterface({
    input: source.pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  try {
    for await (const line of lines) {
      if (!line) continue;

      let event: ArchiveEvent;
      try {
        event = JSON.parse(line) as ArchiveEvent;
      } catch {
        // A truncated final line is normal when a transfer is cut short.
        continue;
      }

      const type = event.type;
      if (!type || !AUTHORSHIP_EVENTS.has(type)) continue;

      const actor = event.actor;
      const login = actor?.login;
      if (!login) continue;

      events++;

      const existing = into.get(login);
      if (existing) {
        existing.events++;
        // Hours are processed newest-first, so the first sighting is the latest.
        if (hour > existing.lastSeen) existing.lastSeen = hour;
      } else {
        into.set(login, {
          login,
          id: actor?.id ?? 0,
          avatarUrl: actor?.avatar_url ?? "",
          events: 1,
          lastSeen: hour,
          repos: 0,
        });
      }

      const repoId = event.repo?.id;
      if (typeof repoId === "number") {
        let set = reposByActor.get(login);
        if (!set) {
          set = new Set();
          reposByActor.set(login, set);
        }
        set.add(repoId);
      }
    }
  } catch (error) {
    return {
      hour,
      status: "failed",
      events,
      actors: into.size - before,
      bytes,
      elapsedMs: Date.now() - startedAt,
      error: (error as Error).message,
    };
  }

  return {
    hour,
    status: "ok",
    events,
    actors: into.size - before,
    bytes,
    elapsedMs: Date.now() - startedAt,
  };
}

export interface DiscoveryResult {
  actors: ActorActivity[];
  hours: HourResult[];
  totalEvents: number;
  totalBytes: number;
  elapsedMs: number;
}

/**
 * Walks a set of hours and returns every actor seen, ranked by event count.
 *
 * Hours are fetched with small concurrency: this is plain object storage rather
 * than the GitHub API, but there is no reason to be rude to it, and a runner's
 * memory is the real constraint anyway.
 */
export async function discover(
  hours: string[],
  options: {
    concurrency?: number;
    onHour?: (result: HourResult) => void;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  } = {},
): Promise<DiscoveryResult> {
  const startedAt = Date.now();
  const actors = new Map<string, ActorActivity>();
  const reposByActor = new Map<string, Set<number>>();
  const results: HourResult[] = [];

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8));
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, hours.length) }, async () => {
    while (cursor < hours.length) {
      const hour = hours[cursor++];
      const result = await collectHour(hour, actors, reposByActor, {
        fetchImpl: options.fetchImpl,
        signal: options.signal,
      });
      results.push(result);
      options.onHour?.(result);
    }
  });

  await Promise.all(workers);

  for (const [login, repos] of reposByActor) {
    const actor = actors.get(login);
    if (actor) actor.repos = repos.size;
  }

  // Deterministic order: events desc, then repos desc, then login — the same
  // tie-break discipline the rest of the pipeline uses, so a rerun that sees
  // identical data produces an identical file.
  const ranked = [...actors.values()].sort(
    (a, b) => b.events - a.events || b.repos - a.repos || a.login.localeCompare(b.login),
  );

  return {
    actors: ranked,
    hours: results.sort((a, b) => a.hour.localeCompare(b.hour)),
    totalEvents: results.reduce((sum, r) => sum + r.events, 0),
    totalBytes: results.reduce((sum, r) => sum + r.bytes, 0),
    elapsedMs: Date.now() - startedAt,
  };
}

/**
 * Cuts the candidate list before any budget is spent.
 *
 * This is the highest-leverage filter in the pipeline: every actor dropped here
 * is a GraphQL point not spent. `alwaysKeep` carries forward logins already on a
 * board so an established name who had a quiet week does not fall off, and bots
 * are dropped on the naming convention GitHub itself uses.
 */
export function filterCandidates(
  actors: ActorActivity[],
  options: {
    minEvents?: number;
    limit?: number;
    alwaysKeep?: Set<string>;
    excludeBots?: boolean;
    maxEventsPerRepo?: number;
  } = {},
): {
  candidates: ActorActivity[];
  consideredThreshold: number;
  droppedBots: number;
  droppedLoops: number;
} {
  const minEvents = options.minEvents ?? 1;
  const excludeBots = options.excludeBots ?? true;
  const alwaysKeep = options.alwaysKeep ?? new Set<string>();
  const maxEventsPerRepo = options.maxEventsPerRepo ?? 250;

  let droppedBots = 0;
  let droppedLoops = 0;
  const eligible = actors.filter((actor) => {
    if (excludeBots && isLikelyBot(actor.login)) {
      droppedBots++;
      return false;
    }
    // Automation running under a personal account, which the `[bot]` naming
    // convention cannot catch. Measured against three real hours of the archive:
    // the top human contributors spread work over many repositories, while
    // accounts like `trieu1082` fired ~3,000 events at a *single* repo in three
    // hours. Volume alone would rank those first; volume per repository is what
    // separates a person from a loop.
    if (!alwaysKeep.has(actor.login) && actor.repos > 0 && actor.events / actor.repos > maxEventsPerRepo) {
      droppedLoops++;
      return false;
    }
    return actor.events >= minEvents || alwaysKeep.has(actor.login);
  });

  const limit = options.limit ?? eligible.length;
  const candidates = eligible.slice(0, limit);

  // Anyone already on a board must survive the cut even if they fell below the
  // limit, or the leaderboard would churn purely on a slow week.
  if (alwaysKeep.size > 0 && candidates.length < eligible.length) {
    const present = new Set(candidates.map((a) => a.login));
    for (const actor of eligible.slice(limit)) {
      if (alwaysKeep.has(actor.login) && !present.has(actor.login)) candidates.push(actor);
    }
  }

  return {
    candidates,
    consideredThreshold: minEvents,
    droppedBots,
    droppedLoops,
  };
}

/** GitHub's own convention is a `[bot]` suffix; the rest are conventional. */
export function isLikelyBot(login: string): boolean {
  return (
    login.endsWith("[bot]") ||
    /(^|-)bot$/i.test(login) ||
    /^(dependabot|renovate|github-actions|greenkeeper|imgbot|snyk-bot|allcontributors)/i.test(login)
  );
}
