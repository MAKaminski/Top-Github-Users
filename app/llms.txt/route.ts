import { CAVEATS } from "@/lib/api/caveats";
import { CORS_HEADERS, baseUrlFrom, handle } from "@/lib/api/http";
import { getManifest } from "@/lib/api/queries";
import { loadSearchIndex } from "@/lib/api/search-index";
import { PROMPTS } from "@/lib/mcp/prompts";
import { PROTOCOL_VERSION } from "@/lib/mcp/protocol";
import { TOOLS } from "@/lib/mcp/tools";

/**
 * /llms.txt — the plain-text brief for a model that lands on this domain.
 *
 * Kept short and factual on purpose: it exists to point at the machine surfaces
 * and to state, up front, what the numbers cannot support. The caveats are the
 * same strings the REST index and the OpenAPI description use.
 */

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const [manifest, rows] = await Promise.all([getManifest(), loadSearchIndex()]);
    const base = baseUrlFrom(request);
    const withProfile = rows.filter((row) => row.hasProfile).length;

    // Interpolated sentences are assembled on one line each: a template literal
    // would otherwise wrap them wherever the source happens to break, which puts
    // newlines mid-sentence once the numbers change length.
    const count = (value: number) => value.toLocaleString("en-US");

    /** Names are read from the server's own registries rather than retyped, so
     *  this file cannot fall behind the tools it advertises. Wrapped by hand
     *  because the surrounding document is plain text with a hanging indent,
     *  and a single 400-column line reads badly in a terminal. */
    const wrapList = (names: string[], width = 92): string => {
      const lines: string[] = [];
      for (const name of names) {
        const last = lines[lines.length - 1];
        if (last !== undefined && `${last}, ${name}`.length <= width) {
          lines[lines.length - 1] = `${last}, ${name}`;
        } else {
          lines.push(name);
        }
      }
      return lines.join(",\n  ");
    };

    const intro = [
      `Commitgraph ranks ${count(manifest.counts.users)} developers across`,
      `${manifest.counts.countries} countries and ${manifest.counts.cities} cities by their`,
      "public plus private contributions over the trailing twelve months.",
      `Source: ${manifest.source}. ${manifest.sourceNote}`,
    ].join(" ");

    const coverage = [
      `Profile coverage in this snapshot: ${count(withProfile)} of the ${count(rows.length)}`,
      "logins in the search index have a stored profile record. The rest are present as",
      "leaderboard rows only, and a lookup for one of them returns the row plus a note rather",
      "than a 404.",
    ].join(" ");

    const excluded = [
      `Accounts excluded as automation in this snapshot: ${manifest.counts.flagged}.`,
      `They are listed openly at ${base}/methodology.`,
    ].join(" ");

    const body = `# Commitgraph

> Leaderboards of the most active developers on GitHub — worldwide, and by country and city —
> built from a periodic crawl and served as a static snapshot. Snapshot: ${manifest.generatedAt}.

${intro}

## Model Context Protocol

- Endpoint: ${base}/api/mcp
- Method: POST, JSON-RPC 2.0, protocol version ${PROTOCOL_VERSION}, no authentication
- Discovery: ${base}/.well-known/mcp.json
- Install instructions for every client: ${base}/connect
- Tools: ${wrapList(TOOLS.map((tool) => tool.name))}
- Prompts: ${wrapList(PROMPTS.map((prompt) => prompt.name))}

Call commitgraph_get_integration_guide first; it explains the dataset before you query it.

In Claude, add ${base}/api/mcp under Settings → Connectors, or run
\`claude mcp add --transport http commitgraph ${base}/api/mcp\` in Claude Code.

## REST

Every endpoint is GET, returns JSON, and sets access-control-allow-origin: *. Every response
carries the snapshot date it was built from.

- ${base}/api/v1 — endpoint catalogue with parameters (start here)
- ${base}/api/openapi.json — OpenAPI 3.1 description of everything below
- ${base}/api/v1/manifest — snapshot metadata, and every country and city with its aggregates
- ${base}/api/v1/leaderboard/{scope} — scope is worldwide, country:{id} or city:{id};
  the colon is percent-encoded in the path, e.g. /api/v1/leaderboard/country%3Ajapan
- ${base}/api/v1/developers — search: q, country, city, company, minContributions,
  maxContributions, minFollowers, hasProfile, sort, limit, offset
- ${base}/api/v1/developers/{login} — one developer
- ${base}/api/v1/places — kind, region, countryId, q, limit, offset
- ${base}/api/v1/places/{id} — one country or city with its leaderboard page
- ${base}/api/v1/organizations — employers ranked by their developers' contributions
- ${base}/api/v1/repositories — empty in this snapshot; the response says so
- ${base}/api/v1/history/{scope} — rank movement across snapshots
- ${base}/api/v1/statistics — dataset-wide aggregates

## What these numbers will not support

${CAVEATS.map((caveat) => `- ${caveat}`).join("\n\n")}

${coverage}

${excluded}

## Pages

- ${base}/ — worldwide leaderboard and overview
- ${base}/leaderboard — the full ranking
- ${base}/countries and ${base}/cities — place indexes
- ${base}/u/{login} — a developer's profile
- ${base}/methodology — how the numbers are made, and where they are wrong
- ${base}/connect — how to add this server to Claude and other MCP clients
`;

    return new Response(body, {
      headers: { "content-type": "text/plain; charset=utf-8", ...CORS_HEADERS },
    });
  });
}
