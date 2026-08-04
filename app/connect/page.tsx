import type { Metadata } from "next";
import Link from "next/link";
import { PROMPTS } from "@/lib/mcp/prompts";
import { TOOLS } from "@/lib/mcp/tools";
import { getManifest } from "@/lib/data";
import { exact } from "@/lib/format";
import {
  DEMO_CLIP,
  DEMO_VIDEO,
  INSTALL_COMMANDS,
  MCP_URL,
  REPO_SLUG,
  SITE_URL,
} from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/connect" },
  title: "Connect",
  description:
    "Add Commitgraph to Claude as a connector, or install it as a Claude Code plugin. Public, " +
    "read-only, no authentication.",
};

/**
 * The install page.
 *
 * The MCP server has worked since the day it shipped; what it lacked was an
 * address anybody could find. This page is that address, so the answer to "how
 * do I use this from Claude" is a URL to send someone rather than a paragraph
 * to write out again.
 *
 * The endpoint is printed from `lib/site.ts` rather than derived from the
 * request, because a reader on localhost still needs the production URL — it is
 * the one they will paste into a client that cannot reach their machine.
 */

/** A selectable command block. Deliberately not a copy button: this page has to
 *  stay readable with JavaScript disabled, which the accessibility sweep
 *  checks on every route. */
function Command({ children }: { children: string }) {
  return (
    <pre className="mono overflow-x-auto border border-rule bg-surface p-[var(--space-xs)] text-caption">
      <code>{children}</code>
    </pre>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-[var(--space-xs)]">
      <span className="mono shrink-0 tabular-nums text-muted">{String(n).padStart(2, "0")}</span>
      <span className="text-muted">{children}</span>
    </li>
  );
}

export default async function ConnectPage() {
  const manifest = await getManifest();

  return (
    <>
      <section className="shell py-[var(--space-lg)]">
        <p className="eyebrow mb-[var(--space-xs)]">Model Context Protocol</p>
        <h1 className="max-w-[20ch] text-display leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
          Use this data inside Claude
        </h1>
        <p className="prose mt-[var(--space-md)] text-muted">
          Commitgraph is a connector. Add the endpoint below and Claude can query{" "}
          {exact(manifest.counts.users)} ranked developers across {manifest.counts.countries}{" "}
          countries and {manifest.counts.cities} cities directly — {TOOLS.length} tools,{" "}
          {PROMPTS.length} ready-made prompts, and the same snapshot this site renders.
        </p>
        <p className="prose mt-[var(--space-sm)] text-muted">
          It is public and read-only. There is no account, no API key and no OAuth step, because
          there is nothing here to protect: one committed snapshot, served the same way to
          everybody.
        </p>

        <div className="mt-[var(--space-md)]">
          <p className="mono text-caption uppercase tracking-[var(--tracking-caption)] text-muted">
            Endpoint
          </p>
          <Command>{MCP_URL}</Command>
        </div>

        {/* Two states, never both. Once the narrated cut is published,
            DEMO_VIDEO takes over and the silent local clip stops rendering —
            a page offering two versions of the same walkthrough makes the
            reader choose, and one of the choices is worse.

            A link out rather than an embedded iframe: YouTube would load on
            every view of this page for a video most readers will not open. */}
        {DEMO_VIDEO ? (
          <a
            href={DEMO_VIDEO.url}
            className="group mt-[var(--space-md)] flex max-w-[38rem] items-center gap-[var(--space-sm)] border border-rule p-[var(--space-sm)] transition-colors hover:border-accent"
          >
            <span
              aria-hidden
              className="grid size-12 shrink-0 place-items-center rounded-full border border-rule text-caption transition-colors group-hover:border-accent"
            >
              ▶
            </span>
            <span className="flex flex-col gap-[var(--space-2xs)]">
              <span className="text-body">{DEMO_VIDEO.title}</span>
              <span className="text-caption text-muted">
                Watch on YouTube · {DEMO_VIDEO.durationLabel}
              </span>
            </span>
          </a>
        ) : (
          <figure className="mt-[var(--space-md)] max-w-[52rem]">
            {/*
              No autoplay and no loop. This sits directly under the endpoint a
              reader came here to copy, and a moving picture beside text people
              are trying to read is a cost with no matching benefit. `controls`
              also means it behaves the same with JavaScript off, which every
              route here is required to.
            */}
            <video
              className="w-full border border-rule"
              src={DEMO_CLIP.src}
              poster={DEMO_CLIP.poster}
              controls
              muted
              playsInline
              preload="none"
              width={1280}
              height={720}
            />
            <figcaption className="mt-[var(--space-2xs)] text-caption text-muted">
              A silent {DEMO_CLIP.durationSeconds}-second capture of this page. The narrated
              walkthrough, including the Claude connector screens, is not published yet — the
              numbered steps below are complete on their own.
            </figcaption>
          </figure>
        )}
      </section>

      <div
        className="bleed my-[var(--space-md)] h-px"
        style={{
          background:
            "linear-gradient(to right, transparent, var(--accent), var(--accent-warm), transparent)",
        }}
      />

      <section className="shell py-[var(--space-lg)]">
        <div className="grid gap-[var(--space-lg)] lg:grid-cols-2">
          <div className="prose">
            <h2 className="text-h2">Claude — web, desktop and mobile</h2>
            <p className="mt-[var(--space-2xs)] text-muted">
              A custom connector. Available on Free, Pro, Max, Team and Enterprise; Free accounts
              are limited to one.
            </p>
            <ol className="mt-[var(--space-sm)] flex flex-col gap-[var(--space-2xs)] text-caption">
              <Step n={1}>Open Settings, then Connectors.</Step>
              <Step n={2}>Choose Add custom connector.</Step>
              <Step n={3}>Paste the endpoint above. Leave the advanced OAuth fields empty.</Step>
              <Step n={4}>
                Connect. The {TOOLS.length} tools and {PROMPTS.length} prompts appear under
                Commitgraph in the attachments menu.
              </Step>
            </ol>
          </div>

          <div className="prose">
            <h2 className="text-h2">Claude Code</h2>
            <p className="mt-[var(--space-2xs)] text-muted">One command, no configuration file.</p>
            <Command>{INSTALL_COMMANDS.claudeCode}</Command>
            <p className="mt-[var(--space-2xs)] text-caption text-muted">
              Add <code className="mono">--scope project</code> to commit it to the repository
              you are in, so everyone working there gets the same server.
            </p>
          </div>

          <div className="prose">
            <h2 className="text-h2">As a Claude Code plugin</h2>
            <p className="mt-[var(--space-2xs)] text-muted">
              The packaged version: the connector plus a skill that teaches Claude which tool
              answers what, and the four properties of this data that make an answer wrong if they
              are ignored.
            </p>
            <Command>{`${INSTALL_COMMANDS.marketplaceAdd}\n${INSTALL_COMMANDS.pluginInstall}`}</Command>
          </div>

          <div className="prose">
            <h2 className="text-h2">Any other MCP client</h2>
            <p className="mt-[var(--space-2xs)] text-muted">
              Streamable HTTP, JSON-RPC 2.0 over POST, protocol version 2025-06-18. Older clients
              are answered in their own version rather than being forced to upgrade.
            </p>
            <Command>
              {JSON.stringify(
                { mcpServers: { commitgraph: { type: "http", url: MCP_URL } } },
                null,
                2,
              )}
            </Command>
          </div>
        </div>
      </section>

      <section className="shell py-[var(--space-lg)]">
        <h2 className="text-h2">What Claude can ask it</h2>
        <p className="prose mt-[var(--space-2xs)] text-muted">
          {PROMPTS.length} prompts package the common multi-tool sequences, so the first useful
          answer does not depend on knowing the tool names.
        </p>
        <ul className="mt-[var(--space-md)] grid gap-[var(--space-xs)] md:grid-cols-2">
          {PROMPTS.map((prompt) => (
            <li key={prompt.name} className="border border-rule p-[var(--space-sm)]">
              <p className="text-body">{prompt.title}</p>
              <p className="mono mt-[var(--space-2xs)] text-caption text-muted">{prompt.name}</p>
              <p className="mt-[var(--space-2xs)] text-caption text-muted">{prompt.description}</p>
            </li>
          ))}
        </ul>

        <h3 className="mt-[var(--space-lg)] text-h2">And {TOOLS.length} tools underneath</h3>
        <ul className="mt-[var(--space-sm)] flex flex-col gap-[var(--space-2xs)]">
          {TOOLS.map((tool) => (
            <li
              key={tool.name}
              className="grid gap-[var(--space-2xs)] border-b border-rule py-[var(--space-2xs)] md:grid-cols-[minmax(0,22rem)_1fr] md:gap-[var(--space-sm)]"
            >
              <code className="mono text-caption">{tool.name}</code>
              <span className="text-caption text-muted">{tool.description}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="shell py-[var(--space-lg)]">
        <div className="prose flex flex-col gap-[var(--space-md)]">
          <div>
            <h2 className="text-h2">What it will not do</h2>
            <p className="mt-[var(--space-2xs)] text-muted">
              The server reads one committed snapshot, generated {manifest.generatedAt}. It has no
              write surface, no credential store and no access to the machine calling it — nothing
              leaves your session except the tool arguments themselves. It cannot tell you anything
              about GitHub right now: for live repository state, use GitHub&rsquo;s own API.
            </p>
            <p className="mt-[var(--space-2xs)] text-muted">
              Every tool result carries the snapshot date and says which of its numbers were
              measured and which were derived. That distinction is the point of the whole project
              and it is documented on the{" "}
              <Link href="/methodology" className="underline underline-offset-4">
                methodology page
              </Link>
              .
            </p>
          </div>

          <div>
            <h2 className="text-h2">Without an MCP client</h2>
            <p className="mt-[var(--space-2xs)] text-muted">
              The same snapshot is a REST API at{" "}
              <a href="/api/v1" className="underline underline-offset-4">
                /api/v1
              </a>
              , described by an{" "}
              <a href="/api/openapi.json" className="underline underline-offset-4">
                OpenAPI document
              </a>
              . Machine discovery lives at{" "}
              <a href="/.well-known/mcp.json" className="underline underline-offset-4">
                /.well-known/mcp.json
              </a>{" "}
              and{" "}
              <a href="/llms.txt" className="underline underline-offset-4">
                /llms.txt
              </a>
              . Everything is CORS-open and unauthenticated.
            </p>
          </div>

          <div>
            <h2 className="text-h2">Running it yourself</h2>
            <p className="mt-[var(--space-2xs)] text-muted">
              The server, the crawler and this site are{" "}
              <a
                href={`https://github.com/${REPO_SLUG}`}
                className="underline underline-offset-4"
              >
                one repository
              </a>
              . Point a client at <code className="mono">http://localhost:3000/api/mcp</code> after{" "}
              <code className="mono">pnpm dev</code>, or set{" "}
              <code className="mono">COMMITGRAPH_MCP_URL</code> to aim the plugin at your own
              deployment instead of {SITE_URL.replace("https://", "")}.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
