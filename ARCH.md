# Architecture

How Commitgraph is put together, and why. The README covers what the project is and how to
run it; this covers the shape of the thing and the decisions that are expensive to reverse.

---

## The one-sentence version

A scheduled crawler writes JSON snapshots into `data/`; those files are committed to git;
a fully static Next.js site and two machine-readable APIs read them at build time. Nothing
in the running application ever talks to GitHub.

```
GH Archive ──► discover ──► candidates.json ──┐
(free, no token)                              │
                                              ▼
                                    hydrate (GraphQL, 10 aliases/query)
                                              │
                                              ▼
                                     data/*.json  ──► git commit
                                              │
                        ┌─────────────────────┼─────────────────────┐
                        ▼                     ▼                     ▼
                   Next.js site          REST /api/v1          MCP /api/mcp
                        └──────────── lib/api/queries.ts ───────────┘
```

The bottom row matters as much as the top: all three read surfaces go through one query
layer, so they cannot drift into disagreeing about the same number.

---

## Why the data is committed to git

This is the decision everything else bends around, so it goes first.

Snapshots are plain JSON files in the repository rather than rows in a database. That buys
three things:

1. **Every ranking is diffable.** `git diff` between two snapshot commits shows exactly who
   moved and by how much. A database would need a bitemporal schema to answer the same
   question.
2. **The site can be fully static.** No runtime database, no connection pool, no
   request-time GitHub call, no runtime token. Deployment is a build.
3. **The whole history is auditable by anyone.** The claim "these numbers are honest" is
   only as good as someone's ability to check it.

The cost is a hard ceiling on corpus size. 250,000 developers is roughly 26 MB of index
plus board files, which git handles; a million would be rewritten on every crawl and would
make the repository unpleasant to clone. **`WORLDWIDE_SIZE` is a data decision, not a
tuning knob** — `/methodology` publishes the depth, so raising it changes a public claim.

---

## Collection

### Discovery is free; hydration is not

The single most important property of the pipeline is that finding candidates costs no API
budget at all. `scripts/crawler/gharchive.ts` streams a rolling window of
[GH Archive](https://www.gharchive.org/) — hourly gzipped JSON-lines of every public GitHub
event since 2011 — and ranks actors by authorship events. A measured run:

```
27,624,392 authorship events · 1,519,861 distinct actors · 3518MB · 188.2s · 0 API points
313,834 candidates at >=5 events (dropped 8880 bots, 19817 single-repo loops)
```

What GH Archive **cannot** give you is a user directory. Actor records carry `login`, `id`
and `avatar_url` — no bio, company, location, follower count or creation date. It also only
contains accounts that did something *public*, so a developer working mostly in private
repositories never appears at all. Both facts are why hydration over GraphQL still exists,
and why a small supplementary search pass exists alongside it.

The filter between the two stages is where the budget is actually won. Every candidate
dropped before hydration is free; §7.2 of CLAUDE.md says to filter aggressively and mean
it.

### The alias ceiling

`scripts/crawler/github.ts` batches user lookups with generated GraphQL aliases (`u0`, `u1`
… — never derived from the login, which may contain characters invalid in an alias). The
standing guidance says 100 aliases per query at one point.

**The points half is right and the batch size half is wrong**, for one specific reason:
`contributionsCollection` makes GitHub aggregate a year of events per alias inside a single
query's execution budget. Points were never the binding constraint; wall clock inside one
query is, and GitHub reports overrunning it as a gateway 502 rather than a structured
error. The measured ceiling is **10** (see the README for the table).

Two consequences worth knowing before changing anything here:

- **The ladder walks 10 → 5 → 3 → 2 → 1 on a timeout.** The floor is 1 because a single
  pathological account can exceed the executor's budget on its own; at size 1 there is
  nothing left to blame but that account, and it gets dead-lettered.
- **Concurrency is 6.** It does not raise the 5,000-point ceiling — it is what lets a run
  reach it. A ten-alias query takes ~3.4s, so a single-threaded pass hydrates ~10,600 users
  an hour against a budget allowing 50,000, spending five sixths of its wall clock waiting
  on a socket. CLAUDE.md §4 caps this at 8; do not raise it further, because secondary
  limits bite long before the primary one.

When several workers fail on the same rung at the same moment, only the first steps the
ladder down. Without that guard a single bad rung takes the batch size straight to the
floor and turns a 25,000-query pass into a 250,000-query one.

### Resumability

A five-hour pass against a six-hour job ceiling will be cut off; that is the normal case,
not the exception. Three mechanisms cover it:

| Mechanism | Scope | Where |
| --- | --- | --- |
| Hydration journal (JSONL, append per batch) | Within one job — survives a crash, not the runner | `HydrationJournal` |
| Restore from the committed board | Across jobs — this is the real resume | `restoreHydrated` |
| Two extra cron slots the same UTC day | Schedule | `.github/workflows/crawl.yml` |

The middle row is the one that is easy to get wrong. `data/discovery/` is gitignored, so
the journal never leaves the runner — an early version of this claimed cross-run resume and
did not have it. Restoring from the board loses `bio` and `publicRepos` for developers
below profile depth, which are precisely the fields only a profile page renders, and they
return on the next uninterrupted pass.

A workflow-level `concurrency: crawl` group with `cancel-in-progress: false` stops two runs
holding two views of the same journal and spending the hour's budget twice. Cancelling
would be worse than queueing here: the 09:17 resume exists to *continue* the 03:17 pass,
not to kill it.

### Failure handling

- A batch no size can serve is **dead-lettered and the run continues**. A run that hydrates
  249,900 of 250,000 and names the 100 it could not reach is a success; one that throws away
  the whole corpus over one request is not.
- Three consecutive fully-unserved batches trip a **circuit breaker**, because at that point
  it is an outage rather than a bad batch, and quietly dead-lettering the remaining quarter
  of a million logins would report success having collected nothing.
- Retries are bounded by **wall clock as well as attempt count**. An earlier version raised
  the gateway attempt limit without touching the backoff ceiling, and a single batch could
  burn fifteen minutes.

---

## Storage layout

| Path | Contents | Written by |
| --- | --- | --- |
| `data/manifest.json` | Snapshot date, source, counts, totals, country/city indexes | `publishHydrated` |
| `data/leaderboard/worldwide.json` (+ `.N.json`) | Global ranking, sharded at 25,000 rows | `writeBoard` |
| `data/country/{id}.json`, `data/city/{id}.json` | Place boards | `publishPlace` |
| `data/user/{shard}/{login}.json` | Full developer records including the calendar | `writeProfiles` |
| `data/history/worldwide.json` | Compacted rank history — the bump chart's input | `updateHistory` |
| `data/flagged.json` | Accounts excluded as automation | `publishHydrated` |
| `data/index/search.json`, `order.json` | Search index and three orderings | `scripts/build-index.ts` (prebuild) |
| `data/discovery/` | Candidates and journal — **gitignored**, regenerated in minutes | `discover`, `hydrate` |

### Determinism is a hard requirement

Because snapshots are committed, a rerun that produces different bytes for the same input
turns every diff into noise. So: stable key ordering on serialise (`writeJson` in
`scripts/lib/io.ts`), ties broken by `login`, and **no timestamps inside per-record files** —
a single `generatedAt` lives in the manifest. There is a test that runs the pipeline twice
and asserts byte-identical output.

### The search index is a compaction problem

Search has to see every ranked developer, but they live across 88 country files and 119
city files. `scripts/build-index.ts` flattens them into one file, and stores rows as **array
tuples rather than objects**, with the avatar as a numeric account id rather than a stored
URL.

Measured: **377 bytes per row down to 105.** At 250,000 developers that is the difference
between 94 MB and ~26 MB — which is the difference between the index fitting in git and in a
serverless function, and not.

The tuple layout is a footgun by nature, so `verify()` decodes every row back through
`searchRowSchema` at build time. A wrong slot fails the build rather than surfacing as a
follower count in the location column.

---

## The application

### Fully static, and why that constrains profile depth

`lib/data.ts` reads `data/` from disk at build time and validates each file against a zod
schema, so a malformed crawl commit fails the build instead of rendering nonsense. Every
dynamic route has `generateStaticParams`.

This makes `PROFILE_DEPTH` a **build-time** constraint rather than a budget one: it is
literally the number of pages the site builds. 2,529 profiles is a couple of minutes; 50,000
would not finish inside a Vercel build. Everyone below that depth is still ranked, searchable
and linked — out to github.com rather than to a page that was never built.

### One query layer, three surfaces

`lib/api/queries.ts` is the only thing that reads the snapshot for serving. The site, the
REST mirror at `/api/v1` and the MCP server at `/api/mcp` all call it. This is why the
OpenAPI document, the MCP tool schemas and the rendered page cannot disagree about what a
field means.

The MCP server is hand-rolled (`lib/mcp/`) rather than built on `@modelcontextprotocol/sdk`,
for two concrete reasons: the SDK's HTTP transport expects Node `req`/`res` rather than the
Web `Request`/`Response` a route handler receives, and its released versions pin zod 3 while
this project runs zod 4. Zod 4 earns its place here — `z.toJSONSchema()` generates each
tool's advertised `inputSchema` from the very schema that validates the call.

### Rendering

- **React server components by default.** The `"use client"` boundary sits at the individual
  motion pattern, not at the page, so the rankings and charts are server-rendered HTML.
- **Charts are hand-rolled SVG.** `d3-scale`, `d3-shape` and `d3-array` do maths only; the
  markup is ours. That is what makes server rendering — and therefore the no-JS contract —
  achievable at all.
- **The background is `aria-hidden` and fixed**, seeded from the real contribution
  distribution, with a static wash as the reduced-motion and no-WebGL fallback.

### The accessibility contract is enforced, not intended

1. Every route is readable with JavaScript disabled.
2. Nothing is left translated, faded or hidden under `prefers-reduced-motion: reduce`.

`node tests/shots.mjs` drives Playwright over all fifteen routes at desktop and mobile, with
reduced motion on and off and with JavaScript disabled, and fails the run if any element is
left below 5% opacity, if a no-JS page renders under 200 characters in `<main>`, or if any
page logs a console error.

Motion patterns only ever *remove* a transform or *raise* an opacity, so a pattern that never
hydrates leaves content visible rather than hidden. That is the property that makes rule 1
hold by construction rather than by vigilance.

---

## Honesty, as an architectural constraint

This is not a section about tone. It changes the type system.

Every field that can be either fetched or inferred carries a `Provenance` of `measured`,
`estimated` or `unavailable` (`lib/types.ts`). A calendar that has not been crawled is a
*deterministic* estimate derived from the measured total — the same login always produces
the same calendar, and the total always matches exactly — and it is labelled everywhere it
appears, in the DOM and in screen-reader text, never by colour alone.

Two rules follow that are easy to violate by accident:

- **Never present an estimate as a measurement.** The API carries `calendarMeasured` on every
  row for this reason.
- **Never let a leaderboard invent rows it does not have.** An explicit empty state beats
  placeholder data.

The same rule governs machine-readable metadata. The `Dataset` JSON-LD deliberately carries
no `license` field, because the repository does not yet declare one — and it models
contribution counts as `InteractionCounter` rather than `aggregateRating`, which would win a
star snippet in search results by fabricating a rating nobody gave.

Accounts above 300,000 contributions in twelve months are excluded as automation and
**published** on `/methodology` and in `data/flagged.json`, rather than being silently
dropped. That is the part most leaderboards get wrong: they either leave a bot at number one
or remove it without telling anyone.

---

## Things that will bite you

A short list of decisions that look wrong until you know why.

| Looks like | Actually |
| --- | --- |
| `GRAPHQL_BATCH_START = 10` seems needlessly low | It is measured. Raise it and every batch 502s. Re-measure with `--tier=verify`. |
| The sitemap default export awaits a `number` | Next 16 passes it as a promise. Skipping the await is silent — every branch misses and the shards render as valid, empty `urlset`s. |
| `robots.ts` lists sitemap shards individually | `generateSitemaps` emits no `/sitemap.xml` index, so pointing at that path advertises a 404. |
| Profiles are registered before they are written | `assignRanks` mutates `rank.country` on the same objects as place boards are derived. Serialising earlier stores a permanently null country rank. |
| PostHog initialises opted **out** | So no cookie is written before the banner is answered. |
| `tests/launch-media.mjs` fetches avatars over curl | The sandbox proxy resets parallel CONNECT tunnels; serialising through curl is what makes them load. CSS animation overrides also do nothing to Motion's JS-driven reveals — the script asks for `prefers-reduced-motion` instead. |
