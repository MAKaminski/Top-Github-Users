import { z } from "zod";
import {
  compareDevelopers,
  getDeveloper,
  getFlaggedAccounts,
  getLeaderboard,
  getManifest,
  getOrganizations,
  getRankHistory,
  getRepositories,
  getStatistics,
  listPlaces,
  searchDevelopers,
  type DeveloperResult,
} from "@/lib/api/queries";
import { abbreviate, exact } from "@/lib/format";

/**
 * The tool corpus.
 *
 * Each tool is one object holding its zod schema (which both validates the call
 * and generates the advertised inputSchema), a handler returning plain data, and
 * a markdown renderer. Callers choose the shape with `response_format`, matching
 * the ergonomics of the pattern server this project already consumes.
 */

const format = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("markdown for reading, json for programmatic consumption.");

const limit = z.number().int().min(1).max(200).default(25).describe("Maximum rows to return.");
const offset = z.number().int().min(0).default(0).describe("Rows to skip, for paging.");

export interface Tool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  handler: (args: z.infer<S>) => Promise<unknown>;
  render: (data: never) => string;
}

function tool<S extends z.ZodType>(definition: {
  name: string;
  description: string;
  schema: S;
  handler: (args: z.infer<S>) => Promise<unknown>;
  render: (data: never) => string;
}): Tool<S> {
  return definition;
}

/* ---------------------------------------------------------------- helpers */

function table(headers: string[], rows: (string | number)[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return [head, rule, body].join("\n");
}

function developerBlock(result: DeveloperResult): string {
  if (!result.found && result.reason === "unknown") return result.note;

  if (!result.found) {
    const row = result.indexRow;
    return [
      `## ${row.name ?? row.login} \`${row.login}\``,
      "",
      `**No stored profile record.** ${result.note}`,
      "",
      table(
        ["Contributions", "Public", "Private", "Followers", "Worldwide", "Country", "City"],
        [
          [
            exact(row.total),
            exact(row.public),
            exact(row.private),
            exact(row.followers),
            row.worldwideRank ?? "—",
            row.countryRank ?? "—",
            row.cityRank ?? "—",
          ],
        ],
      ),
    ].join("\n");
  }

  const { user, calendar } = result;
  return [
    `## ${user.name ?? user.login} \`${user.login}\``,
    user.company || user.location
      ? `${[user.company, user.location].filter(Boolean).join(" · ")}`
      : "",
    "",
    table(
      ["Contributions", "Public", "Private", "Followers", "Worldwide", "Country", "City"],
      [
        [
          exact(user.contributions.total),
          exact(user.contributions.public),
          exact(user.contributions.private),
          exact(user.followers),
          user.rank.worldwide ?? "—",
          user.rank.country ?? "—",
          user.rank.city ?? "—",
        ],
      ],
    ),
    "",
    `- Country: ${user.countryId ?? "unknown"} · City: ${user.cityId ?? "unknown"}`,
    `- Streak: ${calendar.streak.current} current, ${calendar.streak.longest} longest`,
    `- Active days: ${calendar.activeDays} of ${calendar.days.length}; busiest ${calendar.busiestDay}`,
    `- Monthly totals: ${calendar.monthly.join(", ")}`,
    `- Calendar provenance: **${calendar.estimated ? "estimated" : "measured"}**` +
      (calendar.estimated
        ? " — the total is measured; the day-by-day shape is derived deterministically from it."
        : ""),
    user.flagged ? "- **Flagged as automation** and excluded from rankings." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------------------------------------------ tools */

const getIntegrationGuide = tool({
  name: "commitgraph_get_integration_guide",
  description:
    "Describes what this server is, every tool it exposes, how to connect from Claude Code or " +
    "any MCP client, what the data means, and where it is wrong. Call this first if you are a " +
    "service deciding how to consume this dataset.",
  schema: z.object({ response_format: format }),
  handler: async () => {
    const manifest = await getManifest();
    return { manifest };
  },
  render: (data: { manifest: Awaited<ReturnType<typeof getManifest>> }) => {
    const m = data.manifest;
    return `# Commitgraph MCP

Rankings of the most active developers on GitHub, by contributions over the trailing twelve
months, worldwide and per country and city. Read-only and public.

**Snapshot ${m.generatedAt}** · source \`${m.source}\` · ${exact(m.counts.users)} developers ·
${m.counts.countries} countries · ${m.counts.cities} cities · ${m.counts.flagged} accounts excluded.

## Connect

\`\`\`
claude mcp add --transport http commitgraph https://<domain>/api/mcp
\`\`\`

POST JSON-RPC 2.0 to \`/api/mcp\`. Protocol 2025-06-18. No authentication; GET returns 405.
A REST mirror of the same data is at \`/api/v1\`, described by \`/api/openapi.json\`.

## Tools

| Tool | Use it for |
| --- | --- |
| \`commitgraph_describe_dataset\` | The dictionary: every field, its meaning and provenance, and all valid scope ids. **Start here.** |
| \`commitgraph_list_places\` | Country and city ids, with totals. |
| \`commitgraph_get_leaderboard\` | A ranked board for \`worldwide\`, \`country:{id}\` or \`city:{id}\`. |
| \`commitgraph_search_developers\` | Find developers by name, company, location or numeric filters. |
| \`commitgraph_get_developer\` | One developer in full, with calendar and streaks. |
| \`commitgraph_compare_developers\` | Two to five developers side by side. |
| \`commitgraph_get_organizations\` | Employers ranked by their developers' combined output. |
| \`commitgraph_get_rank_history\` | Rank movement across snapshots. |
| \`commitgraph_get_statistics\` | Distributions and aggregates. |

## What the numbers mean, and where they are wrong

- A score is **public plus private contributions** over the trailing twelve months. Private is the
  count GitHub itself exposes — never the underlying work.
- **Location is free text** on a GitHub profile. Country comes from searching that field; city is
  parsed from the same string. This is the largest source of error and it affects every site in
  this space equally.
- **Measured against estimated:** totals and follower counts are measured. Where the day-by-day
  calendar has not been crawled, the heatmap *shape* is a deterministic estimate derived from the
  measured total. Every record says which it is.
- **Automation is excluded.** Accounts above 300,000 contributions in twelve months — over 820 a
  day without a break — are removed from rankings and listed openly rather than dropped silently.
- **Coverage:** many ranked developers have no stored profile record. \`commitgraph_get_developer\`
  says so explicitly and still returns the leaderboard row.

## Policy

Public, read-only, and holds only this snapshot. It has no access to secrets, environment values,
filesystems, databases or user data.`;
  },
});

const describeDataset = tool({
  name: "commitgraph_describe_dataset",
  description:
    "The dictionary of what is available: snapshot date and provenance, all counts and totals, " +
    "every field with its meaning, and the complete list of valid scope ids. Call this before " +
    "querying so you know what can be asked for.",
  schema: z.object({
    include_scopes: z
      .boolean()
      .default(true)
      .describe("Include the full list of country and city scope ids."),
    response_format: format,
  }),
  handler: async (args) => {
    const manifest = await getManifest();
    return {
      snapshot: manifest.generatedAt,
      source: manifest.source,
      sourceNote: manifest.sourceNote,
      counts: manifest.counts,
      totals: manifest.totals,
      snapshotDates: manifest.snapshotDates,
      fields: FIELD_DICTIONARY,
      scopes: args.include_scopes
        ? {
            worldwide: ["worldwide"],
            country: manifest.countries.map((p) => `country:${p.id}`),
            city: manifest.cities.map((p) => `city:${p.id}`),
          }
        : undefined,
    };
  },
  render: (data: {
    snapshot: string;
    source: string;
    sourceNote: string;
    counts: Record<string, number>;
    totals: Record<string, number>;
    fields: typeof FIELD_DICTIONARY;
    scopes?: { worldwide: string[]; country: string[]; city: string[] };
  }) =>
    [
      `# Dataset — snapshot ${data.snapshot}`,
      "",
      `Source: \`${data.source}\`. ${data.sourceNote}`,
      "",
      "## Counts",
      table(
        Object.keys(data.counts),
        [Object.values(data.counts).map((v) => exact(v))],
      ),
      "",
      "## Totals",
      table(Object.keys(data.totals), [Object.values(data.totals).map((v) => exact(v))]),
      "",
      "## Fields",
      table(
        ["Field", "Type", "Meaning"],
        data.fields.map((f) => [`\`${f.field}\``, f.type, f.meaning]),
      ),
      "",
      data.scopes
        ? [
            "## Scopes",
            "",
            `Worldwide: \`worldwide\``,
            "",
            `Countries (${data.scopes.country.length}): ${data.scopes.country.join(", ")}`,
            "",
            `Cities (${data.scopes.city.length}): ${data.scopes.city.join(", ")}`,
          ].join("\n")
        : "Scope list omitted — call again with include_scopes true.",
    ].join("\n"),
});

const FIELD_DICTIONARY = [
  { field: "login", type: "string", meaning: "GitHub username." },
  { field: "contributions.total", type: "int", meaning: "Public + private, trailing 12 months. Measured." },
  { field: "contributions.public", type: "int", meaning: "Public contributions. Measured." },
  { field: "contributions.private", type: "int", meaning: "Private contribution count as GitHub reports it. Measured." },
  { field: "contributions.commits/pullRequests/issues/reviews", type: "int|null", meaning: "Breakdown; null until the GraphQL enrichment pass has run." },
  { field: "followers", type: "int", meaning: "Follower count. Measured." },
  { field: "calendar", type: "int[371]|null", meaning: "53 weeks x 7 days, oldest first. Null when not crawled." },
  { field: "calendarSource", type: "enum", meaning: "measured | estimated | unavailable. Never present an estimate as a measurement." },
  { field: "streak", type: "{current,longest}", meaning: "Derived from the calendar; inherits its provenance." },
  { field: "rank.worldwide/country/city", type: "int|null", meaning: "1-based. Ties break on followers, then login." },
  { field: "countryId", type: "string|null", meaning: "Country scope id, e.g. japan. From free-text location." },
  { field: "cityId", type: "string|null", meaning: "City scope id, e.g. jp-tokyo. Parsed from free-text location." },
  { field: "flagged", type: "boolean", meaning: "Above 300,000 contributions/year — treated as automation and excluded from rankings." },
  { field: "hasProfile", type: "boolean", meaning: "Whether a full stored record exists. False means leaderboard row only." },
] as const;

const listPlacesTool = tool({
  name: "commitgraph_list_places",
  description:
    "List countries and cities with their scope ids, ISO-2 code, region, developer count and " +
    "contribution totals. Use this to discover valid ids before calling get_leaderboard.",
  schema: z.object({
    kind: z.enum(["country", "city", "all"]).default("all"),
    region: z.string().optional().describe("Filter countries by region, e.g. Europe."),
    country_id: z.string().optional().describe("Filter cities to one country, e.g. japan."),
    query: z.string().max(80).optional().describe("Free-text match on name or id."),
    limit,
    offset,
    response_format: format,
  }),
  handler: (args) =>
    listPlaces(
      { kind: args.kind, region: args.region, countryId: args.country_id, query: args.query },
      args.limit,
      args.offset,
    ),
  render: (data: Awaited<ReturnType<typeof listPlaces>>) =>
    [
      `# Places — ${data.items.length} of ${exact(data.total)}`,
      "",
      table(
        ["Scope id", "Name", "Kind", "ISO", "Developers", "Contributions"],
        data.items.map((p) => [
          `\`${p.kind}:${p.id}\``,
          p.name,
          p.kind,
          p.iso2 ?? "—",
          exact(p.userCount),
          abbreviate(p.totalContributions),
        ]),
      ),
      data.hasMore ? `\nMore available — offset ${data.offset + data.limit}.` : "",
    ].join("\n"),
});

const getLeaderboardTool = tool({
  name: "commitgraph_get_leaderboard",
  description:
    "A ranked board for a scope: 'worldwide', 'country:{id}' or 'city:{id}'. Ranked by " +
    "contributions, ties broken on followers then login.",
  schema: z.object({
    scope: z.string().default("worldwide").describe("worldwide, country:{id}, or city:{id}."),
    limit,
    offset,
    response_format: format,
  }),
  handler: (args) => getLeaderboard(args.scope, args.limit, args.offset),
  render: (data: Awaited<ReturnType<typeof getLeaderboard>>) => {
    if ("error" in data) return data.error;
    return [
      `# ${data.board.name} — snapshot ${data.board.generatedAt}`,
      "",
      `Showing ${data.page.items.length} of ${exact(data.page.total)}.`,
      "",
      table(
        ["#", "Login", "Name", "Contributions", "Followers", "Profile"],
        data.page.items.map((e) => [
          e.rank,
          `\`${e.login}\``,
          e.name ?? "—",
          exact(e.total),
          exact(e.followers),
          e.hasProfile ? "yes" : "row only",
        ]),
      ),
      data.page.hasMore ? `\nMore available — offset ${data.page.offset + data.page.limit}.` : "",
    ].join("\n");
  },
});

const searchDevelopersTool = tool({
  name: "commitgraph_search_developers",
  description:
    "Find developers by free text over login, name, company and location, combined with numeric " +
    "and place filters. The primary retrieval tool.",
  schema: z.object({
    query: z.string().max(120).optional().describe("Free text over login, name, company, location."),
    country_id: z.string().optional(),
    city_id: z.string().optional(),
    company: z.string().max(80).optional(),
    min_contributions: z.number().int().min(0).optional(),
    max_contributions: z.number().int().min(0).optional(),
    min_followers: z.number().int().min(0).optional(),
    has_profile: z.boolean().optional().describe("Restrict to developers with a stored record."),
    sort: z.enum(["contributions", "followers", "rank", "login"]).default("contributions"),
    limit,
    offset,
    response_format: format,
  }),
  handler: (args) =>
    searchDevelopers(
      {
        query: args.query,
        countryId: args.country_id,
        cityId: args.city_id,
        company: args.company,
        minContributions: args.min_contributions,
        maxContributions: args.max_contributions,
        minFollowers: args.min_followers,
        hasProfile: args.has_profile,
        sort: args.sort,
      },
      args.limit,
      args.offset,
    ),
  render: (data: Awaited<ReturnType<typeof searchDevelopers>>) =>
    data.total === 0
      ? "No developers matched. Widen the filters, or call commitgraph_describe_dataset for the field meanings."
      : [
          `# ${exact(data.total)} matches — showing ${data.items.length}`,
          "",
          table(
            ["Login", "Name", "Company", "Location", "Contributions", "Followers", "WW rank"],
            data.items.map((r) => [
              `\`${r.login}\``,
              r.name ?? "—",
              r.company ?? "—",
              r.location ?? "—",
              exact(r.total),
              exact(r.followers),
              r.worldwideRank ?? "—",
            ]),
          ),
          data.hasMore ? `\nMore available — offset ${data.offset + data.limit}.` : "",
        ].join("\n"),
});

const getDeveloperTool = tool({
  name: "commitgraph_get_developer",
  description:
    "One developer in full: contributions, ranks, contribution calendar, streaks and monthly " +
    "totals. If the developer is ranked but has no stored profile record, the leaderboard row is " +
    "returned with an explanation rather than an empty result.",
  schema: z.object({
    login: z.string().min(1).max(64).describe("GitHub username, with or without a leading @."),
    response_format: format,
  }),
  handler: (args) => getDeveloper(args.login),
  render: (data: DeveloperResult) => developerBlock(data),
});

const compareDevelopersTool = tool({
  name: "commitgraph_compare_developers",
  description: "Two to five developers side by side on the same measures.",
  schema: z.object({
    logins: z.array(z.string().min(1).max(64)).min(2).max(5),
    response_format: format,
  }),
  handler: (args) => compareDevelopers(args.logins),
  render: (data: DeveloperResult[]) => {
    const rows = data.map((result) => {
      if (!result.found && result.reason === "unknown") return ["—", "not in snapshot", "", "", ""];
      const row = result.found
        ? {
            login: result.user.login,
            total: result.user.contributions.total,
            followers: result.user.followers,
            rank: result.user.rank.worldwide,
            country: result.user.countryId,
          }
        : {
            login: result.indexRow.login,
            total: result.indexRow.total,
            followers: result.indexRow.followers,
            rank: result.indexRow.worldwideRank,
            country: result.indexRow.countryId,
          };
      return [
        `\`${row.login}\``,
        exact(row.total),
        exact(row.followers),
        row.rank ?? "—",
        row.country ?? "—",
      ];
    });
    return [
      "# Comparison",
      "",
      table(["Login", "Contributions", "Followers", "Worldwide rank", "Country"], rows),
    ].join("\n");
  },
});

const getOrganizationsTool = tool({
  name: "commitgraph_get_organizations",
  description:
    "Organizations ranked by the combined contributions of tracked developers who name them in " +
    "their profile — not by follower count. Drawn from a free-text company field.",
  schema: z.object({ limit, offset, response_format: format }),
  handler: async (args) => {
    const all = await getOrganizations();
    return {
      items: all.slice(args.offset, args.offset + args.limit),
      total: all.length,
      note: "Ranked by aggregate contributions of self-reported members. Company is free text, so spelling variants are distinct entries.",
    };
  },
  render: (data: { items: Awaited<ReturnType<typeof getOrganizations>>; total: number; note: string }) =>
    [
      `# Organizations — ${data.items.length} of ${data.total}`,
      "",
      data.note,
      "",
      table(
        ["#", "Organization", "Members tracked", "Combined contributions"],
        data.items.map((o) => [o.rank, o.login, o.name ?? "—", exact(o.publicRepos ?? 0)]),
      ),
    ].join("\n"),
});

const getRankHistoryTool = tool({
  name: "commitgraph_get_rank_history",
  description:
    "Rank movement across snapshots for a scope. Reports plainly when there are too few " +
    "snapshots to plot rather than returning an empty series.",
  schema: z.object({
    scope: z.string().default("worldwide"),
    response_format: format,
  }),
  handler: (args) => getRankHistory(args.scope),
  render: (data: Awaited<ReturnType<typeof getRankHistory>>) => {
    if (!data.plottable) return `# Rank history\n\n${data.note}`;
    const h = data.history!;
    return [
      `# Rank history — ${h.scope}`,
      "",
      data.note,
      "",
      table(
        ["Login", ...h.dates],
        h.series.map((s) => [`\`${s.login}\``, ...s.ranks.map((r) => r ?? "—")]),
      ),
    ].join("\n");
  },
});

const getStatisticsTool = tool({
  name: "commitgraph_get_statistics",
  description:
    "Aggregate distributions across the snapshot: contribution percentiles, the public/private " +
    "split, per-region totals, and the log-log correlation between followers and contributions.",
  schema: z.object({ response_format: format }),
  handler: () => getStatistics(),
  render: (data: Awaited<ReturnType<typeof getStatistics>>) =>
    [
      `# Statistics — snapshot ${data.snapshot}`,
      "",
      `Sample: the worldwide top ${exact(data.worldwideSample)}.`,
      "",
      "## Contribution percentiles",
      table(
        ["p10", "p25", "p50", "p75", "p90", "p99"],
        [Object.values(data.contributionPercentiles).map((v) => exact(v))],
      ),
      "",
      "## Public against private",
      `${exact(data.publicPrivateSplit.public)} public, ${exact(data.publicPrivateSplit.private)} private ` +
        `(${(data.publicPrivateSplit.publicShare * 100).toFixed(1)}% public).`,
      "",
      "## Followers against contributions",
      `r = ${data.followersVsContributions.correlationLogLog} over ${exact(data.followersVsContributions.sample)} developers. ` +
        data.followersVsContributions.note,
      "",
      "## By region",
      table(
        ["Region", "Countries", "Developers", "Contributions"],
        data.byRegion.map((r) => [r.region, r.countries, exact(r.users), abbreviate(r.contributions)]),
      ),
    ].join("\n"),
});

const getRepositoriesTool = tool({
  name: "commitgraph_get_repositories",
  description:
    "The repository board. Produced by the scheduled crawler; returns an explicit empty state " +
    "until that has run, rather than placeholder rows.",
  schema: z.object({ limit, offset, response_format: format }),
  handler: async (args) => {
    const all = await getRepositories();
    return {
      items: all.slice(args.offset, args.offset + args.limit),
      total: all.length,
      note:
        all.length === 0
          ? "Empty. This board is produced by the scheduled crawler, which has not run yet."
          : "",
    };
  },
  render: (data: { items: Awaited<ReturnType<typeof getRepositories>>; total: number; note: string }) =>
    data.total === 0
      ? `# Repositories\n\n${data.note}`
      : [
          `# Repositories — ${data.items.length} of ${data.total}`,
          "",
          table(
            ["#", "Repository", "Stars", "Language"],
            data.items.map((r) => [r.rank, r.nameWithOwner, exact(r.stars), r.language ?? "—"]),
          ),
        ].join("\n"),
});

const getFlaggedTool = tool({
  name: "commitgraph_get_flagged_accounts",
  description:
    "Accounts excluded from every ranking as automation — above 300,000 contributions in twelve " +
    "months. Published rather than dropped silently so the rule can be audited.",
  schema: z.object({ response_format: format }),
  handler: async () => ({
    accounts: await getFlaggedAccounts(),
    threshold: 300000,
    rationale:
      "300,000 contributions in twelve months is over 820 every day without a break. The most " +
      "prolific genuine maintainers land in the low hundreds of thousands, so this removes only " +
      "accounts whose numbers cannot be produced by a person.",
  }),
  render: (data: {
    accounts: Awaited<ReturnType<typeof getFlaggedAccounts>>;
    threshold: number;
    rationale: string;
  }) =>
    [
      `# Excluded accounts — threshold ${exact(data.threshold)}/year`,
      "",
      data.rationale,
      "",
      data.accounts.length
        ? table(
            ["Login", "Contributions", "Followers", "Country"],
            data.accounts.map((a) => [
              `\`${a.login}\``,
              exact(a.total),
              exact(a.followers),
              a.countryId ?? "—",
            ]),
          )
        : "None in this snapshot.",
    ].join("\n"),
});

export const TOOLS: Tool[] = [
  getIntegrationGuide,
  describeDataset,
  listPlacesTool,
  getLeaderboardTool,
  searchDevelopersTool,
  getDeveloperTool,
  compareDevelopersTool,
  getOrganizationsTool,
  getRepositoriesTool,
  getRankHistoryTool,
  getStatisticsTool,
  getFlaggedTool,
] as Tool[];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
