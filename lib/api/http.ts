import { DEFAULT_PAGE, MAX_PAGE, getManifest } from "@/lib/api/queries";

/**
 * Plumbing for the REST mirror under app/api/v1.
 *
 * Response shape, CORS, query-param parsing and the error body live here so the
 * eleven route files stay thin. No data logic — everything they serve comes from
 * lib/api/queries.ts, the same layer the MCP server calls.
 */

/**
 * The snapshot is public, static and free of credentials, so any origin may read
 * it. Agents routinely call these endpoints from a browser page they did not
 * serve, and a same-origin policy would break that for no benefit.
 */
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export interface JsonInit {
  status?: number;
  headers?: Record<string, string>;
}

export function json(body: unknown, init: JsonInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...init.headers,
    },
  });
}

/**
 * The snapshot date, or null if the manifest itself cannot be read.
 *
 * Never throws: it is attached to error responses too, and an error handler that
 * can itself fail is worse than one that omits a field.
 */
async function snapshotDate(): Promise<string | null> {
  try {
    return (await getManifest()).generatedAt;
  } catch {
    return null;
  }
}

/**
 * A success body. Every payload leads with the snapshot date and its provenance
 * so a caller can tell how fresh the answer is without a second request — the
 * data is a periodic crawl, not a live view of GitHub.
 */
export async function ok(payload: Record<string, unknown>, init: JsonInit = {}): Promise<Response> {
  const manifest = await getManifest();
  return json(
    { snapshot: manifest.generatedAt, source: manifest.source, ...payload },
    init,
  );
}

export type ErrorCode = "bad_request" | "not_found" | "internal_error";

export async function fail(code: ErrorCode, message: string, status: number): Promise<Response> {
  return json({ snapshot: await snapshotDate(), error: { code, message } }, { status });
}

/**
 * Runs a handler and turns anything thrown into a 500 with the same error body
 * shape as every other failure. The loaders in lib/data.ts throw on a missing or
 * schema-invalid snapshot file, which would otherwise surface as an HTML error
 * page to a caller that asked for JSON.
 */
export async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("internal_error", message, 500);
  }
}

/**
 * Absolute base URL for the self-describing documents.
 *
 * `request.url` reports the internal origin behind a proxy — on Vercel that is
 * plain http and a rewritten host — so the forwarded headers win where present.
 * This is what keeps /.well-known/mcp.json correct on localhost and in
 * production without a hardcoded domain or an env var to forget.
 */
export function baseUrlFrom(request: Request): string {
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    new URL(request.url).host;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  const proto = request.headers.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Path segments arrive percent-encoded when they contain a colon — scopes look
 * like `country:japan`, so `/leaderboard/country%3Ajapan` is the normal form.
 * Next already decodes params, so this is a second, harmless pass that also
 * covers a client that double-encoded; a malformed sequence is left alone rather
 * than throwing a URIError out of the route.
 */
export function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/* ------------------------------------------------------------ query params */

export interface QueryReader {
  text(name: string): string | undefined;
  integer(name: string, bounds?: { min?: number; max?: number }): number | undefined;
  boolean(name: string): boolean | undefined;
  choice<T extends string>(name: string, allowed: readonly T[]): T | undefined;
  /** Clamped to 1..MAX_PAGE. The clamped value is echoed back in the payload.
   *  Parsed eagerly, so a malformed page size reaches `problem()` no matter
   *  where in a route the value is read. */
  readonly limit: number;
  readonly offset: number;
  /** Joined message for every rejected parameter, or null when all parsed. */
  problem(): string | null;
}

/**
 * Reads and validates the query string.
 *
 * Bad input is collected rather than silently coerced: a caller who asks for
 * `sort=stars` should get a 400 naming the values that exist, not a page sorted
 * some other way that looks like an answer to their question.
 */
export function readQuery(url: string): QueryReader {
  const params = new URL(url).searchParams;
  const problems: string[] = [];

  function text(name: string): string | undefined {
    const raw = params.get(name)?.trim();
    return raw ? raw : undefined;
  }

  function integer(name: string, bounds: { min?: number; max?: number } = {}): number | undefined {
    const raw = text(name);
    if (raw === undefined) return undefined;

    const value = Number(raw);
    if (!Number.isInteger(value)) {
      problems.push(`"${name}" must be an integer, got "${raw}".`);
      return undefined;
    }
    // Clamping rather than rejecting: an out-of-range page size is a request for
    // "as much as you'll give me", and the response reports what it actually used.
    const min = bounds.min ?? Number.MIN_SAFE_INTEGER;
    const max = bounds.max ?? Number.MAX_SAFE_INTEGER;
    return Math.min(Math.max(value, min), max);
  }

  function boolean(name: string): boolean | undefined {
    const raw = text(name)?.toLowerCase();
    if (raw === undefined) return undefined;
    if (["true", "1", "yes"].includes(raw)) return true;
    if (["false", "0", "no"].includes(raw)) return false;
    problems.push(`"${name}" must be true or false, got "${raw}".`);
    return undefined;
  }

  function choice<T extends string>(name: string, allowed: readonly T[]): T | undefined {
    const raw = text(name);
    if (raw === undefined) return undefined;
    if ((allowed as readonly string[]).includes(raw)) return raw as T;
    problems.push(`"${name}" must be one of ${allowed.join(", ")}; got "${raw}".`);
    return undefined;
  }

  return {
    text,
    integer,
    boolean,
    choice,
    limit: integer("limit", { min: 1, max: MAX_PAGE }) ?? DEFAULT_PAGE,
    offset: integer("offset", { min: 0 }) ?? 0,
    problem: () => (problems.length ? problems.join(" ") : null),
  };
}
