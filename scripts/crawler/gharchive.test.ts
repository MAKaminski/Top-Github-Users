import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  collectHour,
  discover,
  filterCandidates,
  hourKey,
  isLikelyBot,
  recentHours,
  urlForHour,
  type ActorActivity,
} from "./gharchive.ts";

/**
 * Discovery is the one half of the pipeline that runs anywhere — GH Archive is
 * public object storage, not the GitHub API — so it is tested against synthetic
 * gzipped hours rather than mocked at the module boundary. The gunzip streaming
 * path is the part most likely to break, and this exercises it for real.
 */

function archiveHour(events: object[]): Response {
  const body = gzipSync(Buffer.from(events.map((e) => JSON.stringify(e)).join("\n") + "\n"));
  return new Response(new Blob([body as unknown as BlobPart]).stream(), { status: 200 });
}

function push(login: string, repoId: number, type = "PushEvent") {
  return {
    type,
    actor: { id: 1, login, avatar_url: `https://avatars.example/${login}.png` },
    repo: { id: repoId, name: `${login}/repo${repoId}` },
  };
}

test("hour keys and URLs follow the archive's naming", () => {
  assert.equal(hourKey(new Date("2026-07-01T15:42:00Z")), "2026-07-01-15");
  assert.equal(hourKey(new Date("2026-07-01T00:05:00Z")), "2026-07-01-0");
  assert.equal(urlForHour("2026-07-01-15"), "https://data.gharchive.org/2026-07-01-15.json.gz");
});

test("the window starts one hour back, because the current hour is still being written", () => {
  const hours = recentHours(3, new Date("2026-07-01T15:30:00Z"));
  assert.deepEqual(hours, ["2026-07-01-14", "2026-07-01-13", "2026-07-01-12"]);
});

test("a gzipped hour streams into actor counts", async () => {
  const actors = new Map<string, ActorActivity>();
  const repos = new Map<string, Set<number>>();

  const result = await collectHour("2026-07-01-15", actors, repos, {
    fetchImpl: async () =>
      archiveHour([push("alice", 1), push("alice", 2), push("bob", 1), push("alice", 1)]),
  });

  assert.equal(result.status, "ok");
  assert.equal(result.events, 4);
  assert.equal(actors.get("alice")?.events, 3);
  assert.equal(actors.get("bob")?.events, 1);
  assert.equal(repos.get("alice")?.size, 2, "distinct repos, not event count");
});

test("stars and forks are not authorship and must not count", async () => {
  const actors = new Map<string, ActorActivity>();
  const result = await collectHour("2026-07-01-15", actors, new Map(), {
    fetchImpl: async () =>
      archiveHour([
        push("watcher", 1, "WatchEvent"),
        push("forker", 1, "ForkEvent"),
        push("author", 1, "PushEvent"),
      ]),
  });

  assert.equal(result.events, 1);
  assert.deepEqual([...actors.keys()], ["author"]);
});

test("a missing hour is skipped, not fatal — the archive has real gaps", async () => {
  // Verified against the live archive: an absent hour is 404 with
  // `application/xml`, not a 200 carrying an error body.
  const result = await collectHour("2011-01-01-0", new Map(), new Map(), {
    fetchImpl: async () =>
      new Response("<?xml version='1.0'?><Error><Code>NoSuchKey</Code></Error>", {
        status: 404,
        headers: { "content-type": "application/xml; charset=UTF-8" },
      }),
  });
  assert.equal(result.status, "missing");
  assert.equal(result.error, undefined, "a known gap is not an error to report");
});

test("an error body served with a 200 is still recognised as missing", async () => {
  // Defensive: a caching layer in front of the bucket could rewrite the status.
  // Feeding XML to gunzip would otherwise surface as an unexplained failure.
  const result = await collectHour("2011-01-01-0", new Map(), new Map(), {
    fetchImpl: async () =>
      new Response("<?xml version='1.0'?><Error><Code>NoSuchKey</Code></Error>", {
        status: 200,
        headers: { "content-type": "application/xml" },
      }),
  });
  assert.equal(result.status, "missing");
});

test("a transport failure is reported without aborting the window", async () => {
  const result = await discover(["2026-07-01-15", "2026-07-01-14"], {
    concurrency: 1,
    fetchImpl: async (input) => {
      if (String(input).includes("-15")) throw new Error("connection reset");
      return archiveHour([push("survivor", 1)]);
    },
  });

  assert.equal(result.hours.find((h) => h.hour === "2026-07-01-15")?.status, "failed");
  assert.equal(result.actors.length, 1, "the other hour still contributed");
  assert.equal(result.actors[0].login, "survivor");
});

test("actors rank by events, then repos, then login — deterministically", async () => {
  const result = await discover(["2026-07-01-15"], {
    fetchImpl: async () =>
      archiveHour([
        push("low", 1),
        push("tieB", 1),
        push("tieB", 2),
        push("tieA", 3),
        push("tieA", 4),
        push("high", 5),
        push("high", 6),
        push("high", 7),
      ]),
  });

  assert.deepEqual(
    result.actors.map((a) => a.login),
    ["high", "tieA", "tieB", "low"],
    "equal event counts break on login so a rerun never reshuffles",
  );
});

test("bots are dropped on GitHub's own naming convention", () => {
  for (const login of ["dependabot[bot]", "renovate[bot]", "github-actions[bot]", "some-bot"]) {
    assert.equal(isLikelyBot(login), true, login);
  }
  for (const login of ["torvalds", "robotics-lab", "bottega"]) {
    assert.equal(isLikelyBot(login), false, login);
  }
});

test("automation under a personal account is caught by events per repository", () => {
  // Taken from a real archive hour: `trieu1082` fired ~3,000 events at a single
  // repository in three hours, which volume alone would rank first.
  const actors: ActorActivity[] = [
    { login: "loop", id: 1, avatarUrl: "", events: 3000, lastSeen: "h", repos: 1 },
    { login: "human", id: 2, avatarUrl: "", events: 300, lastSeen: "h", repos: 40 },
  ];

  const { candidates, droppedLoops } = filterCandidates(actors, { minEvents: 5 });
  assert.equal(droppedLoops, 1);
  assert.deepEqual(candidates.map((c) => c.login), ["human"]);
});

test("someone already on a board survives a quiet week", () => {
  const actors: ActorActivity[] = [
    { login: "busy", id: 1, avatarUrl: "", events: 500, lastSeen: "h", repos: 20 },
    { login: "established", id: 2, avatarUrl: "", events: 1, lastSeen: "h", repos: 1 },
  ];

  const withoutKeep = filterCandidates(actors, { minEvents: 50 });
  assert.deepEqual(withoutKeep.candidates.map((c) => c.login), ["busy"]);

  const withKeep = filterCandidates(actors, {
    minEvents: 50,
    alwaysKeep: new Set(["established"]),
  });
  assert.ok(
    withKeep.candidates.some((c) => c.login === "established"),
    "otherwise the leaderboard churns purely on a slow week",
  );
});

test("a kept login is never dropped as a loop either", () => {
  const actors: ActorActivity[] = [
    { login: "kept", id: 1, avatarUrl: "", events: 5000, lastSeen: "h", repos: 1 },
  ];
  const { candidates } = filterCandidates(actors, {
    minEvents: 1,
    alwaysKeep: new Set(["kept"]),
  });
  assert.equal(candidates.length, 1);
});

test("the limit truncates but still carries kept logins", () => {
  const actors: ActorActivity[] = Array.from({ length: 10 }, (_, i) => ({
    login: `dev${i}`,
    id: i,
    avatarUrl: "",
    events: 100 - i,
    lastSeen: "h",
    repos: 10,
  }));

  const { candidates } = filterCandidates(actors, {
    minEvents: 1,
    limit: 3,
    alwaysKeep: new Set(["dev9"]),
  });

  assert.equal(candidates.length, 4, "three by rank, plus the kept tail login");
  assert.ok(candidates.some((c) => c.login === "dev9"));
});
