import { CAVEATS } from "@/lib/api/caveats";
import { baseUrlFrom, handle, json } from "@/lib/api/http";
import { DEFAULT_PAGE, MAX_PAGE, getManifest } from "@/lib/api/queries";

/**
 * OpenAPI 3.1 for the REST mirror under /api/v1.
 *
 * Hand-written rather than generated, and kept in step with lib/types.ts by
 * hand: the schemas below are the same shapes, spelled as JSON Schema. If a
 * field changes there, change it here.
 *
 * Nullability uses `type: ["x", "null"]` because 3.1 dropped the 3.0 `nullable`
 * keyword; a tool that rejects this is reading it as 3.0.
 */

const nullable = (type: string) => ({ type: [type, "null"] });

const ERROR_RESPONSE = {
  type: "object",
  required: ["error"],
  properties: {
    snapshot: nullable("string"),
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", enum: ["bad_request", "not_found", "internal_error"] },
        message: { type: "string" },
      },
    },
  },
};

const ENVELOPE = {
  snapshot: { type: "string", description: "Date the snapshot was generated, YYYY-MM-DD." },
  source: { type: "string", enum: ["crawler", "bootstrap"] },
};

const PAGE_FIELDS = {
  total: { type: "integer", description: "Matching rows before paging." },
  limit: { type: "integer", description: "Page size actually applied, after clamping." },
  offset: { type: "integer" },
  hasMore: { type: "boolean" },
};

const SCHEMAS: Record<string, unknown> = {
  Error: ERROR_RESPONSE,

  Place: {
    type: "object",
    required: ["id", "name", "userCount", "totalContributions", "totalFollowers", "top"],
    properties: {
      id: { type: "string", example: "japan" },
      name: { type: "string" },
      iso2: { ...nullable("string"), description: "ISO 3166-1 alpha-2 where known." },
      region: { ...nullable("string"), description: "Countries only." },
      countryId: { ...nullable("string"), description: "Cities only." },
      userCount: { type: "integer" },
      totalContributions: { type: "integer" },
      totalFollowers: { type: "integer" },
      kind: { type: "string", enum: ["country", "city"] },
      top: {
        type: "array",
        items: {
          type: "object",
          required: ["login", "avatarUrl", "total"],
          properties: {
            login: { type: "string" },
            avatarUrl: { type: "string" },
            total: { type: "integer" },
          },
        },
      },
    },
  },

  LeaderboardEntry: {
    type: "object",
    required: ["rank", "login", "avatarUrl", "followers", "total", "public", "private", "hasProfile"],
    properties: {
      rank: { type: "integer" },
      login: { type: "string" },
      name: nullable("string"),
      avatarUrl: { type: "string" },
      location: { ...nullable("string"), description: "Raw free-text location from GitHub." },
      company: nullable("string"),
      followers: { type: "integer" },
      total: { type: "integer", description: "Public plus private contributions, trailing twelve months." },
      public: { type: "integer" },
      private: { type: "integer" },
      countryId: nullable("string"),
      cityId: nullable("string"),
      previousRank: { ...nullable("integer"), description: "Null until a second snapshot exists." },
      hasProfile: { type: "boolean", description: "False when only the leaderboard row is stored." },
    },
  },

  SearchRow: {
    type: "object",
    required: ["login", "avatarUrl", "followers", "total", "public", "private", "hasProfile"],
    properties: {
      login: { type: "string" },
      name: nullable("string"),
      avatarUrl: { type: "string" },
      company: nullable("string"),
      location: nullable("string"),
      followers: { type: "integer" },
      total: { type: "integer" },
      public: { type: "integer" },
      private: { type: "integer" },
      countryId: nullable("string"),
      cityId: nullable("string"),
      worldwideRank: nullable("integer"),
      countryRank: nullable("integer"),
      cityRank: nullable("integer"),
      hasProfile: { type: "boolean" },
    },
  },

  Contributions: {
    type: "object",
    required: ["total", "public", "private"],
    properties: {
      total: { type: "integer" },
      public: { type: "integer" },
      private: { type: "integer", description: "The count GitHub exposes, never the underlying work." },
      commits: { ...nullable("integer"), description: "Only the GraphQL enrichment pass breaks the total down this far." },
      pullRequests: nullable("integer"),
      issues: nullable("integer"),
      reviews: nullable("integer"),
    },
  },

  RankedUser: {
    type: "object",
    required: ["login", "avatarUrl", "followers", "contributions", "rank", "flagged"],
    properties: {
      login: { type: "string" },
      name: nullable("string"),
      avatarUrl: { type: "string" },
      location: nullable("string"),
      company: nullable("string"),
      bio: nullable("string"),
      followers: { type: "integer" },
      publicRepos: nullable("integer"),
      contributions: { $ref: "#/components/schemas/Contributions" },
      calendar: {
        oneOf: [{ type: "array", items: { type: "integer" }, minItems: 371, maxItems: 371 }, { type: "null" }],
        description: "371 daily counts (53 weeks x 7 days), oldest first. Null when not stored.",
      },
      calendarSource: { $ref: "#/components/schemas/Provenance" },
      languages: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "share"],
          properties: { name: { type: "string" }, share: { type: "number", description: "0..1." } },
        },
      },
      languageSource: { $ref: "#/components/schemas/Provenance" },
      streak: {
        oneOf: [
          {
            type: "object",
            required: ["current", "longest"],
            properties: { current: { type: "integer" }, longest: { type: "integer" } },
          },
          { type: "null" },
        ],
      },
      rank: {
        type: "object",
        properties: {
          worldwide: nullable("integer"),
          country: nullable("integer"),
          city: nullable("integer"),
        },
      },
      countryId: nullable("string"),
      cityId: nullable("string"),
      flagged: {
        type: "boolean",
        description:
          "True when the account's activity is implausible for a human. Flagged accounts are " +
          "excluded from every ranking but listed openly.",
      },
    },
  },

  Provenance: {
    type: "string",
    enum: ["measured", "estimated", "unavailable"],
    description: "How a field was obtained. An `estimated` field must never be quoted as observed.",
  },

  ResolvedCalendar: {
    type: "object",
    required: ["days", "estimated", "monthly", "streak", "busiestDay", "activeDays"],
    properties: {
      days: { type: "array", items: { type: "integer" }, description: "371 daily counts, oldest first." },
      estimated: {
        type: "boolean",
        description:
          "True when the day-by-day shape was derived from the measured total rather than fetched. " +
          "The total still matches exactly and the same login always yields the same shape.",
      },
      monthly: { type: "array", items: { type: "integer" } },
      streak: {
        type: "object",
        properties: { current: { type: "integer" }, longest: { type: "integer" } },
      },
      busiestDay: { type: "integer" },
      activeDays: { type: "integer" },
    },
  },

  Organization: {
    type: "object",
    required: ["rank", "login", "avatarUrl", "followers"],
    properties: {
      rank: { type: "integer" },
      login: { type: "string" },
      name: nullable("string"),
      avatarUrl: { type: "string" },
      location: nullable("string"),
      followers: { type: "integer" },
      publicRepos: nullable("integer"),
    },
  },

  Repository: {
    type: "object",
    required: ["rank", "nameWithOwner", "stars", "forks", "ownerAvatarUrl"],
    properties: {
      rank: { type: "integer" },
      nameWithOwner: { type: "string" },
      description: nullable("string"),
      stars: { type: "integer" },
      forks: { type: "integer" },
      language: nullable("string"),
      ownerAvatarUrl: { type: "string" },
    },
  },

  HistorySeries: {
    type: "object",
    required: ["scope", "dates", "series"],
    properties: {
      scope: { type: "string" },
      dates: { type: "array", items: { type: "string" }, description: "Snapshot dates, oldest first." },
      series: {
        type: "array",
        items: {
          type: "object",
          required: ["login", "ranks", "totals"],
          properties: {
            login: { type: "string" },
            ranks: { type: "array", items: nullable("integer") },
            totals: { type: "array", items: nullable("integer") },
          },
        },
      },
    },
  },

  Manifest: {
    type: "object",
    required: ["generatedAt", "source", "sourceNote", "counts", "totals", "countries", "cities"],
    properties: {
      generatedAt: { type: "string" },
      source: { type: "string", enum: ["crawler", "bootstrap"] },
      sourceNote: { type: "string" },
      counts: {
        type: "object",
        properties: {
          users: { type: "integer" },
          countries: { type: "integer" },
          cities: { type: "integer" },
          organizations: { type: "integer" },
          repositories: { type: "integer" },
          flagged: { type: "integer", description: "Accounts excluded from rankings as automation." },
        },
      },
      totals: {
        type: "object",
        properties: {
          contributions: { type: "integer" },
          publicContributions: { type: "integer" },
          privateContributions: { type: "integer" },
          followers: { type: "integer" },
        },
      },
      snapshotDates: { type: "array", items: { type: "string" } },
      countries: { type: "array", items: { $ref: "#/components/schemas/Place" } },
      cities: { type: "array", items: { $ref: "#/components/schemas/Place" } },
    },
  },

  Statistics: {
    type: "object",
    required: ["snapshot", "counts", "totals", "publicPrivateSplit", "contributionPercentiles"],
    properties: {
      snapshot: { type: "string" },
      source: { type: "string" },
      counts: { type: "object", additionalProperties: { type: "integer" } },
      totals: { type: "object", additionalProperties: { type: "integer" } },
      worldwideSample: { type: "integer", description: "Rows the aggregates were computed over." },
      publicPrivateSplit: {
        type: "object",
        properties: {
          public: { type: "integer" },
          private: { type: "integer" },
          publicShare: { type: "number" },
        },
      },
      followersVsContributions: {
        type: "object",
        properties: {
          correlationLogLog: { type: "number", description: "Pearson r on log10 of both axes." },
          sample: { type: "integer" },
          note: { type: "string" },
        },
      },
      contributionPercentiles: {
        type: "object",
        properties: {
          p10: { type: "integer" },
          p25: { type: "integer" },
          p50: { type: "integer" },
          p75: { type: "integer" },
          p90: { type: "integer" },
          p99: { type: "integer" },
        },
      },
      byRegion: {
        type: "array",
        items: {
          type: "object",
          properties: {
            region: { type: "string" },
            countries: { type: "integer" },
            users: { type: "integer" },
            contributions: { type: "integer" },
          },
        },
      },
    },
  },
};

/** Every list endpoint answers with the same envelope. */
function pagedResponse(itemsRef: string, extra: Record<string, unknown> = {}) {
  return {
    type: "object",
    required: ["snapshot", "total", "limit", "offset", "hasMore", "items"],
    properties: {
      ...ENVELOPE,
      ...PAGE_FIELDS,
      ...extra,
      items: { type: "array", items: { $ref: itemsRef } },
    },
  };
}

function jsonResponse(description: string, schema: unknown) {
  return { description, content: { "application/json": { schema } } };
}

const NOT_FOUND = jsonResponse("Unknown id or scope.", { $ref: "#/components/schemas/Error" });
const BAD_REQUEST = jsonResponse("A query parameter failed to parse.", {
  $ref: "#/components/schemas/Error",
});

const LIMIT_PARAM = {
  name: "limit",
  in: "query",
  required: false,
  description: `Page size. Values outside 1..${MAX_PAGE} are clamped; the applied value is echoed in the response.`,
  schema: { type: "integer", minimum: 1, maximum: MAX_PAGE, default: DEFAULT_PAGE },
};

const OFFSET_PARAM = {
  name: "offset",
  in: "query",
  required: false,
  schema: { type: "integer", minimum: 0, default: 0 },
};

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const manifest = await getManifest();
    const base = baseUrlFrom(request);

    const document = {
      openapi: "3.1.0",
      info: {
        title: "Commitgraph REST API",
        version: `1.0.0+snapshot.${manifest.generatedAt}`,
        summary: "The most active developers on GitHub, ranked worldwide and by country and city.",
        description: [
          "Read-only access to the Commitgraph snapshot generated on " +
            `${manifest.generatedAt} (${manifest.source}). ${manifest.sourceNote}`,
          "",
          "Read this before quoting a number:",
          "",
          ...CAVEATS.map((caveat) => `- ${caveat}`),
        ].join("\n"),
      },
      servers: [{ url: base, description: "This deployment." }],
      tags: [
        { name: "discovery", description: "Self-describing entry points." },
        { name: "leaderboards", description: "Ranked developers by scope." },
        { name: "developers", description: "Individual and searchable developer records." },
        { name: "places", description: "Countries and cities." },
        { name: "aggregates", description: "Dataset-wide numbers and history." },
      ],
      paths: {
        "/api/v1": {
          get: {
            tags: ["discovery"],
            operationId: "getIndex",
            summary: "Endpoint catalogue with parameters and caveats.",
            responses: {
              "200": jsonResponse("The API index.", {
                type: "object",
                properties: {
                  ...ENVELOPE,
                  name: { type: "string" },
                  version: { type: "string" },
                  baseUrl: { type: "string" },
                  endpoints: { type: "array", items: { type: "object" } },
                  caveats: { type: "array", items: { type: "string" } },
                },
              }),
            },
          },
        },

        "/api/v1/manifest": {
          get: {
            tags: ["discovery"],
            operationId: "getManifest",
            summary: "Snapshot metadata and every place with its aggregates.",
            responses: {
              "200": jsonResponse("The manifest.", {
                type: "object",
                required: ["snapshot", "manifest"],
                properties: { ...ENVELOPE, manifest: { $ref: "#/components/schemas/Manifest" } },
              }),
            },
          },
        },

        "/api/v1/leaderboard/{scope}": {
          get: {
            tags: ["leaderboards"],
            operationId: "getLeaderboard",
            summary: "Ranked developers for a scope.",
            description:
              "Scope is `worldwide`, `country:{id}` or `city:{id}`. The colon must be " +
              "percent-encoded in the path: /api/v1/leaderboard/country%3Ajapan.",
            parameters: [
              {
                name: "scope",
                in: "path",
                required: true,
                schema: { type: "string", examples: ["worldwide", "country:japan", "city:jp-tokyo"] },
              },
              LIMIT_PARAM,
              OFFSET_PARAM,
            ],
            responses: {
              "200": jsonResponse(
                "A page of the leaderboard.",
                pagedResponse("#/components/schemas/LeaderboardEntry", {
                  scope: { type: "string" },
                  name: { type: "string" },
                  generatedAt: { type: "string" },
                }),
              ),
              "400": BAD_REQUEST,
              "404": NOT_FOUND,
            },
          },
        },

        "/api/v1/developers": {
          get: {
            tags: ["developers"],
            operationId: "searchDevelopers",
            summary: "Search every ranked developer in the snapshot.",
            parameters: [
              {
                name: "q",
                in: "query",
                required: false,
                description: "Substring match over login, name, company and location.",
                schema: { type: "string" },
              },
              { name: "country", in: "query", required: false, schema: { type: "string", examples: ["japan"] } },
              { name: "city", in: "query", required: false, schema: { type: "string", examples: ["jp-tokyo"] } },
              {
                name: "company",
                in: "query",
                required: false,
                description: "Substring match over the free-text company field.",
                schema: { type: "string" },
              },
              { name: "minContributions", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
              { name: "maxContributions", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
              { name: "minFollowers", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
              {
                name: "hasProfile",
                in: "query",
                required: false,
                description: "Restrict to logins that do, or do not, have a stored profile record.",
                schema: { type: "boolean" },
              },
              {
                name: "sort",
                in: "query",
                required: false,
                schema: {
                  type: "string",
                  enum: ["contributions", "followers", "rank", "login"],
                  default: "contributions",
                },
              },
              LIMIT_PARAM,
              OFFSET_PARAM,
            ],
            responses: {
              "200": jsonResponse(
                "A page of matching developers.",
                pagedResponse("#/components/schemas/SearchRow", {
                  filters: { type: "object", description: "The filters as applied." },
                  sort: { type: "string" },
                }),
              ),
              "400": BAD_REQUEST,
            },
          },
        },

        "/api/v1/developers/{login}": {
          get: {
            tags: ["developers"],
            operationId: "getDeveloper",
            summary: "One developer.",
            description:
              "Returns 200 with `found: false` and reason `no-profile` when the login is ranked " +
              "but has no stored profile record — that is a coverage gap, and the leaderboard row " +
              "is still returned. 404 means the login is not in the snapshot at all, which does " +
              "not imply the GitHub account does not exist.",
            parameters: [
              { name: "login", in: "path", required: true, schema: { type: "string", examples: ["felixonmars"] } },
            ],
            responses: {
              "200": jsonResponse("The developer, or the coverage note plus the index row.", {
                oneOf: [
                  {
                    type: "object",
                    required: ["snapshot", "found", "developer", "calendar"],
                    properties: {
                      ...ENVELOPE,
                      found: { const: true },
                      developer: { $ref: "#/components/schemas/RankedUser" },
                      calendar: { $ref: "#/components/schemas/ResolvedCalendar" },
                      indexRow: {
                        oneOf: [{ $ref: "#/components/schemas/SearchRow" }, { type: "null" }],
                      },
                    },
                  },
                  {
                    type: "object",
                    required: ["snapshot", "found", "reason", "indexRow", "note"],
                    properties: {
                      ...ENVELOPE,
                      found: { const: false },
                      reason: { const: "no-profile" },
                      indexRow: { $ref: "#/components/schemas/SearchRow" },
                      note: { type: "string" },
                    },
                  },
                ],
              }),
              "404": NOT_FOUND,
            },
          },
        },

        "/api/v1/places": {
          get: {
            tags: ["places"],
            operationId: "listPlaces",
            summary: "Countries and cities, most contributions first.",
            parameters: [
              {
                name: "kind",
                in: "query",
                required: false,
                schema: { type: "string", enum: ["country", "city", "all"], default: "all" },
              },
              { name: "region", in: "query", required: false, schema: { type: "string", examples: ["Asia"] } },
              {
                name: "countryId",
                in: "query",
                required: false,
                description: "Restrict cities to one country.",
                schema: { type: "string", examples: ["japan"] },
              },
              {
                name: "q",
                in: "query",
                required: false,
                description: "Substring match over place name and id.",
                schema: { type: "string" },
              },
              LIMIT_PARAM,
              OFFSET_PARAM,
            ],
            responses: {
              "200": jsonResponse(
                "A page of places.",
                pagedResponse("#/components/schemas/Place", {
                  filters: { type: "object" },
                }),
              ),
              "400": BAD_REQUEST,
            },
          },
        },

        "/api/v1/places/{id}": {
          get: {
            tags: ["places"],
            operationId: "getPlace",
            summary: "One country or city with a page of its leaderboard.",
            parameters: [
              { name: "id", in: "path", required: true, schema: { type: "string", examples: ["japan", "jp-tokyo"] } },
              LIMIT_PARAM,
              OFFSET_PARAM,
            ],
            responses: {
              "200": jsonResponse("The place and its leaderboard page.", {
                type: "object",
                required: ["snapshot", "place", "leaderboard"],
                properties: {
                  ...ENVELOPE,
                  place: { $ref: "#/components/schemas/Place" },
                  leaderboard: {
                    type: "object",
                    properties: {
                      available: { type: "boolean" },
                      note: { type: "string" },
                      scope: { type: "string" },
                      ...PAGE_FIELDS,
                      items: {
                        type: "array",
                        items: { $ref: "#/components/schemas/LeaderboardEntry" },
                      },
                    },
                  },
                },
              }),
              "400": BAD_REQUEST,
              "404": NOT_FOUND,
            },
          },
        },

        "/api/v1/organizations": {
          get: {
            tags: ["aggregates"],
            operationId: "getOrganizations",
            summary: "Employers ranked by the contributions of tracked developers who name them.",
            responses: {
              "200": jsonResponse("The complete organization list.", {
                type: "object",
                required: ["snapshot", "total", "items"],
                properties: {
                  ...ENVELOPE,
                  total: { type: "integer" },
                  note: { type: "string" },
                  items: { type: "array", items: { $ref: "#/components/schemas/Organization" } },
                },
              }),
            },
          },
        },

        "/api/v1/repositories": {
          get: {
            tags: ["aggregates"],
            operationId: "getRepositories",
            summary: "Top repositories. Empty in the current snapshot.",
            description:
              "Repository collection is not part of the current crawl, so this returns an empty " +
              "list with a note explaining why rather than looking like a failure.",
            responses: {
              "200": jsonResponse("The repository list, possibly empty.", {
                type: "object",
                required: ["snapshot", "total", "items", "note"],
                properties: {
                  ...ENVELOPE,
                  total: { type: "integer" },
                  note: { type: "string" },
                  items: { type: "array", items: { $ref: "#/components/schemas/Repository" } },
                },
              }),
            },
          },
        },

        "/api/v1/history/{scope}": {
          get: {
            tags: ["aggregates"],
            operationId: "getRankHistory",
            summary: "Rank movement across snapshots for a scope.",
            description:
              "Reports `plottable: false` when fewer than two snapshots exist, rather than " +
              "inventing a trend from a single crawl.",
            parameters: [
              {
                name: "scope",
                in: "path",
                required: true,
                schema: { type: "string", examples: ["worldwide", "country:japan"] },
              },
            ],
            responses: {
              "200": jsonResponse("The history series, or a note explaining its absence.", {
                type: "object",
                required: ["snapshot", "scope", "plottable", "note"],
                properties: {
                  ...ENVELOPE,
                  scope: { type: "string" },
                  plottable: { type: "boolean" },
                  note: { type: "string" },
                  history: {
                    oneOf: [{ $ref: "#/components/schemas/HistorySeries" }, { type: "null" }],
                  },
                },
              }),
              "404": NOT_FOUND,
            },
          },
        },

        "/api/v1/statistics": {
          get: {
            tags: ["aggregates"],
            operationId: "getStatistics",
            summary: "Dataset-wide aggregates.",
            responses: {
              "200": jsonResponse("The statistics block.", {
                type: "object",
                required: ["snapshot", "statistics"],
                properties: { ...ENVELOPE, statistics: { $ref: "#/components/schemas/Statistics" } },
              }),
            },
          },
        },
      },
      components: { schemas: SCHEMAS },
    };

    return json(document);
  });
}
