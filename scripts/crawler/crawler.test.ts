/**
 * Offline crawler test.
 *
 *   node --test --experimental-strip-types scripts/crawler/crawler.test.ts
 *
 * Runs the whole pipeline — decode, transform, rank, publish, compact history —
 * against the recorded fixtures and a throwaway data directory. Nothing here
 * touches the network or the committed snapshot, which is the point: the crawl
 * has to stay changeable by someone without a token.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  historySeriesSchema,
  leaderboardSchema,
  manifestSchema,
  rankedUserSchema,
} from "../../lib/schema.ts";
import { CALENDAR_DAYS } from "../../lib/calendar.ts";
import { COUNTRIES, COUNTRY_BY_SLUG } from "../lib/countries.ts";
import { loadFixtureClient } from "./fixtures.ts";
import { buildUserQuery, contributionWindow, requireToken } from "./github.ts";
import {
  assignRanks,
  AUTOMATION_THRESHOLD,
  languagesFrom,
  toRankedUser,
} from "./transform.ts";
import { appendSnapshot, applyRetention, updateHistory } from "./history.ts";
import { needsToken, parseOptions, run, selectShard } from "./index.ts";
import { emptyState, writeState } from "./state.ts";

const GERMANY = COUNTRY_BY_SLUG.get("germany")!;
const WINDOW = contributionWindow(new Date("2026-07-25T00:00:00Z"));

async function crawlFixtures() {
  const api = await loadFixtureClient();
  const found = await api.searchUsers("location:\"Germany\" type:user");
  const avatars = new Map(found.map((user) => [user.login, user.avatarUrl]));
  const enriched = await api.enrichUsers(
    found.map((user) => user.login),
    WINDOW,
  );
  const users = enriched.users.map((user) =>
    toRankedUser(user, { country: GERMANY, avatarUrl: avatars.get(user.login) }),
  );
  return { found, enriched, users };
}

test("a deleted account is skipped, not fatal", async () => {
  const { found, enriched } = await crawlFixtures();
  assert.equal(found.length, 5);
  assert.deepEqual(enriched.skipped, ["ghost-account"]);
  assert.equal(enriched.users.length, 4);
});

test("transform fills a measured 371-day calendar and a streak", async () => {
  const { users } = await crawlFixtures();
  const octoflow = users.find((user) => user.login === "octoflow")!;

  assert.equal(octoflow.calendar?.length, CALENDAR_DAYS);
  assert.equal(octoflow.calendarSource, "measured");
  assert.equal(
    octoflow.calendar!.reduce((sum, day) => sum + day, 0),
    octoflow.contributions.total,
  );
  assert.ok(octoflow.streak && octoflow.streak.longest > 0);

  // Private contributions are the restricted slice of the calendar total, not
  // an extra amount on top of it.
  assert.equal(octoflow.contributions.private, 1204);
  assert.equal(
    octoflow.contributions.public + octoflow.contributions.private,
    octoflow.contributions.total,
  );
});

test("location parses to the crawled country and its city", async () => {
  const { users } = await crawlFixtures();
  const mira = users.find((user) => user.login === "mira-dev")!;
  assert.equal(mira.countryId, "germany");
  assert.equal(mira.cityId, "de-munchen");
});

test("languages are measured when repository nodes are present, unavailable otherwise", async () => {
  const api = await loadFixtureClient();
  const graph = api.recorded.get("octoflow")!;

  const measured = languagesFrom(graph);
  assert.equal(measured.source, "measured");
  assert.equal(measured.languages[0].name, "Go");
  assert.ok(measured.languages.every((entry) => entry.share > 0 && entry.share <= 1));

  const withoutNodes = { ...graph, repositories: { totalCount: graph.repositories.totalCount } };
  const absent = languagesFrom(withoutNodes);
  assert.equal(absent.source, "unavailable");
  assert.deepEqual(absent.languages, []);
});

test("ranks are 1-based and ties break on login", async () => {
  const { users } = await crawlFixtures();
  const ranked = assignRanks(
    users.filter((user) => !user.flagged),
    "country",
  );

  assert.deepEqual(
    ranked.map((user) => user.rank.country),
    [1, 2, 3],
  );

  // mira-dev and zeta-builds hold identical totals and identical followers, so
  // only the login can decide — and must decide the same way every run.
  const tied = ranked.filter((user) => user.contributions.total === 8400);
  assert.deepEqual(
    tied.map((user) => user.login),
    ["mira-dev", "zeta-builds"],
  );
});

test("automation is flagged, not ranked", async () => {
  const { users } = await crawlFixtures();
  const bot = users.find((user) => user.login === "release-bot-de")!;
  assert.ok(bot.contributions.total > AUTOMATION_THRESHOLD);
  assert.equal(bot.flagged, true);
  assert.equal(users.filter((user) => !user.flagged).length, 3);
});

test("history appends a column, keeps ties ordered and compacts by age", () => {
  const first = appendSnapshot(null, "worldwide", "2026-07-01", [
    { login: "mira-dev", rank: 1, total: 8400 },
    { login: "zeta-builds", rank: 2, total: 8400 },
  ]);
  assert.deepEqual(first.dates, ["2026-07-01"]);

  const second = appendSnapshot(first, "worldwide", "2026-07-02", [
    { login: "octoflow", rank: 1, total: 12480 },
    { login: "mira-dev", rank: 2, total: 8400 },
  ]);
  assert.deepEqual(second.dates, ["2026-07-01", "2026-07-02"]);
  assert.deepEqual(
    second.series.map((row) => row.login),
    ["octoflow", "mira-dev", "zeta-builds"],
  );
  // A login new to the board has leading nulls, never a fabricated past rank.
  assert.deepEqual(second.series[0].ranks, [null, 1]);
  // One that fell off the board has a trailing null, not its stale rank.
  assert.deepEqual(second.series[2].ranks, [2, null]);

  // Re-running the same date replaces its column instead of doubling it.
  const rerun = appendSnapshot(second, "worldwide", "2026-07-02", [
    { login: "octoflow", rank: 1, total: 12481 },
  ]);
  assert.deepEqual(rerun.dates, ["2026-07-01", "2026-07-02"]);
  assert.deepEqual(rerun.series[0].totals, [null, 12481]);
});

test("retention keeps daily for 30 days, then weekly, then monthly", () => {
  const dates: string[] = [];
  const start = Date.UTC(2023, 0, 1);
  const end = Date.UTC(2026, 0, 1);
  for (let time = start; time <= end; time += 86_400_000) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }

  const series = {
    scope: "worldwide",
    dates,
    series: [
      {
        login: "octoflow",
        ranks: dates.map(() => 1),
        totals: dates.map(() => 12480),
      },
    ],
  };

  const kept = applyRetention(series).dates;
  const ageOf = (date: string) => (Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;

  assert.equal(kept[kept.length - 1], dates[dates.length - 1]);
  assert.equal(kept.filter((date) => ageOf(date) <= 30).length, 31);
  // Roughly one a week for the rest of the first year, one a month beyond it.
  assert.ok(kept.length > 90 && kept.length < 130, `kept ${kept.length}`);
  assert.deepEqual(kept, [...kept].sort());
  // Compacting twice changes nothing.
  assert.deepEqual(applyRetention(applyRetention(series)).dates, kept);
});

/**
 * Marks every country but one as crawled today, so a one-place run is aimed at
 * the country the fixture actually describes. This is also the resume path:
 * `isDue` is what stops the second run redoing the work.
 */
async function aimAtGermany(dir: string, date: string): Promise<void> {
  const state = emptyState();
  for (const country of COUNTRIES) {
    if (country.slug === "germany") continue;
    state.places[country.slug] = { lastCrawledAt: date, cursor: 1, done: true };
  }
  await writeState(state, dir);
}

/**
 * The candidate list hydration consumes, as discovery would have written it.
 *
 * Seeded rather than produced by running discovery, because discovery downloads
 * real GH Archive hours and this test has to work offline and deterministically.
 * The logins are the ones the GraphQL fixture has recordings for.
 */
async function seedCandidates(dir: string, date: string, logins: string[]): Promise<void> {
  const { writeJson } = await import("../lib/io.ts");
  await writeJson(path.join(dir, "discovery", "candidates.json"), {
    generatedAt: date,
    window: { hours: 4, from: "2026-08-02-12", to: "2026-08-02-15" },
    minEvents: 5,
    actorsSeen: logins.length,
    hoursScanned: 4,
    hoursUnavailable: [],
    candidates: logins.map((login, index) => ({
      login,
      avatarUrl: `https://avatars.githubusercontent.com/u/${index + 1}?v=4`,
      events: 100 - index,
      repos: 10,
      lastSeen: "2026-08-02-15",
    })),
  });
}

test("two fresh runs produce byte-identical, schema-valid output", async (t) => {
  const date = new Date().toISOString().slice(0, 10);
  const dirs = await Promise.all([
    mkdtemp(path.join(tmpdir(), "crawl-a-")),
    mkdtemp(path.join(tmpdir(), "crawl-b-")),
  ]);
  t.after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

  // `hydrate` is the tier that publishes: every board — worldwide, country,
  // city — is derived from one hydrated set, so this run exercises the whole
  // fan-out rather than a single place.
  const options = parseOptions(["--fixtures", "--tier=hydrate"]);
  const logins = ["octoflow", "mira-dev", "zeta-builds", "release-bot-de"];
  const snapshots: Record<string, string>[] = [];
  for (const dir of dirs) {
    await aimAtGermany(dir, date);
    await seedCandidates(dir, date, logins);
    await run(options, dir);
    snapshots.push(await snapshotOf(dir));
  }

  // Byte-identical across independent runs — otherwise every crawl commits a
  // diff made of nothing but key order and float noise.
  assert.deepEqual(snapshots[1], snapshots[0]);

  const first = snapshots[0];
  const board = leaderboardSchema.parse(JSON.parse(first["country/germany.json"]));
  assert.deepEqual(
    board.entries.map((entry) => entry.rank),
    [1, 2, 3],
  );
  assert.deepEqual(
    board.entries.map((entry) => entry.login),
    ["octoflow", "mira-dev", "zeta-builds"],
  );
  assert.ok(board.entries.every((entry) => entry.previousRank === null));

  const manifest = manifestSchema.parse(JSON.parse(first["manifest.json"]));
  assert.equal(manifest.source, "crawler");
  assert.equal(manifest.counts.users, 3);
  assert.equal(manifest.counts.flagged, 1);
  assert.equal(manifest.countries[0].id, "germany");

  historySeriesSchema.parse(JSON.parse(first["history/country-germany.json"]));
  const profile = rankedUserSchema.parse(JSON.parse(first["user/oc/octoflow.json"]));
  assert.equal(profile.rank.country, 1);

  // The scalars-only pass measured the totals but bought no calendars, so the
  // profile must say so rather than shipping 371 zeros as a measurement.
  assert.equal(profile.calendar, null);
  assert.equal(profile.calendarSource, "estimated");
  assert.ok(profile.contributions.total > 0);

  // The worldwide board is derived from the same hydrated set, not searched
  // for separately — that is the change that lifted it off its 500-row cap.
  const worldwide = leaderboardSchema.parse(JSON.parse(first["leaderboard/worldwide.json"]));
  assert.deepEqual(
    worldwide.entries.map((entry) => entry.login),
    ["octoflow", "mira-dev", "zeta-builds"],
  );

  // Hydration has no per-place staleness gate — it refreshes the whole corpus
  // every run, which is the point of it. So a second run is not expected to be
  // a no-op; it is expected to record movement and change nothing else. Anything
  // beyond `previousRank` differing here would be the incidental churn that
  // makes a committed-JSON dataset unreviewable.
  await run(options, dirs[0]);
  const second = await snapshotOf(dirs[0]);

  const strip = (files: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(files).map(([name, body]) => [
        name,
        body.replace(/"previousRank":(null|\d+)/g, '"previousRank":*'),
      ]),
    );
  assert.deepEqual(strip(second), strip(first));

  const movedBoard = leaderboardSchema.parse(JSON.parse(second["leaderboard/worldwide.json"]));
  assert.deepEqual(
    movedBoard.entries.map((entry) => entry.previousRank),
    [1, 2, 3],
    "the second run sees the first run's ranks as history, and nobody moved",
  );
});

test("history compaction on disk is idempotent", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "crawl-history-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const points = [{ login: "octoflow", rank: 1, total: 12480 }];
  const once = await updateHistory({
    file: "worldwide",
    scope: "worldwide",
    date: "2026-07-25",
    points,
    dataDir: dir,
  });
  const twice = await updateHistory({
    file: "worldwide",
    scope: "worldwide",
    date: "2026-07-25",
    points,
    dataDir: dir,
  });
  assert.deepEqual(twice, once);
  historySeriesSchema.parse(twice);
});

test("shards are contiguous alphabetical slices covering the whole list", () => {
  const items = ["a", "b", "c", "d", "e", "f", "g"];
  const shards = [1, 2, 3].map((index) => selectShard(items, { index, total: 3 }));
  assert.deepEqual(shards.flat(), items);
  assert.deepEqual(shards[0], ["a", "b", "c"]);
});

test("bad flags are rejected loudly", () => {
  assert.throws(() => parseOptions(["--tier=galaxy"]), /--tier/);
  assert.throws(() => parseOptions(["--shard=0/4"]), /--shard/);
  assert.throws(() => parseOptions(["--limit=nope"]), /--limit/);
  assert.throws(() => parseOptions(["--wat"]), /Unknown argument/);
});

test("discovery needs no token, because GH Archive is not the GitHub API", () => {
  // The workflow deliberately does not gate the discover job on the token
  // check — knowing the candidate set is most useful when the secret is
  // missing. This is the code side of that promise, and it was broken: `run`
  // built a GitHubClient for every tier, so a real run died on the missing
  // secret before downloading a single archive hour.
  assert.equal(needsToken("discover"), false);

  // Everything that does reach the API must keep demanding one. An empty
  // environment has to throw rather than fall through to an unauthenticated
  // crawl, which would commit an empty snapshot over good data.
  for (const tier of ["hydrate", "calendars", "supplement", "countries", "cities"] as const) {
    assert.equal(needsToken(tier), true, tier);
  }
  assert.throws(() => requireToken({} as NodeJS.ProcessEnv), /No GitHub token/);
});

test("the scalars-only pass drops the days but keeps the twelve-month total", () => {
  const withDays = buildUserQuery(2);
  const withoutDays = buildUserQuery(2);
  const scalars = buildUserQuery(2, { calendar: false });

  assert.equal(withDays, withoutDays, "the builder is deterministic");
  assert.match(withDays, /contributionDays/, "the default pass fetches the calendar");

  // The 371 nodes per alias are what makes a corpus-wide pass unaffordable.
  assert.doesNotMatch(scalars, /contributionDays/);
  assert.doesNotMatch(scalars, /weeks/);

  // …but totalContributions is one scalar and is the only authoritative
  // twelve-month figure. Dropping it would mean ranking on a number GitHub does
  // not agree with, so it must survive.
  assert.match(scalars, /contributionCalendar \{\s*totalContributions\s*\}/);
  assert.match(scalars, /restrictedContributionsCount/);
  assert.match(scalars, /rateLimit \{ cost limit remaining resetAt nodeCount \}/);
});

test("a user hydrated without days gets no calendar rather than an empty one", () => {
  const scalarOnly = {
    login: "scalars",
    name: "Scalars Only",
    avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    location: "Berlin, Germany",
    company: null,
    bio: null,
    followers: { totalCount: 10 },
    repositories: { totalCount: 3 },
    contributionsCollection: {
      totalCommitContributions: 100,
      totalPullRequestContributions: 10,
      totalIssueContributions: 5,
      totalPullRequestReviewContributions: 2,
      restrictedContributionsCount: 20,
      // No `weeks`: this is what the scalars-only query returns.
      contributionCalendar: { totalContributions: 137 },
    },
  };

  const user = toRankedUser(scalarOnly);

  assert.equal(user.contributions.total, 137, "the measured total still lands");
  assert.equal(user.calendar, null, "371 zeros would be a fabricated year of inactivity");
  assert.equal(user.calendarSource, "estimated");
  assert.equal(user.streak, null, "a streak from an absent calendar would be invented");
  assert.equal(user.countryId, "germany", "location still parses");
});

/** Every file the run wrote, keyed by its path relative to the data directory. */
async function snapshotOf(dir: string): Promise<Record<string, string>> {
  const { readdir } = await import("node:fs/promises");
  const out: Record<string, string> = {};

  async function walk(current: string): Promise<void> {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[path.relative(dir, full)] = await readFile(full, "utf8");
    }
  }

  await walk(dir);
  return out;
}
