import { CAVEATS } from "@/lib/api/caveats";
import { baseUrlFrom, handle, json } from "@/lib/api/http";
import { getManifest } from "@/lib/api/queries";

/**
 * Discovery document for the MCP server.
 *
 * A client that knows only the domain can find the endpoint, the transport and
 * the tool list from here without a human pasting a URL. Everything is derived
 * from the incoming request, so the same code is correct on localhost and on the
 * deployed domain — a hardcoded origin is the usual way this file goes stale.
 */

const TOOLS: { name: string; description: string }[] = [
  {
    name: "commitgraph_get_integration_guide",
    description:
      "Start here. How the dataset is built, what each tool answers, and the caveats that apply " +
      "to every number returned.",
  },
  {
    name: "commitgraph_describe_dataset",
    description: "Snapshot date, coverage counts and totals, and where the data came from.",
  },
  {
    name: "commitgraph_list_places",
    description:
      "Countries and cities with user counts and contribution totals. Use it to find the ids " +
      "the other tools take.",
  },
  {
    name: "commitgraph_get_leaderboard",
    description: "Ranked developers for worldwide, a country or a city.",
  },
  {
    name: "commitgraph_search_developers",
    description:
      "Filter every ranked developer by location, company, contributions, followers or free text.",
  },
  {
    name: "commitgraph_get_developer",
    description:
      "One developer: profile, ranks and contribution calendar. Says so explicitly when a login " +
      "is ranked but has no stored profile record.",
  },
  {
    name: "commitgraph_compare_developers",
    description: "Several developers side by side, with the same coverage honesty as get_developer.",
  },
  {
    name: "commitgraph_get_organizations",
    description: "Employers ranked by the combined contributions of tracked developers.",
  },
  {
    name: "commitgraph_get_rank_history",
    description:
      "Rank movement across snapshots. Reports that a series is not plottable rather than " +
      "inventing a trend from one crawl.",
  },
  {
    name: "commitgraph_get_statistics",
    description:
      "Dataset-wide aggregates: public/private split, follower-versus-contribution correlation, " +
      "contribution percentiles, per-region totals.",
  },
];

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const manifest = await getManifest();
    const base = baseUrlFrom(request);

    return json({
      name: "commitgraph",
      title: "Commitgraph",
      description:
        "The most active developers on GitHub, ranked worldwide and by country and city, from a " +
        `snapshot generated on ${manifest.generatedAt}.`,
      version: `1.0.0+snapshot.${manifest.generatedAt}`,
      snapshot: manifest.generatedAt,
      servers: [
        {
          name: "commitgraph",
          url: `${base}/api/mcp`,
          transport: "streamable-http",
          method: "POST",
          protocol: "jsonrpc-2.0",
          protocolVersion: "2025-06-18",
          authentication: { type: "none" },
        },
      ],
      // Repeated at the top level because most clients read only the first
      // server entry and some read neither — one endpoint, stated twice.
      endpoint: `${base}/api/mcp`,
      transport: "streamable-http",
      protocolVersion: "2025-06-18",
      tools: TOOLS,
      links: {
        restIndex: `${base}/api/v1`,
        openapi: `${base}/api/openapi.json`,
        llmsTxt: `${base}/llms.txt`,
        methodology: `${base}/methodology`,
        website: base,
      },
      caveats: CAVEATS,
    });
  });
}
