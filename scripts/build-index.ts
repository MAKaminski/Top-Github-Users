/**
 * Flattens the snapshot into data/index/search.json.
 *
 * The per-place files are the right shape for rendering a page and the wrong
 * shape for searching: answering "which developers work at Arch Linux" would
 * otherwise mean opening 207 files. This walks them once at build time and
 * emits a single flat row per developer, deduplicated, with the best rank we
 * know from each scope.
 *
 *   pnpm build:index      (also runs automatically as `prebuild`)
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, writeJson } from "./lib/io.ts";
import type { SearchRow } from "../lib/api/search-index.ts";
import type { Leaderboard, Manifest } from "../lib/types.ts";

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function listBoards(dir: string): Promise<string[]> {
  try {
    const names = await readdir(path.join(DATA_DIR, dir));
    return names.filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const manifest = await readJson<Manifest>(path.join(DATA_DIR, "manifest.json"));
  if (!manifest) {
    throw new Error("data/manifest.json is missing. Run `pnpm seed` or `pnpm crawl` first.");
  }

  const profileLogins = new Set(
    (await readJson<string[]>(path.join(DATA_DIR, "user", "index.json"))) ?? [],
  );

  const rows = new Map<string, SearchRow>();

  /** Later scopes must not clobber a rank an earlier scope already established. */
  const absorb = (
    board: Leaderboard,
    scope: "worldwide" | "country" | "city",
  ) => {
    for (const entry of board.entries) {
      const existing = rows.get(entry.login);
      const row: SearchRow = existing ?? {
        login: entry.login,
        name: entry.name,
        avatarUrl: entry.avatarUrl,
        company: entry.company,
        location: entry.location,
        followers: entry.followers,
        total: entry.total,
        public: entry.public,
        private: entry.private,
        countryId: entry.countryId,
        cityId: entry.cityId,
        worldwideRank: null,
        countryRank: null,
        cityRank: null,
        hasProfile: profileLogins.has(entry.login),
      };

      if (scope === "worldwide") row.worldwideRank ??= entry.rank;
      if (scope === "country") row.countryRank ??= entry.rank;
      if (scope === "city") row.cityRank ??= entry.rank;

      rows.set(entry.login, row);
    }
  };

  const worldwide = await readJson<Leaderboard>(
    path.join(DATA_DIR, "leaderboard", "worldwide.json"),
  );
  if (worldwide) absorb(worldwide, "worldwide");

  for (const file of await listBoards("country")) {
    const board = await readJson<Leaderboard>(path.join(DATA_DIR, "country", file));
    if (board) absorb(board, "country");
  }

  for (const file of await listBoards("city")) {
    const board = await readJson<Leaderboard>(path.join(DATA_DIR, "city", file));
    if (board) absorb(board, "city");
  }

  // Sorted by login so the committed file diffs cleanly between runs, exactly
  // like every other artefact the pipeline writes.
  const sorted = [...rows.values()].sort((a, b) => a.login.localeCompare(b.login));

  await writeJson(path.join(DATA_DIR, "index", "search.json"), {
    generatedAt: manifest.generatedAt,
    rows: sorted,
  });

  const withProfile = sorted.filter((row) => row.hasProfile).length;
  console.log(
    `Indexed ${sorted.length} developers (${withProfile} with a profile record) ` +
      `from snapshot ${manifest.generatedAt}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
