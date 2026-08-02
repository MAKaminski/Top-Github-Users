# Commitgraph — project instructions

Rankings of the most active developers on GitHub. Next.js 16 App Router, Tailwind v4, committed
JSON snapshots, an MCP server and a REST mirror over the same data.

---

# GitHub Data Collection — Standing Instructions

These rules are binding for all design, code and review work in this project. Follow them without
being asked. **If a request conflicts with them, say so before writing code.**

## 0. Hard constraints

**FREE SERVICES ONLY.** Zero spend. No trials that require a card. Specifically forbidden:

- GitHub Enterprise Cloud (the 15,000 req/hr and 10,000 pt/hr tiers are unreachable — do not
  design for them)
- Snowflake Marketplace, ClickHouse Cloud paid tiers, paid proxy pools
- Commercial GitHub data resellers
- Google BigQuery with a billing account attached

**Also forbidden — these violate GitHub's Terms of Service. Do not propose them even if they
would "solve" the rate limit:**

- Creating multiple GitHub accounts to multiply rate-limit buckets
- Rotating tokens across accounts you control to evade limits
- Scraping github.com HTML to bypass the API
- Any form of distributed or proxied request laundering

The rate limit is a real ceiling. Design within it. If a task is impossible inside the free
ceiling, say that explicitly with the math instead of routing around the limit.

## 1. Never hydrate users over REST

REST `GET /users/{login}` costs 1 request per user. GraphQL with aliased `user()` lookups costs
**1 point per 100 users**. Same free token, 100× the throughput.

| Method | Throughput | Time per 1M profiles |
| --- | --- | --- |
| REST `GET /users/{login}` (PAT) | 5,000 users/hr | 200 hrs |
| **GraphQL, 100 aliases/query (PAT)** | **~500,000 users/hr** | **~2 hrs** |

If you find yourself writing a loop that calls a REST endpoint once per entity, stop and convert
it to a batched GraphQL query. This is the single highest-impact decision in the project.

Rules for the batch pattern:

- **Alias names must be generated (`u0`, `u1`, …), never derived from the login.** Logins contain
  hyphens and digits that are invalid GraphQL alias names.
- **Always include `rateLimit { cost limit remaining resetAt nodeCount }` and log the returned
  `cost`.** Do not assume a query costs 1 point — measure it. Connection fields with `first:`/
  `last:` raise the cost. If observed cost climbs above 1, remove fields until it drops.
- **A missing or suspended user returns `null` for that alias plus an entry in `errors[]`, while
  `data` still holds the other 99 results.** Consume partial data. Never treat a non-empty
  `errors[]` as a failed request and retry the whole batch — that wastes budget and can loop
  forever on a deleted account.
- **Start at batch size 100. On query timeout, halve to 50, then 25.**
- Hard limits: `first`/`last` must be 1–100; a single query may not request more than 500,000
  total nodes.

## 2. Free rate-limit budget

| Auth | REST | GraphQL |
| --- | --- | --- |
| Unauthenticated | 60 req/hr | n/a |
| **Personal access token (our baseline)** | **5,000 req/hr** | **5,000 pts/hr** |
| GitHub App installation | 5,000/hr, +50/hr per repo and per user beyond 20, cap 12,500 | same, cap 12,500 |
| `GITHUB_TOKEN` in Actions | 1,000/hr per repo | 1,000 pts/hr per repo |

Secondary limits bite before the primary limit and are the usual cause of a surprise `403`:

- Max **100 concurrent requests** (we use 6 — see §4)
- Max **900 points/min** on REST; **2,000 points/min** on GraphQL
- Max **90 seconds of CPU time per 60 seconds** of wall clock
- Max 80 content-generating (write) requests/min, 500/hr
- REST point values: GET/HEAD/OPTIONS = 1; POST/PATCH/PUT/DELETE = 5
- GraphQL point values: query = 1, mutation = 5

**GitHub App note:** an App gets an independent bucket *per installation*, and creating an App is
free. That is legitimate scaling only when the data genuinely comes from orgs that installed our
App. It does **not** help for crawling arbitrary public users — do not propose it for that.

## 3. Make repeat work free: conditional requests

REST responses that return `304 Not Modified` **do not count against the primary rate limit.**

- Persist the `ETag` (and `Last-Modified`) from every REST response alongside the record.
- Send `If-None-Match: <etag>` on every subsequent fetch of that resource.
- Treat `304` as "unchanged, keep stored copy" and count it as zero budget.
- REST only. GraphQL has no conditional-request equivalent — there, check the stored `updatedAt`
  before queueing a user for refresh.

## 4. Concurrency and backoff

One 5,000/hr token. Concurrency does not raise the ceiling; it only helps reach it smoothly, and
over-concurrency triggers secondary limits.

- **Concurrency: 4–8.** Never higher. Do not "optimize" this upward.
- Check the running budget before each request; pause rather than fire into a 403.
- Respect on every response: `x-ratelimit-remaining`, `x-ratelimit-reset`, `x-ratelimit-used`,
  `retry-after`.
- `403`/`429` **with** `retry-after`: sleep exactly that long, then resume.
- `403` naming a *secondary* rate limit **without** `retry-after`: sleep at least 60s, then
  exponential backoff with full jitter, capped at 15 min.
- Primary limit exhausted (`x-ratelimit-remaining: 0`): sleep until `x-ratelimit-reset`. Do not
  poll during the wait.
- Never retry a unit of work more than 5 times; write it to the dead-letter file and move on.

## 5. Every job must be resumable

A free-tier job that takes hours *will* be interrupted. Non-resumable crawlers are not acceptable.

- Persist after **every batch**, not at the end.
- Store a durable cursor and ETags in the same store as the records.
- Re-running the entrypoint is idempotent: it resumes from the cursor, and unchanged records cost
  0 budget via §3.
- Log per batch: batch index, observed GraphQL `cost`, `remaining`, wall clock, error count.

## 6. Go around the API when the data allows it

Do not spend API budget on data available in bulk for free.

| Free source | What it gives | Caveats |
| --- | --- | --- |
| **GH Archive** (`data.gharchive.org`) | Every public GitHub event since 2011, hourly `.json.gz`, no account | event data only; local bandwidth/CPU |
| BigQuery sandbox | Same corpus, SQL, hourly | **sandbox mode — never attach billing**; 1 TB scanned/month |
| ClickHouse public playground | GitHub events, SQL, no signup | read-only, freshness varies |

**What GH Archive cannot give you:** it is event data, not a user directory. Actor records carry
`login`, `id` and `avatar_url` — no bio, company, **location**, follower count or creation date.
It only contains accounts that did something *public*, so a developer working mostly in private
repositories never appears. Both facts are why this project still hydrates over GraphQL and keeps
a small supplementary search pass.

**BigQuery sandbox discipline**, if it is ever used: query `githubarchive.day.YYYYMMDD` tables,
never `year.*` or unbounded wildcards; `SELECT` only needed columns (`payload` is the largest);
dry-run every query and log the estimated bytes; narrow anything above ~50 GB.

## 7. The intended architecture

Hybrid — free discovery, budgeted hydration:

1. **Discover** the candidate set from GH Archive (free, no API budget).
2. **Filter aggressively before hydration.** Every user dropped here is free budget. Do not
   hydrate the whole set "just in case."
3. **Hydrate** only the filtered set via batched GraphQL (§1), paced to §2 and §4.
4. **Refresh** incrementally using stored `updatedAt` and ETags (§3), never a full re-crawl.

## 8. State the budget before writing collection code

Compute and print, at the top of any run:

```
users to hydrate:        N
batch size:              B
queries required:        ceil(N / B)
observed cost per query: C   (measured, from rateLimit.cost)
points required:         ceil(N / B) * C
points available:        5000 / hr
estimated wall clock:    ... hrs
```

If the estimate exceeds 24 hours, **stop and report it** before writing the crawler. The answer is
almost always to tighten the §7.2 filter, not to run longer.

## 9. Anti-patterns — reject these on sight

- A `for user in users: GET /users/{login}` loop (§1)
- Any code path that ignores `x-ratelimit-*` headers
- `sleep(1)` as a rate-limit strategy instead of header-driven pacing
- Concurrency above 8, or unbounded `Promise.all` over the full work set
- Retrying an entire GraphQL batch because one alias returned `null`
- Assuming a GraphQL query costs 1 point without logging `rateLimit.cost`
- Writing results only at the end of a run
- Unauthenticated requests (60/hr) anywhere in production code
- Any BigQuery query without a dry-run byte estimate
- Any suggestion to add accounts, tokens, proxies or HTML scraping to raise throughput

### Reference

- REST rate limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- GraphQL rate and node limits: https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
- GitHub App rate limits: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/rate-limits-for-github-apps
- GH Archive: https://www.gharchive.org/

Verify endpoint URLs and free-tier quotas at runtime rather than trusting the values above —
provider free tiers change.

---

## Project-specific notes

**The sandbox cannot reach the GitHub API.** `/search/users`, `/users/*` and `/graphql` all return
403 through the session proxy; only repo-scoped REST for this repository works. `data.gharchive.org`
and `raw.githubusercontent.com` **are** reachable. So discovery is runnable and testable locally;
hydration is fixture-tested and first executes in the scheduled Action.

**Honesty rules that outrank convenience.** Contribution totals and follower counts are measured.
A calendar that has not been crawled is a deterministic *estimate* derived from the measured total
and must be labelled as such everywhere it appears. Accounts above 300,000 contributions in twelve
months are excluded as automation and published on `/methodology` rather than dropped silently.
Never present an estimate as a measurement, and never let a leaderboard invent rows it does not
have — an explicit empty state beats placeholder data.

**Determinism is a hard requirement**, because snapshots are committed to git. Stable key ordering
on serialise (`writeJson` in `scripts/lib/io.ts`), ties broken by `login`, and no timestamps inside
per-record files — a single `generatedAt` lives in the manifest.

## Shipping — standing authorization

The user has granted this once, durably. **Do not ask again.**

- **Push without asking.** Work goes to the designated feature branch as soon as it is verified.
  Verified means: `npx tsc --noEmit` clean, `npx eslint .` with no errors, `pnpm build` succeeding,
  the unit suites passing, and — for anything touching the site — `node tests/shots.mjs` still
  clean across all 11 routes. Failing checks are the only thing that holds a push.
- **Open the pull request without asking.** Immediately after the first push of a branch, open a
  **draft** PR if no open one exists. Keep pushing follow-up commits to the same branch and the
  same PR rather than opening a second one.
- **Then subscribe** to the PR's activity and drive it to green: diagnose and fix CI failures,
  address review comments, and reply when something genuinely cannot be fixed. Do not end a
  CI-failure notification without either a pushed fix or a posted explanation.
- **Still ask before:** force-pushing over someone else's commits, changing the repository's
  default branch, merging a PR, deleting anything, or any action that reaches outside this
  repository. Authorization to push and open PRs is not authorization to merge.

`main` is the base branch. If it does not exist, create it from an empty root commit and rebase the
feature branch onto it, so the PR shows a reviewable diff instead of failing with
`422 base: invalid`.

**Commands:** `pnpm seed` (bootstrap snapshot), `pnpm crawl` (real pipeline),
`pnpm build:index` (search index, runs as prebuild), `pnpm build`, `node tests/shots.mjs`
(accessibility sweep), `node --test tests/mcp.test.mjs` (MCP contract).
