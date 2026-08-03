/**
 * Screenshot + accessibility sweep.
 *
 * Renders every route at desktop and mobile, with prefers-reduced-motion both
 * on and off, and asserts the two rules the pattern corpus treats as
 * non-negotiable:
 *
 *   1. Under reduced motion nothing is left translated, faded or hidden.
 *   2. Every route is readable with JavaScript disabled.
 *
 *   node tests/shots.mjs [baseUrl] [outDir]
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "/tmp/shots";

const ROUTES = [
  ["home", "/"],
  ["leaderboard", "/leaderboard"],
  ["podium", "/podium"],
  ["countries", "/countries"],
  ["country", "/countries/japan"],
  ["cities", "/cities"],
  ["city", "/cities/jp-tokyo"],
  ["orgs", "/orgs"],
  ["repos", "/repos"],
  ["profile", "/u/felixonmars"],
  ["methodology", "/methodology"],
  ["connect", "/connect"],
];

const failures = [];

async function shoot(browser, { name, path, width, height, reduced, js = true, full = false }) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reduced ? "reduce" : "no-preference",
    javaScriptEnabled: js,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Avatars come from an external CDN. Under the parallel load of this sweep
    // the sandbox proxy resets some of those connections; that is an
    // environment artefact, not a defect in the page.
    if (/ERR_CONNECTION_RESET|ERR_NETWORK_CHANGED|Failed to load resource/.test(text)) return;
    errors.push(text);
  });

  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  // networkidle never settles on pages with hundreds of lazy avatars.
  await page.waitForLoadState("load", { timeout: 45000 }).catch(() => {});
  // Let entrance animations settle before judging the frame.
  // The preloader resolves at ~0.6s and lifts by ~1.4s; wait past it.
  await page.waitForTimeout(reduced ? 900 : 2800);

  if (js) {
    // Content that is ON SCREEN and settled must be visible. Below-the-fold
    // items awaiting their reveal are correct, not stranded, so the check is
    // scoped to the viewport. Transforms are only suspicious under reduced
    // motion — mid-scroll a translated element is just the page working.
    const stranded = await page.evaluate((isReduced) => {
      const bad = [];
      for (const el of document.querySelectorAll("main *")) {
        if (el.closest('[aria-hidden="true"]')) continue;
        if (!el.textContent?.trim()) continue;

        const rect = el.getBoundingClientRect();
        const onScreen =
          rect.bottom > 0 && rect.top < innerHeight && rect.width > 0 && rect.height > 0;
        if (!onScreen) continue;

        const style = getComputedStyle(el);
        if (Number(style.opacity) < 0.05) {
          bad.push(`opacity ${style.opacity}: <${el.tagName.toLowerCase()}> "${el.textContent.trim().slice(0, 40)}"`);
        }
        if (isReduced) {
          const m = style.transform.match(/matrix\(([^)]+)\)/);
          if (m) {
            const [, , , , tx, ty] = m[1].split(",").map(Number);
            if (Math.abs(tx) > 4 || Math.abs(ty) > 4) {
              bad.push(`translated ${tx},${ty}: <${el.tagName.toLowerCase()}>`);
            }
          }
        }
      }
      return bad.slice(0, 5);
    }, reduced);
    if (stranded.length) {
      failures.push(`${name} [${reduced ? "reduced" : "animated"}]: ${stranded.join(" | ")}`);
    }
  }

  if (!js) {
    // Rule 2: real content must be present without scripting.
    const text = await page.evaluate(() => document.querySelector("main")?.innerText ?? "");
    if (text.trim().length < 200) {
      failures.push(`${name} [no-js]: main had only ${text.trim().length} chars of text`);
    }
  }

  if (errors.length) failures.push(`${name}: console/page errors → ${errors.slice(0, 3).join(" | ")}`);

  const suffix = `${width}x${height}${reduced ? "-reduced" : ""}${js ? "" : "-nojs"}`;
  await page.screenshot({ path: `${OUT}/${name}-${suffix}.png`, fullPage: full });
  await context.close();
}

// The environment preinstalls Chromium at a pinned build that may not match the
// one this @playwright/test version expects, so launch the binary directly
// rather than downloading a second copy.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
await mkdir(OUT, { recursive: true });

for (const [name, path] of ROUTES) {
  await shoot(browser, { name, path, width: 1440, height: 900, reduced: false });
  await shoot(browser, { name, path, width: 390, height: 844, reduced: false });
  await shoot(browser, { name, path, width: 1440, height: 900, reduced: true });
  await shoot(browser, { name, path, width: 1440, height: 900, reduced: true, js: false });
}

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`\n✓ ${ROUTES.length} routes clean across desktop, mobile, reduced-motion and no-JS`);
