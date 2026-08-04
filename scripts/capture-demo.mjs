/**
 * Demo-video asset capture.
 *
 *   pnpm build && npx next start &
 *   node scripts/capture-demo.mjs [baseUrl] [outDir]
 *
 * Produces the footage an editor can cut a walkthrough from:
 *
 *   video/*.webm    a scripted 1080p pass over /connect
 *   stills/*.png    key frames from that pass, for stills and thumbnails
 *   terminal/*.png  terminal cards
 *
 * On the terminal cards. Every card that shows *output* shows output this
 * script actually captured from the running server moments earlier — the tool
 * list is fetched, not typed out here. Cards that show a command the sandbox
 * cannot run (`claude mcp add`, `/plugin install`) render the command alone,
 * with no invented response beneath it. A demo that fakes a terminal response
 * is a demo that teaches the viewer something untrue about what the software
 * does, and this project already refuses to present derived numbers as
 * measured ones; the same rule applies to its marketing.
 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "/tmp/commitgraph-demo";

const VIEWPORT = { width: 1920, height: 1080 };

/* ------------------------------------------------------------ live capture */

async function rpc(method, params) {
  const response = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return response.json();
}

/** Real responses, fetched now, so the cards cannot drift from the server. */
async function captureLiveOutput() {
  const [handshake, tools] = await Promise.all([rpc("initialize", {}), rpc("tools/list")]);

  const info = handshake.result.serverInfo;
  const caps = Object.keys(handshake.result.capabilities).join(", ");

  const leaderboard = await rpc("tools/call", {
    name: "commitgraph_get_leaderboard",
    arguments: { scope: "country:japan", limit: 5 },
  });

  return {
    handshake: [
      `protocolVersion  ${handshake.result.protocolVersion}`,
      `serverInfo       ${info.title} (${info.name} ${info.version})`,
      `capabilities     ${caps}`,
    ].join("\n"),
    tools: tools.result.tools
      .map((t) => `  ${t.name.padEnd(36)} ${t.annotations.readOnlyHint ? "read-only" : "write"}`)
      .join("\n"),
    toolCount: tools.result.tools.length,
    leaderboard: leaderboard.result.content[0].text.split("\n").slice(0, 12).join("\n"),
  };
}

/* ---------------------------------------------------------- terminal cards */

/** Rendered rather than screenshotted from a real terminal because this sandbox
 *  has no TTY to film. The content is real; only the chrome is drawn. */
function terminalCard({ title, lines }) {
  const body = lines
    .map((line) => {
      if (line.type === "cmd") {
        return `<div class="row"><span class="prompt">$</span><span class="cmd">${escapeHtml(line.text)}</span></div>`;
      }
      if (line.type === "gap") return `<div class="gap"></div>`;
      return `<div class="row out">${escapeHtml(line.text)}</div>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body {
    width: ${VIEWPORT.width}px; height: ${VIEWPORT.height}px;
    display: grid; place-items: center;
    background: #07070a;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
  }
  .window {
    width: 1500px; border: 1px solid #2a2a33; border-radius: 10px;
    background: #0d0d12; overflow: hidden;
    box-shadow: 0 40px 120px rgba(0,0,0,.6);
  }
  .bar {
    display: flex; align-items: center; gap: 9px;
    padding: 14px 18px; background: #14141b; border-bottom: 1px solid #2a2a33;
  }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .bar .title {
    margin-left: 14px; color: #6f6f7d; font-size: 15px; letter-spacing: .02em;
  }
  .body { padding: 34px 40px; font-size: 26px; line-height: 1.65; }
  .row { white-space: pre-wrap; word-break: break-word; }
  .gap { height: 22px; }
  .prompt { color: #ff5c38; margin-right: 14px; }
  .cmd { color: #f4f2ee; }
  .out { color: #8d8d9c; }
</style></head><body>
  <div class="window">
    <div class="bar">
      <span class="dot" style="background:#ff5f57"></span>
      <span class="dot" style="background:#febc2e"></span>
      <span class="dot" style="background:#28c840"></span>
      <span class="title">${escapeHtml(title)}</span>
    </div>
    <div class="body">${body}</div>
  </div>
</body></html>`;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

/* ------------------------------------------------------------------ script */

async function main() {
  await mkdir(join(OUT, "stills"), { recursive: true });
  await mkdir(join(OUT, "terminal"), { recursive: true });
  await mkdir(join(OUT, "video"), { recursive: true });

  console.log(`Capturing live server output from ${BASE} …`);
  const live = await captureLiveOutput();

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  });

  /* --- the /connect walkthrough, recorded --------------------------------- */

  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: join(OUT, "video"), size: VIEWPORT },
  });
  const page = await context.newPage();

  console.log("Recording the /connect walkthrough …");
  await page.goto(`${BASE}/connect`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForTimeout(2500); // let the preloader clear and entrances settle

  const beats = [
    { name: "01-hero", selector: "h1" },
    { name: "02-endpoint", text: "Endpoint" },
    { name: "03-claude-connector", text: "Claude — web, desktop and mobile" },
    { name: "04-claude-code", text: "Claude Code" },
    { name: "05-plugin", text: "As a Claude Code plugin" },
    { name: "06-prompts", text: "What Claude can ask it" },
    { name: "07-tools", text: "tools underneath" },
    { name: "08-limits", text: "What it will not do" },
  ];

  for (const beat of beats) {
    const locator = beat.selector
      ? page.locator(beat.selector).first()
      : page.getByText(beat.text, { exact: false }).first();

    if ((await locator.count()) === 0) {
      console.warn(`  ! no match for ${beat.name} — skipping`);
      continue;
    }

    await locator.scrollIntoViewIfNeeded();
    // Long enough to read on playback, and to give the editor a stable hold.
    await page.waitForTimeout(2200);
    await page.screenshot({ path: join(OUT, "stills", `${beat.name}.png`) });
    console.log(`  ✓ ${beat.name}`);
  }

  await page.waitForTimeout(1200);
  await context.close(); // flushes the video file

  /* --- terminal cards ----------------------------------------------------- */

  console.log("Rendering terminal cards …");
  const cards = [
    {
      file: "01-claude-code-add",
      title: "Terminal — add the connector",
      // Command only: this sandbox has no `claude` CLI, so there is no real
      // response to show and none is invented.
      lines: [
        {
          type: "cmd",
          text: "claude mcp add --transport http commitgraph \\\n    https://top-github-users-amber.vercel.app/api/mcp",
        },
      ],
    },
    {
      file: "02-handshake",
      title: "Terminal — the server answers",
      lines: [
        { type: "cmd", text: "curl -s -X POST $COMMITGRAPH/api/mcp -d '{…\"method\":\"initialize\"}'" },
        { type: "gap" },
        ...live.handshake.split("\n").map((text) => ({ type: "out", text })),
      ],
    },
    {
      file: "03-tools",
      title: `Terminal — ${live.toolCount} tools, all read-only`,
      lines: [
        { type: "cmd", text: "… '{\"method\":\"tools/list\"}' | jq -r '.result.tools[].name'" },
        { type: "gap" },
        ...live.tools.split("\n").map((text) => ({ type: "out", text })),
      ],
    },
    {
      file: "04-real-answer",
      title: "Terminal — a real answer from the snapshot",
      lines: [
        { type: "cmd", text: "… commitgraph_get_leaderboard  scope=country:japan  limit=5" },
        { type: "gap" },
        ...live.leaderboard.split("\n").map((text) => ({ type: "out", text })),
      ],
    },
    {
      file: "05-plugin",
      title: "Claude Code — install the packaged plugin",
      lines: [
        { type: "cmd", text: "/plugin marketplace add MAKaminski/Top-Github-Users" },
        { type: "cmd", text: "/plugin install commitgraph@commitgraph" },
      ],
    },
  ];

  const cardPage = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  for (const card of cards) {
    await cardPage.setContent(terminalCard(card), { waitUntil: "load" });
    await cardPage.screenshot({ path: join(OUT, "terminal", `${card.file}.png`) });
    console.log(`  ✓ ${card.file}`);
  }

  await browser.close();

  await writeFile(
    join(OUT, "CAPTURED.txt"),
    [
      `Captured from ${BASE}`,
      ``,
      `Handshake:`,
      live.handshake,
      ``,
      `Tools (${live.toolCount}):`,
      live.tools,
    ].join("\n"),
    "utf8",
  );

  console.log(`\nAssets in ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
