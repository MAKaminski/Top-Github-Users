import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * robots.txt.
 *
 * The default posture here is deliberate and worth stating: **assistant
 * crawlers are welcome.** Most sites weigh training-data scraping against
 * traffic they would rather keep. That trade does not apply to this one. The
 * whole project exists to be read by models — it ships an MCP server, a REST
 * mirror and an llms.txt — so blocking GPTBot or ClaudeBot while publishing a
 * connector would be incoherent.
 *
 * The named agents are listed explicitly rather than left to the `*` rule so
 * the intent is legible to a human reading the file, and so a future decision
 * to restrict one of them is a visible edit rather than a silent default.
 *
 * `/api/` is disallowed for crawlers, not because it is private — it is public
 * and CORS-open — but because it is an API rather than content. A search index
 * full of JSON endpoints helps nobody, and the endpoints are already advertised
 * to machines through llms.txt, /.well-known/mcp.json and the Dataset JSON-LD,
 * which are the correct channels for them.
 */
export default function robots(): MetadataRoute.Robots {
  const assistantCrawlers = [
    "ClaudeBot",
    "Claude-Web",
    "anthropic-ai",
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "PerplexityBot",
    "Google-Extended",
    "Applebot-Extended",
    "CCBot",
  ];

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/api/"] },
      { userAgent: assistantCrawlers, allow: "/", disallow: ["/api/"] },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
