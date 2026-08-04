/**
 * Canonical identifiers for the deployed site.
 *
 * Everything that describes the site to a *machine* — /.well-known/mcp.json,
 * /llms.txt, the REST index — derives its origin from the incoming request via
 * `baseUrlFrom`, so those documents stay correct on localhost, on a preview
 * deployment and in production without anything to keep in sync.
 *
 * This module is the other case: copy that a human is meant to paste somewhere
 * else. A connector URL printed on the /connect page has to name the production
 * deployment even when the page is being read on localhost, because pasting
 * `http://localhost:3000/api/mcp` into claude.ai cannot work. Same for the
 * marketplace slug in the install commands.
 */

/** Production origin. The `.vercel.app` alias is the stable one; the
 *  deployment-specific hostnames rotate on every push. */
export const SITE_URL = "https://top-github-users-amber.vercel.app";

/** The Model Context Protocol endpoint. This is the string a user pastes into
 *  claude.ai → Settings → Connectors, and the one `claude mcp add` takes. */
export const MCP_URL = `${SITE_URL}/api/mcp`;

export const REPO_SLUG = "MAKaminski/Top-Github-Users";
export const REPO_URL = `https://github.com/${REPO_SLUG}`;

/** Claude Code plugin coordinates. The marketplace lives at the repository
 *  root, so the marketplace source is the repository slug itself. */
export const MARKETPLACE_NAME = "commitgraph";
export const PLUGIN_NAME = "commitgraph";

/**
 * The published walkthrough video, or null until one exists.
 *
 * Null is the shipped default on purpose. Every surface that mentions the video
 * — the /connect page, the discovery document, llms.txt — is conditional on
 * this being set, so the site never carries a "watch the demo" affordance that
 * goes nowhere. Publish the video, paste the URL here, and all three light up
 * together; there is no second place to remember.
 *
 * `durationLabel` is written by hand rather than fetched: reading it would mean
 * calling the YouTube API at build time for a string that changes once.
 */
export const DEMO_VIDEO: {
  url: string;
  title: string;
  durationLabel: string;
} | null = null;

/**
 * The self-hosted screen capture, shown while `DEMO_VIDEO` is null.
 *
 * This is `scripts/capture-demo.mjs` output: a silent pass over /connect, no
 * narration and no claude.ai footage, because that segment needs a signed-in
 * account. It is honest B-roll, not a tutorial, and the caption on the page
 * says so — a silent clip presented as "the walkthrough" would send people
 * looking for instructions that are not in it.
 *
 * The YouTube cut supersedes it: set DEMO_VIDEO and the page swaps the inline
 * player for the link card automatically.
 */
export const DEMO_CLIP = {
  src: "/demo/connect-walkthrough.webm",
  poster: "/demo/connect-walkthrough-poster.jpg",
  durationSeconds: 30,
} as const;

/**
 * Product Hunt listing, or null before launch.
 *
 * `postId` is the numeric id the official badge endpoint takes — not the slug.
 * Find it in the embed snippet on the launch page: the badge `<img>` src ends
 * in `?post_id=<id>`. Both are needed: the id renders the badge, the slug is
 * the human link.
 *
 * Null until launch for the same reason DEMO_VIDEO is: a badge pointing at a
 * post that does not exist yet renders Product Hunt's own error art in the
 * footer of every page on the site.
 */
export const PRODUCT_HUNT: {
  postId: string;
  slug: string;
} | null = null;

/** Named once so the /connect page, the discovery document and the README
 *  cannot drift from each other. */
export const INSTALL_COMMANDS = {
  claudeCode: `claude mcp add --transport http commitgraph ${MCP_URL}`,
  marketplaceAdd: `/plugin marketplace add ${REPO_SLUG}`,
  pluginInstall: `/plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}`,
} as const;
