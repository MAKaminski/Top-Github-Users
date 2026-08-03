/**
 * Product Hunt demo video.
 *
 *   pnpm build && pnpm start          # one shell
 *   node tests/launch-video.mjs       # another
 *
 * Drives a scripted tour of the running site and records it to
 * `launch-media/commitgraph-demo.webm`, then transcodes to `.mp4` because more
 * upload targets accept it.
 *
 * Unlike the gallery script this deliberately does NOT ask for reduced motion.
 * The motion design is part of what is being shown, and in a recording there is
 * real time for it to play — the black frames that forced reduced motion on the
 * screenshots came from freezing animations, not from running them.
 *
 * Aim is 50-70 seconds. Product Hunt viewers decide in the first five, so the
 * tour opens on the leaderboard rather than on a slow pan of the hero.
 */

import { chromium } from "@playwright/test";
import { mkdir, readFile, rename, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? path.join(process.cwd(), "launch-media");
const FFMPEG = process.env.FFMPEG ?? "/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux";

const SIZE = { width: 1920, height: 1080 };

const wait = (page, ms) => page.waitForTimeout(ms);

/**
 * Scrolls at a readable pace.
 *
 * `window.scrollTo` jumps, and a jump cut in a product video reads as a glitch
 * rather than as a movement. Stepping in small increments on animation frames
 * is what makes the recording look like someone using the site.
 */
async function glideTo(page, target, durationMs = 2400) {
  await page.evaluate(
    ([target, durationMs]) =>
      new Promise((resolve) => {
        // `target` is a selector, resolved to a scroll position. Scrolling to an
        // element rather than a pixel distance is what stops a tour landing on
        // the footer: page heights differ per route, and a fixed distance that
        // frames the heatmap on one page overshoots into whitespace on another.
        const node = typeof target === "string" ? document.querySelector(target) : null;
        const destination = node
          ? window.scrollY + node.getBoundingClientRect().top - 120
          : Number(target);
        const start = window.scrollY;
        const delta = Math.max(0, destination) - start;
        const startedAt = performance.now();

        const step = (now) => {
          const t = Math.min(1, (now - startedAt) / durationMs);
          // easeInOutCubic: no abrupt start or stop.
          const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
          window.scrollTo(0, start + delta * eased);
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    [target, durationMs],
  );
}

/**
 * Loads a route and clears the consent banner.
 *
 * The wait before clicking is load-bearing: the banner mounts in an effect, so
 * a click dispatched the instant `networkidle` fires finds nothing and the
 * banner sits in the recording for the next several seconds.
 */
async function arrive(page, url) {
  await page.goto(url, { waitUntil: "networkidle" });
  await wait(page, 1200);
  const decline = page.getByRole("button", { name: /decline/i });
  if (await decline.count()) {
    await decline.click();
    await wait(page, 300);
  }
}

/** Same curl-backed avatar cache as the gallery script — see the comment there
 *  for why the browser cannot fetch these itself. */
async function serveAvatars(context) {
  const cache = path.join(OUT, ".avatar-cache");
  await mkdir(cache, { recursive: true });

  await context.route("**://avatars.githubusercontent.com/**", async (route) => {
    const url = route.request().url();
    const file = path.join(cache, `${createHash("sha1").update(url).digest("hex")}.img`);
    if (!existsSync(file)) {
      const result = spawnSync("curl", ["-sSf", "--max-time", "20", "-o", file, url]);
      if (result.status !== 0) return route.continue();
    }
    await route.fulfill({ status: 200, contentType: "image/png", body: await readFile(file) });
  });
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
    args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
  });

  const context = await browser.newContext({
    viewport: SIZE,
    colorScheme: "dark",
    recordVideo: { dir: OUT, size: SIZE },
  });

  // Answer the consent banner before any page script runs.
  //
  // Clicking it works but is too late for a recording: the video starts when
  // this context is created, so the banner occupies the opening seconds — the
  // exact seconds that decide whether anyone watches the rest. `addInitScript`
  // runs before the app mounts, so `readConsent` finds a stored answer and the
  // banner never renders.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("commitgraph.analytics-consent", "denied");
    } catch {
      // Ignored: the click fallback in `arrive` covers it.
    }
  });

  await serveAvatars(context);
  const page = await context.newPage();

  // ---- 1. The leaderboard, immediately -----------------------------------
  // The strongest frame goes first. A viewer who bounces at five seconds should
  // still have seen what this product is.
  await arrive(page, `${BASE}/leaderboard`);
  await wait(page, 2200);
  await glideTo(page, "table, [data-leaderboard], main", 2200);
  await wait(page, 2400);

  // ---- 2. Sorting is a URL, and it works ---------------------------------
  await page.getByRole("link", { name: /^followers$/i }).first().click();
  await page.waitForLoadState("networkidle");
  await wait(page, 3000);

  // ---- 3. A profile: the heatmap is the payoff ---------------------------
  await arrive(page, `${BASE}/u/felixonmars`);
  await wait(page, 2600);
  await glideTo(page, "h2", 2600);
  await wait(page, 3200);

  // ---- 4. Geography -------------------------------------------------------
  await arrive(page, `${BASE}/countries`);
  await wait(page, 2000);
  await glideTo(page, "svg", 2600);
  await wait(page, 3000);

  // ---- 5. The differentiator ---------------------------------------------
  await arrive(page, `${BASE}/methodology`);
  await wait(page, 2200);
  await glideTo(page, "h2", 2600);
  await wait(page, 3000);

  // ---- 6. Close on the claim ---------------------------------------------
  await arrive(page, `${BASE}/`);
  await wait(page, 4000);

  // The video is only flushed to disk when the context closes.
  const video = page.video();
  await context.close();
  await browser.close();

  const raw = await video.path();
  const webm = path.join(OUT, "commitgraph-demo.webm");
  await rename(raw, webm);

  // No mp4 here. Playwright ships a deliberately minimal ffmpeg — VP8 and webm
  // only, no libx264 — so transcoding in this environment is not possible.
  // That is fine for the intended destination: YouTube accepts webm directly,
  // and the Product Hunt field wants a link rather than a file.
  const probe = spawnSync(FFMPEG, ["-i", webm], { encoding: "utf8" });
  const duration = /Duration: (\S+),/.exec(probe.stderr ?? "")?.[1] ?? "unknown";

  const files = await readdir(OUT);
  console.log(`\nwebm:     ${webm}`);
  console.log(`duration: ${duration}`);
  console.log(`\n${files.filter((f) => !f.startsWith(".")).join("\n")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
