import type { MetadataRoute } from "next";

/**
 * The ~7,000 profile, city and country pages are closed to every crawler.
 * Crawling them was nearly all of this project's Vercel cost (ISR reads and
 * origin transfer, one per page per CDN region), with no visitor behind it.
 * vercel.json denies the same paths at the edge to anything that identifies
 * as a bot, for crawlers that ignore this file. Machines read the data over
 * MCP, the REST mirror and llms.txt instead.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/u/", "/cities/", "/countries/"] }],
  };
}
