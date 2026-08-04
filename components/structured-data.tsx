import { MCP_URL, REPO_URL, SITE_URL } from "@/lib/site";
import type { Manifest } from "@/lib/types";

/**
 * JSON-LD for the site.
 *
 * Two audiences, one block. Search engines read `WebSite` and `Dataset`;
 * assistants and dataset indexes read the same `Dataset` node to learn what
 * this corpus contains, how big it is, and — the part that matters here — how
 * to query it directly rather than scraping the HTML.
 *
 * `distribution` is the reason this is worth having at all. It names the MCP
 * endpoint, the REST mirror and the OpenAPI document as first-class ways to get
 * the data, so a crawler that understands schema.org can discover the API
 * without a human reading /connect.
 *
 * Everything asserted here is checkable against the site. The counts come from
 * the manifest rather than being written by hand, and `temporalCoverage`
 * describes the trailing twelve months the snapshot actually measures. Inflated
 * or invented structured data is both a ranking risk and, for this project,
 * exactly the dishonesty the methodology page exists to avoid.
 */
export function StructuredData({ manifest }: { manifest: Manifest }) {
  const graph = [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "Commitgraph",
      description:
        "Leaderboards of the most active developers on GitHub — worldwide, and by country and city.",
      inLanguage: "en",
      publisher: { "@id": `${SITE_URL}/#person` },
    },
    {
      "@type": "Person",
      "@id": `${SITE_URL}/#person`,
      name: "Michael Kaminski",
      url: REPO_URL,
    },
    {
      "@type": "Dataset",
      "@id": `${SITE_URL}/#dataset`,
      name: "Commitgraph developer activity snapshot",
      description:
        `Public plus private GitHub contribution totals over the trailing twelve months for ` +
        `${manifest.counts.users.toLocaleString("en-US")} developers across ` +
        `${manifest.counts.countries} countries and ${manifest.counts.cities} cities, with ` +
        `contribution calendars, streaks and rank history. Contribution totals are measured; ` +
        `calendars that have not been crawled are labelled estimates. Location is self-reported.`,
      url: SITE_URL,
      isAccessibleForFree: true,
      license: "https://opensource.org/licenses/MIT",
      creator: { "@id": `${SITE_URL}/#person` },
      dateModified: manifest.generatedAt,
      // The snapshot measures a trailing twelve-month window ending at the
      // generation date. Open-ended on the left would overstate its reach.
      temporalCoverage: `${manifest.generatedAt}/P12M`,
      keywords: [
        "GitHub",
        "open source contributions",
        "developer activity",
        "leaderboard",
        "software development",
      ],
      distribution: [
        {
          "@type": "DataDownload",
          name: "Model Context Protocol endpoint",
          encodingFormat: "application/json",
          contentUrl: MCP_URL,
          description:
            "JSON-RPC 2.0 over HTTP POST. Public and read-only, no authentication required.",
        },
        {
          "@type": "DataDownload",
          name: "REST API",
          encodingFormat: "application/json",
          contentUrl: `${SITE_URL}/api/v1`,
        },
        {
          "@type": "DataDownload",
          name: "OpenAPI 3.1 description",
          encodingFormat: "application/json",
          contentUrl: `${SITE_URL}/api/openapi.json`,
        },
      ],
    },
    {
      "@type": "WebAPI",
      "@id": `${SITE_URL}/#api`,
      name: "Commitgraph MCP server",
      description:
        "A Model Context Protocol connector for Claude and other MCP clients. Twelve read-only " +
        "tools and five prompts over the Commitgraph snapshot. No authentication.",
      url: `${SITE_URL}/connect`,
      documentation: `${SITE_URL}/connect`,
      endpointUrl: MCP_URL,
      provider: { "@id": `${SITE_URL}/#person` },
      termsOfService: `${SITE_URL}/methodology`,
    },
  ];

  return (
    <script
      type="application/ld+json"
      // The payload is built from our own constants and the manifest, never
      // from user input, so there is no injection surface here.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({ "@context": "https://schema.org", "@graph": graph }),
      }}
    />
  );
}
