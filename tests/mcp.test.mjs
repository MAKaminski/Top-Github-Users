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
  const live = new Set(body.result.tools.map((t) => t.name));

  const advertised = JSON.stringify(discovery);
  for (const name of ["commitgraph_describe_dataset", "commitgraph_get_developer"]) {
    assert.ok(live.has(name), `${name} must exist on the server`);
    assert.ok(advertised.includes(name), `${name} must appear in the discovery document`);
  }

  const llms = await fetch(`${BASE}/llms.txt`);
  assert.equal(llms.status, 200);
  assert.match(llms.headers.get("content-type") ?? "", /text\/plain/);

  const openapi = await fetch(`${BASE}/api/openapi.json`);
  assert.equal(openapi.status, 200);
  const spec = await openapi.json();
  assert.ok(spec.openapi?.startsWith("3."), "must be an OpenAPI 3.x document");
});
