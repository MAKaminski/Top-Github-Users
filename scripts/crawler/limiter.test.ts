/**
 * Pacing and budget tests.
 *
 *   node --test --experimental-strip-types scripts/crawler/limiter.test.ts
 *
 * The whole point of the limiter is behaviour that only shows up over a minute
 * of real time, which no test can afford to wait for. So the clock and the
 * sleep are injected and driven by a virtual scheduler: the assertions below
 * are about a full sixty-second window and run in milliseconds. Nothing here
 * touches the network or `data/`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as realSleep } from "node:timers/promises";
import {
  backoffWithJitter,
  classifyFailure,
  CONCURRENCY_CAP,
  pointsForRest,
  RateLimiter,
  SECONDARY_LIMIT_MIN_WAIT_MS,
} from "./limiter.ts";
import { assertWithinBudget, estimateBudget, formatBudget, BatchLog } from "./budget.ts";

/**
 * Virtual clock. `sleep` parks a resolver at a virtual instant instead of a
 * real one; `drain` flushes pending microtasks, then fires the earliest timer,
 * so ordering is deterministic no matter how the waiters interleave.
 */
function virtualClock(start = 0) {
  let now = start;
  const pending: { at: number; resolve: () => void }[] = [];

  return {
    now: () => now,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        pending.push({ at: now + Math.max(0, ms), resolve });
      }),
    async drain(work: Promise<unknown>): Promise<void> {
      let done = false;
      const settled = work.then(
        () => {
          done = true;
        },
        () => {
          done = true;
        },
      );

      for (;;) {
        await new Promise((resolve) => setImmediate(resolve));
        if (done || pending.length === 0) break;
        pending.sort((a, b) => a.at - b.at);
        const next = pending.shift()!;
        now = Math.max(now, next.at);
        next.resolve();
      }

      await settled;
      await work;
    },
  };
}

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

test("concurrency never exceeds the configured cap", async () => {
  const limiter = new RateLimiter({ concurrency: 3 });
  let live = 0;
  let peak = 0;

  await Promise.all(
    Array.from({ length: 20 }, () =>
      limiter.run("rest", 1, async () => {
        live += 1;
        peak = Math.max(peak, live);
        assert.ok(limiter.snapshot().inFlight <= 3);
        await realSleep(1);
        live -= 1;
      }),
    ),
  );

  assert.equal(peak, 3, "should saturate the gate but never pass it");
  assert.equal(limiter.snapshot().inFlight, 0);
});

test("a slot is released when the call throws", async () => {
  const limiter = new RateLimiter({ concurrency: 1 });

  await assert.rejects(
    limiter.run("rest", 1, async () => {
      throw new Error("boom");
    }),
    /boom/,
  );

  // A leaked slot would deadlock this second call rather than fail it.
  const value = await limiter.run("rest", 1, async () => "ok");
  assert.equal(value, "ok");
  assert.equal(limiter.snapshot().inFlight, 0);
});

test("the constructor rejects a concurrency above the hard cap", () => {
  assert.throws(() => new RateLimiter({ concurrency: CONCURRENCY_CAP + 1 }), /hard cap/);
  assert.throws(() => new RateLimiter({ concurrency: 0 }), /at least 1/);
  assert.doesNotThrow(() => new RateLimiter({ concurrency: CONCURRENCY_CAP }));
});

test("the per-minute ceiling delays a burst into the next window", async () => {
  const clock = virtualClock();
  const limiter = new RateLimiter({
    restPointsPerMinute: 3,
    now: clock.now,
    sleep: clock.sleep,
  });

  const startedAt: number[] = [];
  const work = Promise.all(
    Array.from({ length: 5 }, () =>
      limiter.run("rest", 1, async () => {
        startedAt.push(clock.now());
      }),
    ),
  );

  await clock.drain(work);

  // Three points fit the first minute; the rest wait out the sliding window
  // rather than spilling over the ceiling.
  assert.deepEqual(startedAt, [0, 0, 0, 60_000, 60_000]);
});

test("a request larger than the whole budget is admitted rather than deadlocked", async () => {
  const clock = virtualClock();
  const limiter = new RateLimiter({ restPointsPerMinute: 2, now: clock.now, sleep: clock.sleep });

  const work = limiter.run("rest", 50, async () => "through");
  await clock.drain(work);

  assert.equal(await work, "through");
});

test("graphql and rest windows are budgeted separately", async () => {
  const clock = virtualClock();
  const limiter = new RateLimiter({
    graphqlPointsPerMinute: 100,
    restPointsPerMinute: 100,
    now: clock.now,
    sleep: clock.sleep,
  });

  await clock.drain(
    Promise.all([
      limiter.run("rest", 5, async () => undefined),
      limiter.run("graphql", 7, async () => undefined),
    ]),
  );

  const snapshot = limiter.snapshot();
  assert.equal(snapshot.restPointsInWindow, 5);
  assert.equal(snapshot.graphqlPointsInWindow, 7);
});

test("observe pauses every waiting task on a retry-after", async () => {
  const clock = virtualClock(1_000);
  const limiter = new RateLimiter({ now: clock.now, sleep: clock.sleep });

  limiter.observe(headers({ "retry-after": "30", "x-ratelimit-remaining": "10" }));
  assert.equal(limiter.snapshot().pausedUntil, 31_000);

  const startedAt: number[] = [];
  await clock.drain(
    limiter.run("rest", 1, async () => {
      startedAt.push(clock.now());
    }),
  );
  assert.deepEqual(startedAt, [31_000]);
});

test("waitForPrimaryReset sleeps once to the reset and never polls", async () => {
  const clock = virtualClock(10_000);
  const sleeps: number[] = [];
  const limiter = new RateLimiter({
    now: clock.now,
    sleep: (ms) => {
      sleeps.push(ms);
      return clock.sleep(ms);
    },
  });

  limiter.observe(headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "70" }));
  assert.equal(limiter.snapshot().primaryRemaining, 0);

  await clock.drain(limiter.waitForPrimaryReset());
  assert.deepEqual(sleeps, [60_000], "one sleep to the reset, no polling in between");
});

test("classifyFailure maps each documented case", () => {
  const now = () => 1_000_000;

  assert.deepEqual(classifyFailure(403, headers({ "retry-after": "12" }), "", now), {
    kind: "retry-after",
    waitMs: 12_000,
  });
  assert.deepEqual(classifyFailure(429, headers({ "retry-after": "5" }), "", now), {
    kind: "retry-after",
    waitMs: 5_000,
  });

  assert.deepEqual(
    classifyFailure(403, headers({}), "You have exceeded a secondary rate limit", now),
    { kind: "secondary", waitMs: SECONDARY_LIMIT_MIN_WAIT_MS },
  );
  assert.ok(
    classifyFailure(403, headers({}), "triggered an abuse detection mechanism", now).waitMs >=
      60_000,
  );

  assert.deepEqual(
    classifyFailure(
      403,
      headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1200" }),
      "API rate limit exceeded",
      now,
    ),
    { kind: "primary-exhausted", waitMs: 200_000 },
  );

  for (const status of [502, 503, 504]) {
    assert.deepEqual(classifyFailure(status, headers({}), "", now), {
      kind: "retryable",
      waitMs: 0,
    });
  }

  assert.deepEqual(classifyFailure(404, headers({}), "Not Found", now), {
    kind: "fatal",
    waitMs: 0,
  });
  assert.deepEqual(classifyFailure(401, headers({}), "Bad credentials", now), {
    kind: "fatal",
    waitMs: 0,
  });
});

test("backoffWithJitter stays inside the exponential ceiling and the 15-minute cap", () => {
  for (let attempt = 0; attempt < 12; attempt++) {
    const ceiling = Math.min(900_000, 60_000 * 2 ** attempt);
    for (let sample = 0; sample < 50; sample++) {
      const waitMs = backoffWithJitter(attempt);
      assert.ok(waitMs >= 0, `${waitMs} below zero`);
      assert.ok(waitMs <= ceiling, `${waitMs} above ceiling ${ceiling}`);
      assert.ok(waitMs <= 900_000, `${waitMs} above the 15-minute cap`);
    }
  }

  // Full jitter, not equal jitter: the bottom of the range has to be reachable.
  assert.equal(backoffWithJitter(4, 60_000, 900_000, () => 0), 0);
  assert.equal(backoffWithJitter(4, 60_000, 900_000, () => 1), 900_000);
});

test("pointsForRest prices reads at 1 and writes at 5", () => {
  for (const method of ["GET", "head", "Options"]) assert.equal(pointsForRest(method), 1);
  for (const method of ["POST", "PATCH", "put", "DELETE"]) assert.equal(pointsForRest(method), 5);
});

test("assertWithinBudget throws above 24 hours and passes below", () => {
  const overrun = estimateBudget({ usersToHydrate: 5_000_000, batchSize: 25 });
  assert.ok(overrun.estimatedHours > 24);
  assert.throws(() => assertWithinBudget(overrun), (error: Error) => {
    assert.match(error.message, /40 hrs/);
    assert.match(error.message, /ceiling is 24 hrs/);
    assert.match(error.message, /tighten the candidate filter/);
    assert.match(error.message, /Nothing has been collected or written/);
    return true;
  });

  const fine = estimateBudget({ usersToHydrate: 100_000, batchSize: 25 });
  assert.equal(fine.queriesRequired, 4_000);
  assert.equal(fine.estimatedHours, 0.8);
  assert.doesNotThrow(() => assertWithinBudget(fine));
});

test("estimateBudget ceilings the partial batch", () => {
  const estimate = estimateBudget({ usersToHydrate: 101, batchSize: 25, observedCostPerQuery: 2 });
  assert.equal(estimate.queriesRequired, 5);
  assert.equal(estimate.pointsRequired, 10);
  assert.throws(() => estimateBudget({ usersToHydrate: 10, batchSize: 0 }), /at least 1/);
});

test("formatBudget renders the exact block the rules specify", () => {
  const estimate = estimateBudget({ usersToHydrate: 40_000, batchSize: 25 });

  assert.equal(
    formatBudget(estimate),
    [
      "users to hydrate:        40000",
      "batch size:              25",
      "queries required:        1600",
      "observed cost per query: 1   (assumed — not yet measured)",
      "points required:         1600",
      "points available:        5000 / hr",
      "estimated wall clock:    0.32 hrs",
    ].join("\n"),
  );

  assert.equal(
    formatBudget({ ...estimate, observedCostPerQuery: 4, pointsRequired: 6400 }, { measured: true }),
    [
      "users to hydrate:        40000",
      "batch size:              25",
      "queries required:        1600",
      "observed cost per query: 4   (measured, from rateLimit.cost)",
      "points required:         6400",
      "points available:        5000 / hr",
      "estimated wall clock:    0.32 hrs",
    ].join("\n"),
  );
});

test("BatchLog writes one line per batch", () => {
  const lines: string[] = [];
  const log = new BatchLog({ log: (message) => lines.push(message) });

  log.record({ index: 12, cost: 1, remaining: 4831, elapsedMs: 1_240, errors: 0 });
  log.record({ index: 13, cost: 2, remaining: 4829, elapsedMs: 900, errors: 1 });

  assert.deepEqual(lines, [
    "batch 12  cost=1  remaining=4831  1.24s  errors=0",
    "batch 13  cost=2  remaining=4829  0.90s  errors=1",
  ]);
  assert.equal(log.count, 2);
  assert.match(log.summary(), /^2 batches {2}cost=3 {2}remaining=4829 {2}2\.14s {2}errors=1/);
});
