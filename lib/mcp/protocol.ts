import { z } from "zod";

/**
 * Minimal JSON-RPC 2.0 / MCP transport.
 *
 * Deliberately hand-rolled rather than pulling in @modelcontextprotocol/sdk:
 * the SDK's HTTP transport expects Node `req`/`res` objects, not the Web
 * `Request`/`Response` a Next route handler receives, and its released versions
 * pin zod 3 while this project runs zod 4. What is actually needed is a few
 * hundred lines of dispatch, and zod 4's own `z.toJSONSchema()` generates each
 * tool's `inputSchema` from the very schema that validates the call — one
 * definition, no drift, no dependency.
 *
 * The wire contract mirrors a known-working public MCP server so that
 * `claude mcp add --transport http` connects without special-casing:
 *   - POST only; GET and HEAD are 405; OPTIONS answers the preflight
 *   - responses are application/json (no SSE framing)
 *   - the negotiated protocol version is echoed in a response header
 */

export const PROTOCOL_VERSION = "2025-06-18";
export const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** Standard JSON-RPC codes, plus the MCP convention of -32002 for "not found". */
export const RpcError = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  notFound: -32002,
} as const;

export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers":
    "content-type, accept, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id",
  "access-control-max-age": "86400",
};

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});

export function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}

export function rpcError(id: JsonRpcRequest["id"], code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0" as const,
    id: id ?? null,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/** MCP tool results carry content blocks; a tool that failed sets isError so the
 *  model sees the failure as a result rather than a transport-level crash. */
export function toolText(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

export function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": PROTOCOL_VERSION,
      "cache-control": "no-store",
      ...CORS_HEADERS,
      ...extra,
    },
  });
}
