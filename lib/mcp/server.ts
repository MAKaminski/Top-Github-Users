import { z } from "zod";
import {
  PROTOCOL_VERSION,
  RpcError,
  SUPPORTED_PROTOCOLS,
  jsonRpcRequestSchema,
  rpcError,
  rpcResult,
  toolText,
  type JsonRpcRequest,
} from "./protocol";
import { TOOLS, TOOLS_BY_NAME } from "./tools";
import { RESOURCES, RESOURCES_BY_URI } from "./resources";

const SERVER_INFO = {
  name: "commitgraph-mcp-server",
  title: "Commitgraph",
  version: "1.0.0",
};

const INSTRUCTIONS = `Rankings of the most active developers on GitHub — worldwide, and by country and city — with contribution calendars, streaks and distributions.

Start with commitgraph_describe_dataset: one call returns the snapshot date, every count, the meaning and provenance of every field, and the complete list of valid scope ids. Then use commitgraph_search_developers to find people and commitgraph_get_developer to pull one in full.

Two things to carry into any answer you build from this data. Contribution totals are measured, but where a day-by-day calendar has not been crawled its shape is a deterministic estimate derived from that total — every record reports which. And GitHub location is free text, so country and city are self-reported rather than verified.

This server is public and read-only over one committed snapshot. It has no access to secrets, environment values, filesystems, databases or user data. Read commitgraph://policy for the full statement.`;

/** Tool arguments arrive untyped; zod both validates them and is the source the
 *  advertised inputSchema is generated from, so the two can never disagree. */
function toolDescriptors() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.schema, { io: "input" }),
  }));
}

export async function handleRpc(request: JsonRpcRequest): Promise<unknown | null> {
  const { id, method, params } = request;

  switch (method) {
    case "initialize": {
      const requested =
        (params as { protocolVersion?: string } | undefined)?.protocolVersion ?? PROTOCOL_VERSION;
      return rpcResult(id, {
        // Echo the client's version when we speak it, so an older client is not
        // forced to upgrade just to read a public dataset.
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
        },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }

    // Notifications carry no id and must produce no response body at all.
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, { tools: toolDescriptors() });

    case "tools/call": {
      const call = z
        .object({ name: z.string(), arguments: z.unknown().optional() })
        .safeParse(params);
      if (!call.success) {
        return rpcError(id, RpcError.invalidParams, "tools/call needs a name and arguments.");
      }

      const tool = TOOLS_BY_NAME.get(call.data.name);
      if (!tool) {
        return rpcError(
          id,
          RpcError.methodNotFound,
          `Unknown tool "${call.data.name}". Call tools/list for the available tools.`,
        );
      }

      const args = tool.schema.safeParse(call.data.arguments ?? {});
      if (!args.success) {
        return rpcError(
          id,
          RpcError.invalidParams,
          `Invalid arguments for ${tool.name}. ${z.prettifyError(args.error)}`,
        );
      }

      try {
        const data = await tool.handler(args.data);
        const wantsJson =
          (args.data as { response_format?: string } | undefined)?.response_format === "json";
        const text = wantsJson
          ? JSON.stringify(data, null, 2)
          : tool.render(data as never);
        return rpcResult(id, toolText(text));
      } catch (error) {
        // Surfaced as a tool result rather than a transport error: the model can
        // read it, retry, or explain it, which a -32603 would not allow.
        return rpcResult(
          id,
          toolText(`${tool.name} failed: ${(error as Error).message}`, true),
        );
      }
    }

    case "resources/list":
      return rpcResult(id, {
        resources: RESOURCES.map(({ uri, name, title, description, mimeType }) => ({
          uri,
          name,
          title,
          description,
          mimeType,
        })),
      });

    case "resources/read": {
      const read = z.object({ uri: z.string() }).safeParse(params);
      if (!read.success) return rpcError(id, RpcError.invalidParams, "resources/read needs a uri.");

      const resource = RESOURCES_BY_URI.get(read.data.uri);
      if (!resource) {
        return rpcError(
          id,
          RpcError.notFound,
          `Unknown resource "${read.data.uri}". Call resources/list for the available resources.`,
        );
      }

      try {
        return rpcResult(id, {
          contents: [
            { uri: resource.uri, mimeType: resource.mimeType, text: await resource.read() },
          ],
        });
      } catch (error) {
        return rpcError(id, RpcError.internal, (error as Error).message);
      }
    }

    case "prompts/list":
      return rpcResult(id, { prompts: [] });

    default:
      return rpcError(id, RpcError.methodNotFound, `Unknown method "${method}".`);
  }
}

/** Accepts a single request or a batch, per JSON-RPC 2.0. */
export async function dispatch(body: unknown): Promise<unknown | null> {
  if (Array.isArray(body)) {
    const responses = await Promise.all(
      body.map(async (entry) => {
        const parsed = jsonRpcRequestSchema.safeParse(entry);
        if (!parsed.success) {
          return rpcError(null, RpcError.invalidRequest, "Malformed JSON-RPC request.");
        }
        return handleRpc(parsed.data as JsonRpcRequest);
      }),
    );
    const kept = responses.filter((r) => r !== null);
    return kept.length ? kept : null;
  }

  const parsed = jsonRpcRequestSchema.safeParse(body);
  if (!parsed.success) {
    return rpcError(null, RpcError.invalidRequest, "Malformed JSON-RPC request.");
  }
  return handleRpc(parsed.data as JsonRpcRequest);
}
