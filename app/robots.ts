import type { MetadataRoute } from "next";

import { generateSitemaps } from "@/app/sitemap";
import { AI_CRAWLERS, absoluteUrl } from "@/lib/site";

/**
 * robots.txt.
 *
 * Everything public is crawlable. The two disallowed paths are not secrets —
 * they are surfaces where a crawler would burn its budget for nothing:
 *
 * - `/api/mcp` speaks JSON-RPC over POST and returns 405 to a GET, so a crawler
 *   only ever collects an error page from it. The machine-readable pointer at
 *   `/.well-known/mcp.json` is the discoverable surface, and it stays allowed.
 * - `/search?...` is an unbounded combinatorial space — every query, filter and
 *   offset is a distinct URL with near-identical content. Left open it produces
 *   exactly the duplicate-content sprawl that costs a site its crawl budget.
 *   The bare `/search` page is allowed; the parameterised results are not, and
 *   the leaderboard's own paginated URLs are the canonical way in.
 *
 * AI crawlers are listed by name and allowed. See AI_CRAWLERS for why.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const disallow = ["/api/mcp", "/search?"];

  // `generateSitemaps` emits `/sitemap/0.xml`, `/sitemap/1.xml` … and no
  // `/sitemap.xml` index, so pointing at that path advertises a 404. Listing
  // every shard is valid — robots.txt allows repeated Sitemap lines — and it
  // keeps the count derived from the same function that produces the shards
  // rather than from a number someone has to remember to update.
  const shards = await generateSitemaps();

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      // Same permissions, stated explicitly. A named rule beats an implicit one
      // when an operator checks whether they are welcome here.
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/", disallow })),
    ],
    sitemap: shards.map(({ id }) => absoluteUrl(`/sitemap/${id}.xml`)),
    host: absoluteUrl("/"),
  };
}
