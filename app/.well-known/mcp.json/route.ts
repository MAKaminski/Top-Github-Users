import { CAVEATS } from "@/lib/api/caveats";
import { baseUrlFrom, handle, json } from "@/lib/api/http";
import { getManifest } from "@/lib/api/queries";
import { PROMPTS } from "@/lib/mcp/prompts";
import { TOOLS } from "@/lib/mcp/tools";
import { PROTOCOL_VERSION, SUPPORTED_PROTOCOLS } from "@/lib/mcp/protocol";
import { INSTALL_COMMANDS, MARKETPLACE_NAME, PLUGIN_NAME, REPO_SLUG } from "@/lib/site";

/**
 * Discovery document for the MCP server.
 *
 * A client that knows only the domain can find the endpoint, the transport, the
 * tool list and the install path from here without a human pasting a URL.
 *
 * Two rules hold this file together. The origin is derived from the incoming
 * request, so the same code is correct on localhost and on the deployed domain
 * — a hardcoded origin is the usual way this file goes stale. And the tool and
 * prompt lists are read from the server's own registries rather than retyped:
 * this document previously carried a hand-maintained copy that had fallen two
 * tools behind what the server actually served, which is worse than not
 * advertising them at all, because a client trusts what it finds here.
 */

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const manifest = await getManifest();
    const base = baseUrlFrom(request);

    return json({
      name: "commitgraph",
      title: "Commitgraph",
      description:
        "The most active developers on GitHub, ranked worldwide and by country and city, from a " +
        `snapshot generated on ${manifest.generatedAt}.`,
      version: `1.0.0+snapshot.${manifest.generatedAt}`,
      snapshot: manifest.generatedAt,
      servers: [
        {
          name: "commitgraph",
          url: `${base}/api/mcp`,
          transport: "streamable-http",
          method: "POST",
          protocol: "jsonrpc-2.0",
          protocolVersion: PROTOCOL_VERSION,
          authentication: { type: "none" },
        },
      ],
      // Repeated at the top level because most clients read only the first
      // server entry and some read neither — one endpoint, stated twice.
      endpoint: `${base}/api/mcp`,
      transport: "streamable-http",
      protocolVersion: PROTOCOL_VERSION,
      supportedProtocolVersions: SUPPORTED_PROTOCOLS,
      capabilities: { tools: true, resources: true, prompts: true },

      /**
       * How a human adds this server, per client. Written out because the most
       * common reason a working MCP server goes unused is that nobody knows the
       * URL — an endpoint is only half an answer without the gesture that
       * consumes it.
       */
      install: {
        page: `${base}/connect`,
        claudeConnector: {
          // Claude's hosted surfaces take a URL and nothing else: the server is
          // public, so there is no OAuth step and no credential to configure.
          client: "Claude (web, desktop, mobile)",
          via: "Settings → Connectors → Add custom connector",
          url: `${base}/api/mcp`,
          authentication: "none",
        },
        claudeCode: { client: "Claude Code", command: INSTALL_COMMANDS.claudeCode },
        claudeCodePlugin: {
          client: "Claude Code",
          marketplace: REPO_SLUG,
          plugin: `${PLUGIN_NAME}@${MARKETPLACE_NAME}`,
          commands: [INSTALL_COMMANDS.marketplaceAdd, INSTALL_COMMANDS.pluginInstall],
        },
        mcpJson: {
          mcpServers: {
            commitgraph: { type: "http", url: `${base}/api/mcp` },
          },
        },
      },

      tools: TOOLS.map((tool) => ({ name: tool.name, description: tool.description })),
      prompts: PROMPTS.map((prompt) => ({
        name: prompt.name,
        title: prompt.title,
        description: prompt.description,
        arguments: prompt.arguments,
      })),

      links: {
        restIndex: `${base}/api/v1`,
        openapi: `${base}/api/openapi.json`,
        llmsTxt: `${base}/llms.txt`,
        methodology: `${base}/methodology`,
        connect: `${base}/connect`,
        repository: `https://github.com/${REPO_SLUG}`,
        website: base,
      },
      caveats: CAVEATS,
    });
  });
}
