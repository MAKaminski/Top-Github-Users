/**
 * Connector-packaging consistency tests.
 *
 *   node --test --experimental-strip-types scripts/packaging.test.ts
 *
 * The MCP server is exercised over the wire by tests/mcp.test.mjs, which needs
 * a running site. These are the checks that need neither a server nor a
 * network: that the files a user installs from — the marketplace catalogue, the
 * plugin manifest, the plugin's MCP config, the skill — still agree with each
 * other and with `lib/site.ts`.
 *
 * Worth having because none of it fails loudly. A plugin pointing at a stale
 * hostname installs cleanly and simply never connects, and a marketplace whose
 * `source` path no longer exists only reports itself at somebody else's install
 * time. This is the layer that goes quietly wrong.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_VIDEO, MARKETPLACE_NAME, MCP_URL, PLUGIN_NAME, SITE_URL } from "../lib/site.ts";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const readJson = (path: string) => JSON.parse(read(path));

const PLUGIN_DIR = "plugins/commitgraph";

test("the marketplace lists the plugin at a path that exists", () => {
  const marketplace = readJson(".claude-plugin/marketplace.json");

  assert.equal(marketplace.name, MARKETPLACE_NAME);
  assert.ok(marketplace.owner?.name, "a marketplace needs a named owner");

  const entry = marketplace.plugins.find((p: { name: string }) => p.name === PLUGIN_NAME);
  assert.ok(entry, `${PLUGIN_NAME} must be listed in the marketplace`);
  assert.ok(
    typeof entry.source === "string" && entry.source.startsWith("./"),
    "a relative plugin source must start with ./ — Claude Code rejects a bare path",
  );

  // Resolved from the marketplace root, not from .claude-plugin/.
  const manifest = readJson(`${entry.source.slice(2)}/.claude-plugin/plugin.json`);
  assert.equal(manifest.name, PLUGIN_NAME);
});

test("the plugin manifest and its marketplace entry do not disagree", () => {
  const marketplace = readJson(".claude-plugin/marketplace.json");
  const entry = marketplace.plugins.find((p: { name: string }) => p.name === PLUGIN_NAME);
  const manifest = readJson(`${PLUGIN_DIR}/.claude-plugin/plugin.json`);

  // plugin.json wins at load time when both set a version, so a divergence
  // means the marketplace listing is advertising a version nobody installs.
  assert.equal(entry.version, manifest.version, "marketplace and plugin.json version differ");
  assert.equal(entry.displayName, manifest.displayName);
  assert.ok(manifest.description.length > 40, "the description is the install-time pitch");
});

test("the plugin points at the deployed endpoint, with an override", () => {
  const config = readJson(`${PLUGIN_DIR}/.mcp.json`);
  const server = config.mcpServers.commitgraph;

  assert.equal(server.type, "http");
  assert.match(
    server.url,
    /^\$\{COMMITGRAPH_MCP_URL:-.+\}$/,
    "the URL must carry a ${VAR:-default} so a fork can retarget it without editing the plugin",
  );
  assert.ok(
    server.url.includes(MCP_URL),
    `the default must be ${MCP_URL}, the URL lib/site.ts publishes everywhere else`,
  );
});

test("the repository's own .mcp.json offers the same server to contributors", () => {
  const config = readJson(".mcp.json");
  assert.ok(config.mcpServers.commitgraph, "working on this repo should mean having the server");
  assert.ok(config.mcpServers.commitgraph.url.includes(MCP_URL));
});

test("the bundled skill declares itself and states the caveats it exists to enforce", () => {
  const skill = read(`${PLUGIN_DIR}/skills/commitgraph/SKILL.md`);

  const frontmatter = /^---\n([\s\S]+?)\n---/.exec(skill);
  assert.ok(frontmatter, "a skill without frontmatter is never loaded");
  assert.match(frontmatter[1], /^name: commitgraph$/m);
  assert.match(frontmatter[1], /description:/);

  // The skill's reason for existing is that an answer built on this data is
  // wrong without these. A skill that has lost them is worse than none.
  for (const term of ["estimate", "self-reported", "snapshot"]) {
    assert.match(skill, new RegExp(term, "i"), `the skill must still warn about "${term}"`);
  }
});

test("every published URL points at the production host", () => {
  assert.ok(MCP_URL.startsWith(`${SITE_URL}/`), "MCP_URL must be derived from SITE_URL");
  assert.ok(SITE_URL.startsWith("https://"), "a connector URL must be https");

  // A localhost default anywhere in the install path is the failure this guards:
  // it works for whoever wrote it and for nobody else.
  for (const path of [
    ".mcp.json",
    `${PLUGIN_DIR}/.mcp.json`,
    ".claude-plugin/marketplace.json",
    `${PLUGIN_DIR}/.claude-plugin/plugin.json`,
  ]) {
    assert.doesNotMatch(read(path), /localhost|127\.0\.0\.1/, `${path} must not ship a local URL`);
  }
});

test("the walkthrough video is either absent or a real published URL", () => {
  // Null is the shipped default. The failure this guards is a placeholder —
  // a "coming soon" or an unlisted draft URL committed during editing, which
  // lights up the /connect card, the discovery document and llms.txt at once
  // and sends every reader to a dead page.
  if (DEMO_VIDEO === null) return;

  assert.match(DEMO_VIDEO.url, /^https:\/\//, "the video URL must be https");
  assert.match(
    DEMO_VIDEO.url,
    /^https:\/\/(www\.youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}/,
    "expected a canonical YouTube watch URL with a full 11-character id",
  );
  assert.ok(DEMO_VIDEO.title.length > 8, "the card needs a real title");
  assert.match(DEMO_VIDEO.durationLabel, /^\d+:\d{2}$/, "duration reads as m:ss");
});
