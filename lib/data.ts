import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  historySeriesSchema,
  leaderboardSchema,
  manifestSchema,
  organizationSchema,
  rankedUserSchema,
  repositorySchema,
} from "./schema";
import type {
  HistorySeries,
  Leaderboard,
  Manifest,
  Organization,
  Place,
  RankedUser,
  Repository,
} from "./types";
import { z } from "zod";

/**
 * Typed, validated loaders over the committed `data/` snapshot.
 *
 * Everything here runs at build time — the site never calls the GitHub API at
 * request time. A malformed crawl commit fails the build through zod rather
 * than rendering nonsense.
 */

const DATA_DIR = path.join(process.cwd(), "data");

const cache = new Map<string, unknown>();

async function load<T>(relativePath: string, schema: z.ZodType<T>): Promise<T | null> {
  const key = relativePath;
  if (cache.has(key)) return cache.get(key) as T;

  let raw: string;
  try {
    raw = await readFile(path.join(DATA_DIR, relativePath), "utf8");
  } catch {
    return null;
  }

  const parsed = schema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `data/${relativePath} does not match its schema:\n${z.prettifyError(parsed.error)}`,
    );
  }

  cache.set(key, parsed.data);
  return parsed.data;
}

export async function getManifest(): Promise<Manifest> {
  const manifest = await load("manifest.json", manifestSchema);
  if (!manifest) {
    throw new Error(
      "data/manifest.json is missing. Run `pnpm seed` to build a bootstrap snapshot, " +
        "or `pnpm crawl` if you have a GitHub token.",
    );
  }
  return manifest;
}

export async function getWorldwide(): Promise<Leaderboard> {
  const board = await load("leaderboard/worldwide.json", leaderboardSchema);
  if (!board) throw new Error("data/leaderboard/worldwide.json is missing. Run `pnpm seed`.");
  return board;
}

export function getCountryBoard(id: string): Promise<Leaderboard | null> {
  return load(`country/${id}.json`, leaderboardSchema);
}

export function getCityBoard(id: string): Promise<Leaderboard | null> {
  return load(`city/${id}.json`, leaderboardSchema);
}

export function getUser(login: string): Promise<RankedUser | null> {
  return load(`user/${shardOf(login)}/${login}.json`, rankedUserSchema);
}

export async function getProfileLogins(): Promise<string[]> {
  return (await load("user/index.json", z.array(z.string()))) ?? [];
}

export async function getOrganizations(): Promise<Organization[]> {
  return (await load("org/top.json", z.array(organizationSchema))) ?? [];
}

export async function getRepositories(): Promise<Repository[]> {
  return (await load("repo/top.json", z.array(repositorySchema))) ?? [];
}

export async function getFlaggedAccounts(): Promise<
  { login: string; avatarUrl: string; total: number; followers: number; countryId: string | null }[]
> {
  return (
    (await load(
      "flagged.json",
      z.array(
        z.object({
          login: z.string(),
          avatarUrl: z.string(),
          total: z.number().int(),
          followers: z.number().int(),
          countryId: z.string().nullable(),
        }),
      ),
    )) ?? []
  );
}

export async function getHistory(scope = "worldwide"): Promise<HistorySeries | null> {
  return load(`history/${scope}.json`, historySeriesSchema);
}

export async function getCountries(): Promise<Place[]> {
  return (await getManifest()).countries;
}

export async function getCities(): Promise<Place[]> {
  return (await getManifest()).cities;
}

export async function getPlace(id: string, kind: "country" | "city"): Promise<Place | null> {
  const manifest = await getManifest();
  const list = kind === "country" ? manifest.countries : manifest.cities;
  return list.find((place) => place.id === id) ?? null;
}

/** Must match scripts/bootstrap-seed.ts and scripts/crawler. */
export function shardOf(login: string): string {
  const key = login.toLowerCase().replace(/[^a-z0-9]/g, "_");
  return key.slice(0, 2).padEnd(2, "_");
}
