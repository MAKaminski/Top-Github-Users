import { CAVEATS } from "@/lib/api/caveats";
import { baseUrlFrom, handle, ok } from "@/lib/api/http";
import { DEFAULT_PAGE, MAX_PAGE } from "@/lib/api/queries";

/**
 * The entry point a human or an agent hits first.
 *
 * Everything the other ten routes accept is described here, so a caller can work
 * the whole API from this one response without reading the OpenAPI document.
 */

interface Param {
  name: string;
  type: "string" | "integer" | "boolean";
  description: string;
}

const PAGE_PARAMS: Param[] = [
  { name: "limit", type: "integer", description: `Page size, 1..${MAX_PAGE}. Default ${DEFAULT_PAGE}. Out-of-range values are clamped.` },
  { name: "offset", type: "integer", description: "Rows to skip. Default 0." },
];

const ENDPOINTS: { path: string; summary: string; params: Param[] }[] = [
  {
    path: "/api/v1/manifest",
    summary: "Snapshot metadata: generation date, source, counts, totals, and every country and city with its aggregates.",
    params: [],
  },
  {
    path: "/api/v1/leaderboard/{scope}",
    summary: "Ranked developers for a scope. Scope is \"worldwide\", \"country:{id}\" or \"city:{id}\" — the colon must be percent-encoded as %3A in the path.",
    params: PAGE_PARAMS,
  },
  {
    path: "/api/v1/developers",
    summary: "Search every ranked developer in the snapshot.",
    params: [
      { name: "q", type: "string", description: "Substring match over login, name, company and location." },
      { name: "country", type: "string", description: "Country id, e.g. japan. See /api/v1/places?kind=country." },
      { name: "city", type: "string", description: "City id, e.g. jp-tokyo. See /api/v1/places?kind=city." },
      { name: "company", type: "string", description: "Substring match over the free-text company field." },
      { name: "minContributions", type: "integer", description: "Lower bound on twelve-month contributions." },
      { name: "maxContributions", type: "integer", description: "Upper bound on twelve-month contributions." },
      { name: "minFollowers", type: "integer", description: "Lower bound on followers." },
      { name: "hasProfile", type: "boolean", description: "Restrict to logins that do (or do not) have a stored profile record." },
      { name: "sort", type: "string", description: "contributions (default), followers, rank or login." },
      ...PAGE_PARAMS,
    ],
  },
  {
    path: "/api/v1/developers/{login}",
    summary: "One developer: profile, ranks, resolved calendar and index row. Returns 200 with found:false and reason \"no-profile\" when the login is ranked but has no stored profile record.",
    params: [],
  },
  {
    path: "/api/v1/places",
    summary: "Countries and cities with user counts and contribution totals, most contributions first.",
    params: [
      { name: "kind", type: "string", description: "country, city or all (default)." },
      { name: "region", type: "string", description: "Continent-level region, countries only, e.g. Asia." },
      { name: "countryId", type: "string", description: "Restrict cities to one country, e.g. japan." },
      { name: "q", type: "string", description: "Substring match over place name and id." },
      ...PAGE_PARAMS,
    ],
  },
  {
    path: "/api/v1/places/{id}",
    summary: "One country or city, with its leaderboard page.",
    params: PAGE_PARAMS,
  },
  {
    path: "/api/v1/organizations",
    summary: "Employers ranked by the combined contributions of tracked developers who name them. Complete list, no paging.",
    params: [],
  },
  {
    path: "/api/v1/repositories",
    summary: "Top repositories. Not collected by the current snapshot — returns an empty list with a note saying so.",
    params: [],
  },
  {
    path: "/api/v1/history/{scope}",
    summary: "Rank movement over successive snapshots for a scope. Reports plottable:false rather than inventing a trend when fewer than two snapshots exist.",
    params: [],
  },
  {
    path: "/api/v1/statistics",
    summary: "Dataset-wide aggregates: public/private split, follower-versus-contribution correlation, contribution percentiles, per-region totals.",
    params: [],
  },
];

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const base = baseUrlFrom(request);

    return ok({
      name: "Commitgraph REST API",
      version: "v1",
      description:
        "Read-only mirror of the Commitgraph snapshot: the most active developers on GitHub, " +
        "ranked worldwide and by country and city. Every endpoint is GET, returns JSON and is " +
        "open to any origin.",
      baseUrl: `${base}/api/v1`,
      conventions: {
        pagination:
          "List endpoints return { total, limit, offset, hasMore, items }. `limit` and `offset` " +
          "are echoed back as applied, so a clamped page size is visible to the caller.",
        errors: "Failures return { snapshot, error: { code, message } } with a 4xx or 5xx status.",
        freshness: "Every response carries `snapshot` (the crawl date) and `source`.",
        cors: "access-control-allow-origin: * on every response.",
      },
      endpoints: ENDPOINTS.map((endpoint) => ({ ...endpoint, url: `${base}${endpoint.path}` })),
      caveats: CAVEATS,
      alsoAvailable: {
        mcp: `${base}/api/mcp`,
        mcpDiscovery: `${base}/.well-known/mcp.json`,
        openapi: `${base}/api/openapi.json`,
        llmsTxt: `${base}/llms.txt`,
        methodology: `${base}/methodology`,
      },
    });
  });
}
