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

/** Named once so the /connect page, the discovery document and the README
 *  cannot drift from each other. */
export const INSTALL_COMMANDS = {
  claudeCode: `claude mcp add --transport http commitgraph ${MCP_URL}`,
  marketplaceAdd: `/plugin marketplace add ${REPO_SLUG}`,
  pluginInstall: `/plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}`,
} as const;
