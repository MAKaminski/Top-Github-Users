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
 * Two independent pieces, because they became available at different times.
 *
 * `url` is the public listing and is all the footer needs to render a link.
 *
 * `postId` is the numeric id Product Hunt's badge endpoint takes — not the
 * slug, and not discoverable from the public page; it appears only in the embed
 * snippet on the launch dashboard, as `featured.svg?post_id=<id>`. While it is
 * null the footer renders a plain link instead of the badge, which is the right
 * failure: `post_id=undefined` returns Product Hunt's error art, and that would
 * sit in the footer of all 2,745 pages.
 */
export const PRODUCT_HUNT: {
  url: string;
  productId: string;
  badge: {
    href: string;
    theme: "light" | "dark" | "neutral";
    width: number;
    height: number;
  };
} | null = {
  url: "https://www.producthunt.com/products/commitgraph",
  // This listing is a *product*, not a launch post, so the badge endpoint is
  // `product_review.svg` and the parameter is `product_id` — `post_id` belongs
  // to the `featured.svg` badge and returns nothing here.
  productId: "1284629",
  badge: {
    /**
     * Product Hunt's own generated href, reproduced verbatim — including the
     * `utm_source` that appears twice in their snippet. It is theirs, it is what
     * their attribution reads, and tidying somebody else's tracking parameters
     * is how a launch quietly stops being credited.
     */
    href: "https://www.producthunt.com/products/commitgraph/reviews/new?utm_source=badge-product_review&utm_medium=badge&utm_source=badge-commitgraph",
    /**
     * The snippet from Product Hunt defaults to `light`, which is a white badge
     * intended for a light page. This footer is always near-black — the
     * `data-theme="light"` flip only applies to scroll-inverted sections, never
     * here — so the light badge lands as a white sticker. `dark` is Product
     * Hunt's own treatment for exactly this case. One word to change back.
     */
    theme: "dark",
    width: 250,
    height: 54,
  },
};

/** Named once so the /connect page, the discovery document and the README
 *  cannot drift from each other. */
export const INSTALL_COMMANDS = {
  claudeCode: `claude mcp add --transport http commitgraph ${MCP_URL}`,
  marketplaceAdd: `/plugin marketplace add ${REPO_SLUG}`,
  pluginInstall: `/plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}`,
} as const;
