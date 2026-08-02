/**
 * Product Hunt launch media.
 *
 *   node tests/launch-media.mjs            # against http://localhost:3000
 *   BASE=https://... node tests/launch-media.mjs
 *
 * Captures the gallery at 2x device scale and downsamples nothing: Product Hunt
 * asks for 1270x760 or higher, and a 2540x1520 capture is what makes text look
 * sharp on the retina screens most of the audience is browsing on.
 *
 * Everything here is a photograph of the real running site. Nothing is mocked
 * or mocked-up — a gallery shot that shows a state the product cannot reach is
 * the fastest way to lose the room.
 */

import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? path.join(process.cwd(), "launch-media");

/** 1270x760 is the floor; this is that ratio at 2x. */
const GALLERY = { width: 1270, height: 760 };

const SHOTS = [
  {
    name: "01-hero",
    path: "/",
    caption: "Home — the claim, and the shape of the data behind it",
  },
  {
    name: "02-leaderboard",
    path: "/leaderboard",
    caption: "The worldwide leaderboard, sortable and full-depth",
  },
  {
    name: "03-profile",
    path: null, // resolved from the live board below
    caption: "A profile: 371-day heatmap, streak ring, language split",
  },
  {
    name: "04-countries",
    path: "/countries",
    caption: "Every tracked country, as a tile-grid map",
  },
  {
    name: "05-podium",
    path: "/podium",
    caption: "The top ten, one panel at a time",
  },
  {
    name: "06-methodology",
    path: "/methodology",
    caption: "The page no other ranking site has: where the numbers are wrong",
  },
];

/**
 * Motion is the enemy of a screenshot, and the first attempt at solving it was
 * wrong in an instructive way.
 *
 * Overriding `animation-duration` in CSS does nothing here: the reveals are
 * driven by Motion in JavaScript, so the elements simply stayed at the opacity
 * 0 they start from and the captures came out as black rectangles. The site
 * already has a correct answer to this — it honours `prefers-reduced-motion`
 * by rendering final state immediately, which is the behaviour the
 * accessibility sweep tests. So ask for that instead of fighting it.
 */

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts?.ready);

  // The consent banner is real and correct, and it is not what the gallery is
  // selling. Dismissing it is exactly what a visitor does in their first
  // second. Clicking it rather than pre-seeding storage, because the seed has
  // to survive whatever the app does on mount — and a click demonstrably does.
  const decline = page.getByRole("button", { name: /decline/i });
  if (await decline.count()) {
    await decline.click();
    await page.waitForTimeout(200);
  }

  // Anything still parked at opacity 0 has not been revealed, and under
  // reduced motion nothing should be. Nudging the scroll position triggers any
  // intersection observers that are gating on it, then we return to the top so
  // the shot is framed from the start of the page.
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
}

/**
 * Serves avatars from a curl-populated cache instead of letting the browser
 * fetch them.
 *
 * In a sandboxed environment the only route to `avatars.githubusercontent.com`
 * is the agent proxy, and pointing Chromium at it does not work: the proxy
 * accepts HTTPS CONNECT tunnels, and a page opening a dozen of them at once
 * gets `ERR_CONNECTION_RESET` on most of them. The same URLs fetch fine one at
 * a time over curl, which already trusts the proxy CA.
 *
 * So: fetch them serially through curl, then fulfil the browser's requests from
 * disk. The pixels are the real avatars either way — this only changes which
 * process does the download. A miss falls through to `continue()` rather than
 * being faked, so a genuinely missing avatar still looks missing.
 */
async function serveAvatarsFromCache(context) {
  const cache = path.join(OUT, ".avatar-cache");
  await mkdir(cache, { recursive: true });

  let served = 0;
  let missed = 0;

  // Fetched on demand rather than pre-seeded from the board file. Pre-seeding
  // looked tidier and only worked for rank one: the board stores one avatar URL
  // per developer, and the pages request several variants of it — different
  // `?s=` sizes, and a `&u=` cache-buster the search index does not carry — so
  // every other row missed the cache by an exact-match lookup.
  await context.route("**://avatars.githubusercontent.com/**", async (route) => {
    const url = route.request().url();
    const file = path.join(cache, `${createHash("sha1").update(url).digest("hex")}.img`);

    if (!existsSync(file)) {
      // spawnSync blocks this process, which is the point: it serialises the
      // downloads, and it was parallelism the proxy objected to.
      const result = spawnSync("curl", ["-sSf", "--max-time", "20", "-o", file, url]);
      if (result.status !== 0) {
        missed++;
        return route.continue();
      }
    }

    served++;
    await route.fulfill({ status: 200, contentType: "image/png", body: await readFile(file) });
  });

  return () => console.log(`avatars: ${served} served from cache, ${missed} unavailable`);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // Same reason as tests/shots.mjs: the preinstalled browser revision is not
  // the one this @playwright/test version expects, so launch the binary
  // directly rather than making the sandbox download one it cannot fetch.
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
    // swiftshader: the background and charts render through WebGL, and without
    // a software rasteriser they come out blank in a headless container.
    args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
  });

  // Resolve a real profile with a measured calendar, so the heatmap shot shows
  // measured data rather than an estimate.
  const api = await browser.newContext();
  const probe = await api.newPage();
  const board = await probe
    .goto(`${BASE}/api/v1/leaderboard/worldwide?limit=1`)
    .then((response) => response.json())
    .catch(() => null);
  const leader = board?.items?.[0]?.login ?? "felixonmars";
  SHOTS.find((shot) => shot.name === "03-profile").path = `/u/${leader}`;
  await api.close();

  const context = await browser.newContext({
    viewport: GALLERY,
    deviceScaleFactor: 2,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });

  const reportAvatars = await serveAvatarsFromCache(context);

  const written = [];
  const page = await context.newPage();

  for (const shot of SHOTS) {
    const url = `${BASE}${shot.path}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await settle(page);
    const file = path.join(OUT, `${shot.name}.png`);
    await page.screenshot({ path: file });
    written.push({ ...shot, url, file });
    console.log(`✓ ${shot.name}  ${url}`);
  }

  // ---- Thumbnail --------------------------------------------------------
  //
  // 240x240, and it has to read at 40px in a feed. So: the wordmark, and the
  // heatmap motif the whole product is built on. No screenshot survives that
  // reduction, which is why this is drawn rather than cropped.
  const thumb = await context.newPage();
  await thumb.setViewportSize({ width: 240, height: 240 });
  await thumb.setContent(`
    <html><body style="margin:0">
      <div style="width:240px;height:240px;background:#07070a;display:flex;
                  flex-direction:column;align-items:center;justify-content:center;
                  font-family:Inter,system-ui,sans-serif;gap:18px">
        <div style="display:grid;grid-template-columns:repeat(7,14px);gap:4px">
          ${Array.from({ length: 28 }, (_, index) => {
            // A deterministic pseudo-random field, weighted so it reads as a
            // real contribution calendar rather than a checkerboard.
            const level = [0.12, 0.28, 0.55, 0.85, 1][(index * 7 + 3) % 5];
            return `<div style="width:14px;height:14px;border-radius:3px;
                     background:rgba(75,59,255,${level})"></div>`;
          }).join("")}
        </div>
        <div style="color:#f4f2ee;font-size:30px;font-weight:600;letter-spacing:-0.5px">
          Commitgraph
        </div>
      </div>
    </body></html>
  `);
  const thumbFile = path.join(OUT, "00-thumbnail-240.png");
  await thumb.screenshot({ path: thumbFile });
  written.push({ name: "00-thumbnail-240", caption: "Thumbnail (240x240)", file: thumbFile });
  console.log("✓ 00-thumbnail-240");

  reportAvatars();
  await browser.close();

  await writeFile(
    path.join(OUT, "CAPTIONS.md"),
    [
      "# Product Hunt gallery — captions",
      "",
      "Upload in this order. The first gallery image is the social preview.",
      "",
      ...written
        .filter((shot) => shot.name !== "00-thumbnail-240")
        .map((shot) => `- **${shot.name}.png** — ${shot.caption}`),
      "",
      "`00-thumbnail-240.png` is the 240x240 thumbnail, not a gallery image.",
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(`\n${written.length} files in ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
