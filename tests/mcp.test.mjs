/**
 * MCP + REST contract test.
 *
 * Runs against a live server (`pnpm build && npx next start`) because the thing
 * worth testing is the wire contract, not the dispatch function in isolation —
 * a handler that works in-process but returns the wrong status code or content
 * type is still a broken MCP server.
 *
 *   node --test tests/mcp.test.mjs
 *   BASE_URL=https://example.com node --test tests/mcp.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MCP = `${BASE}/api/mcp`;

let nextId = 1;

async function rpc(method, params) {
  const response = await fetch(MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  return { response, body: response.status === 202 ? null : await response.json() };
}

test("handshake negotiates the protocol and advertises capabilities", async () => {
  const { response, body } = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "contract-test", version: "1" },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type")?.split(";")[0], "application/json");
  assert.equal(response.headers.get("mcp-protocol-version"), "2025-06-18");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");

  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.result.protocolVersion, "2025-06-18");
  assert.ok(body.result.capabilities.tools, "tools capability must be advertised");
  assert.ok(body.result.capabilities.resources, "resources capability must be advertised");
  assert.ok(body.result.instructions.length > 200, "instructions must orient a fresh client");
});

test("an older client is not forced to upgrade", async () => {
  const { body } = await rpc("initialize", { protocolVersion: "2024-11-05" });
  assert.equal(body.result.protocolVersion, "2024-11-05");
});

test("initialized notification returns no body", async () => {
  const { response, body } = await rpc("notifications/initialized", {});
  assert.equal(response.status, 202);
  assert.equal(body, null);
});

test("GET is 405 and points the caller somewhere useful", async () => {
  const response = await fetch(MCP);
  assert.equal(response.status, 405);
  const body = await response.json();
  assert.match(body.error, /Model Context Protocol/);
  assert.equal(body.alternatives.rest, "/api/v1");
});

test("every advertised tool is callable and its schema accepts an empty call", async () => {
  const { body } = await rpc("tools/list");
  const tools = body.result.tools;
  assert.ok(tools.length >= 10, `expected at least 10 tools, got ${tools.length}`);

  // Tools that genuinely require an argument — everything else must work with
  // no arguments at all, or an agent cannot explore the server.
  const required = {
    commitgraph_get_developer: { login: "felixonmars" },
    commitgraph_compare_developers: { logins: ["felixonmars", "steipete"] },
  };

  for (const tool of tools) {
    assert.ok(tool.description.length > 40, `${tool.name} needs a real description`);
    assert.equal(tool.inputSchema.type, "object", `${tool.name} inputSchema must be an object`);

    const { body: call } = await rpc("tools/call", {
      name: tool.name,
      arguments: required[tool.name] ?? {},
    });
    assert.ok(call.result, `${tool.name} returned an RPC error: ${JSON.stringify(call.error)}`);
    assert.notEqual(call.result.isError, true, `${tool.name} reported a tool error`);
    assert.ok(
      call.result.content[0].text.length > 0,
      `${tool.name} returned empty content`,
    );
  }
});

test("tool arguments are validated, not trusted", async () => {
  const { body } = await rpc("tools/call", {
    name: "commitgraph_get_leaderboard",
    arguments: { limit: 9999 },
  });
  assert.ok(body.error, "an out-of-range limit must be rejected");
  assert.equal(body.error.code, -32602);
});

test("an unknown tool names the recovery path", async () => {
  const { body } = await rpc("tools/call", { name: "commitgraph_nope", arguments: {} });
  assert.equal(body.error.code, -32601);
  assert.match(body.error.message, /tools\/list/);
});

test("an unknown scope explains itself rather than returning nothing", async () => {
  const { body } = await rpc("tools/call", {
    name: "commitgraph_get_leaderboard",
    arguments: { scope: "japan" },
  });
  assert.match(body.result.content[0].text, /country:\{id\}/);
});

test("a ranked developer with no stored profile still returns their row", async () => {
  // Search for someone the index knows but who has no profile file.
  const { body: search } = await rpc("tools/call", {
    name: "commitgraph_search_developers",
    arguments: { has_profile: false, limit: 1, response_format: "json" },
  });
  const rows = JSON.parse(search.result.content[0].text).items;
  if (rows.length === 0) return; // every ranked developer has a record; nothing to assert

  const { body } = await rpc("tools/call", {
    name: "commitgraph_get_developer",
    arguments: { login: rows[0].login },
  });
  const text = body.result.content[0].text;
  assert.match(text, /No stored profile record/);
  assert.notEqual(body.result.isError, true, "coverage is not an error");
});

test("every resource lists and reads back", async () => {
  const { body } = await rpc("resources/list");
  const resources = body.result.resources;
  assert.ok(resources.length >= 4);

  for (const resource of resources) {
    const { body: read } = await rpc("resources/read", { uri: resource.uri });
    assert.ok(read.result, `${resource.uri} failed: ${JSON.stringify(read.error)}`);
    const content = read.result.contents[0];
    assert.equal(content.uri, resource.uri);
    assert.ok(content.text.length > 100, `${resource.uri} returned suspiciously little`);
    if (content.mimeType === "application/json") JSON.parse(content.text);
  }
});

test("batched requests are answered in a batch", async () => {
  const response = await fetch(MCP, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 900, method: "ping" },
      { jsonrpc: "2.0", id: 901, method: "tools/list" },
    ]),
  });
  const body = await response.json();
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 2);
});

test("discovery documents agree with what the server actually serves", async () => {
  const wellKnown = await fetch(`${BASE}/.well-known/mcp.json`);
  assert.equal(wellKnown.status, 200);
  const discovery = await wellKnown.json();

  const { body } = await rpc("tools/list");
  const live = body.result.tools.map((t) => t.name).sort();

  // The full set, not a spot check. The discovery document once carried a
  // hand-maintained tool list that had fallen two tools behind the server, and
  // a subset assertion is exactly what let that through.
  assert.deepEqual(
    discovery.tools.map((t) => t.name).sort(),
    live,
    "the discovery document must advertise precisely the tools the server serves",
  );

  const { body: promptList } = await rpc("prompts/list");
  assert.deepEqual(
    discovery.prompts.map((p) => p.name).sort(),
    promptList.result.prompts.map((p) => p.name).sort(),
    "the discovery document must advertise precisely the prompts the server serves",
  );

  // The install block is the point of the document for a human reader: an
  // endpoint nobody can find is the failure this replaced.
  assert.match(discovery.install.claudeCode.command, /^claude mcp add --transport http /);
  assert.ok(discovery.install.claudeConnector.url.endsWith("/api/mcp"));
  assert.equal(discovery.install.claudeConnector.authentication, "none");

  const llms = await fetch(`${BASE}/llms.txt`);
  assert.equal(llms.status, 200);
  assert.match(llms.headers.get("content-type") ?? "", /text\/plain/);
  const llmsBody = await llms.text();
  for (const name of live) {
    assert.ok(llmsBody.includes(name), `${name} must appear in llms.txt`);
  }

  const openapi = await fetch(`${BASE}/api/openapi.json`);
  assert.equal(openapi.status, 200);
  const spec = await openapi.json();
  assert.ok(spec.openapi?.startsWith("3."), "must be an OpenAPI 3.x document");
});

/* --------------------------------------------------------------- prompts */

test("prompts are advertised as a capability, not just answered", async () => {
  const { body } = await rpc("initialize", { protocolVersion: "2025-06-18" });
  assert.ok(
    body.result.capabilities.prompts,
    "a client that does not see the capability never calls prompts/list",
  );
});

test("every prompt lists and builds with its required arguments supplied", async () => {
  const { body } = await rpc("prompts/list");
  const prompts = body.result.prompts;
  assert.ok(prompts.length >= 3, `expected at least 3 prompts, got ${prompts.length}`);

  // Plausible values for anything a prompt marks required. A prompt that adds a
  // new required argument fails here until it is given one, which is the point.
  const sample = {
    place: "Japan",
    criteria: "developers in Japan",
    logins: "felixonmars, steipete",
    login: "felixonmars",
  };

  for (const prompt of prompts) {
    assert.ok(prompt.title, `${prompt.name} needs a title — it is the clickable label`);
    assert.ok(prompt.description.length > 40, `${prompt.name} needs a real description`);

    const args = {};
    for (const argument of prompt.arguments ?? []) {
      assert.ok(argument.description, `${prompt.name}.${argument.name} needs a description`);
      if (!argument.required) continue;
      assert.ok(
        argument.name in sample,
        `${prompt.name} requires "${argument.name}" — add a sample value to this test`,
      );
      args[argument.name] = sample[argument.name];
    }

    const { body: got } = await rpc("prompts/get", { name: prompt.name, arguments: args });
    assert.ok(got.result, `${prompt.name} failed: ${JSON.stringify(got.error)}`);

    const messages = got.result.messages;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, "user", "a prompt must not fabricate an assistant turn");
    assert.ok(messages[0].content.text.length > 100, `${prompt.name} produced a thin message`);
    assert.match(
      messages[0].content.text,
      /commitgraph_/,
      `${prompt.name} must name the tools it expects to be called`,
    );
  }
});

test("a prompt missing a required argument is rejected, not silently rendered", async () => {
  const { body } = await rpc("prompts/get", { name: "commitgraph_place_report", arguments: {} });
  assert.equal(body.error.code, -32602);
  assert.match(body.error.message, /place/);
});

test("an unknown prompt names the recovery path", async () => {
  const { body } = await rpc("prompts/get", { name: "commitgraph_nope", arguments: {} });
  assert.equal(body.error.code, -32002);
  assert.match(body.error.message, /prompts\/list/);
});

test("the install page states the endpoint a client is meant to be given", async () => {
  const response = await fetch(`${BASE}/connect`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /api\/mcp/, "the connect page must print the endpoint");
  assert.match(html, /claude mcp add --transport http/, "…and the Claude Code command");
});

test("every tool carries the annotations the connector directory requires", async () => {
  const { body } = await rpc("tools/list");

  for (const tool of body.result.tools) {
    // "All tools must include a `title` and the applicable `readOnlyHint` or
    // `destructiveHint`." A listing missing these is rejected before a reviewer
    // looks at what the tools actually do.
    assert.ok(tool.title, `${tool.name} needs a title`);
    assert.ok(tool.annotations, `${tool.name} needs annotations`);
    assert.equal(tool.annotations.title, tool.title);
    assert.equal(
      typeof tool.annotations.readOnlyHint,
      "boolean",
      `${tool.name} must declare readOnlyHint`,
    );
    assert.notEqual(
      tool.annotations.readOnlyHint,
      tool.annotations.destructiveHint,
      `${tool.name} cannot be both read-only and destructive`,
    );

    // This server serves a committed snapshot and has no write path, so a
    // destructive tool here means someone added a capability without revisiting
    // the safety story.
    assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} must be read-only`);
    assert.equal(tool.annotations.openWorldHint, false, `${tool.name} reads a closed corpus`);

    assert.ok(tool.name.length <= 64, `${tool.name} exceeds the 64-character limit`);
  }
});
