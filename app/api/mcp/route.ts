import { CORS_HEADERS, PROTOCOL_VERSION, RpcError, jsonResponse, rpcError } from "@/lib/mcp/protocol";
import { dispatch } from "@/lib/mcp/server";

/**
 * The Commitgraph MCP endpoint.
 *
 * Lives inside the app, so deploying the site deploys the server — there is no
 * second service to keep in sync with the data.
 *
 * Dynamic by necessity: this is a POST endpoint whose response depends on the
 * request body, so it can never be prerendered.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(rpcError(null, RpcError.parse, "Request body is not valid JSON."), 400);
  }

  try {
    const response = await dispatch(body);
    // A notification produces no body. 202 with an empty payload is what the
    // spec expects, and returning `null` here instead would look like a result.
    if (response === null) {
      return new Response(null, {
        status: 202,
        headers: { "mcp-protocol-version": PROTOCOL_VERSION, ...CORS_HEADERS },
      });
    }
    return jsonResponse(response);
  } catch (error) {
    return jsonResponse(rpcError(null, RpcError.internal, (error as Error).message), 500);
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** The transport is POST-only. Answering GET with a 405 and a pointer is more
 *  useful than a 404, because a browser is the most likely thing to arrive here. */
export async function GET(): Promise<Response> {
  return jsonResponse(
    {
      error: "This is a Model Context Protocol endpoint. Send JSON-RPC 2.0 over POST.",
      protocolVersion: PROTOCOL_VERSION,
      connect: "claude mcp add --transport http commitgraph <this-url>",
      alternatives: {
        rest: "/api/v1",
        openapi: "/api/openapi.json",
        discovery: "/.well-known/mcp.json",
      },
    },
    405,
    { allow: "POST, OPTIONS" },
  );
}

export const HEAD = GET;
