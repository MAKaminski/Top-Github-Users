/**
 * The one place that knows where this site lives.
 *
 * Canonical URLs, `metadataBase`, the sitemap, robots.txt, Open Graph image
 * URLs and every JSON-LD `@id` all derive from here. Scattering the origin
 * across those files is how a deployment ends up advertising a preview URL as
 * canonical and quietly splitting its own search authority.
 *
 * `NEXT_PUBLIC_SITE_URL` overrides it, so pointing a real domain at this
 * deployment is an environment variable rather than a code change. The fallback
 * chain below matters on Vercel: `VERCEL_PROJECT_PRODUCTION_URL` is the stable
 * production hostname, while `VERCEL_URL` is the per-deployment one — using the
 * latter as canonical would make every preview claim to be the real site.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;

  return "https://top-github-users-amber.vercel.app";
}

export const SITE_URL = resolveSiteUrl();
export const SITE_NAME = "Commitgraph";

/** Used as the default `<meta name="description">` and as the Open Graph and
 *  JSON-LD description. One sentence, no marketing adjectives — it is also what
 *  a model summarising the site will most likely quote. */
export const SITE_DESCRIPTION =
  "Worldwide, country and city leaderboards of the most active developers on GitHub, " +
  "ranked by public and private contributions over the trailing twelve months, with " +
  "contribution heatmaps, rank movement and a free REST and MCP API over the same data.";

/** Absolute URL for a site-relative path. Search engines and social scrapers
 *  both need absolute URLs; `metadataBase` covers Next's own fields but not the
 *  JSON-LD we assemble by hand. */
export function absoluteUrl(path = "/"): string {
  return new URL(path, SITE_URL).toString();
}

/**
 * Crawlers we name explicitly in robots.txt.
 *
 * Allowing them is the point rather than an oversight: this is a public dataset
 * whose whole purpose is to be cited, and an assistant that can read the site
 * is a reader like any other. `/llms.txt`, the OpenAPI document and the MCP
 * endpoint exist for the same reason. Naming them also means a future decision
 * to exclude one is a visible edit to a list rather than a silent default.
 */
export const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
  "cohere-ai",
  "Meta-ExternalAgent",
  "DuckAssistBot",
  "MistralAI-User",
  "Amazonbot",
  "YouBot",
] as const;
