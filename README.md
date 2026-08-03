# Commitgraph

Worldwide, country and city leaderboards for the most active developers on GitHub —
with the contribution heatmaps, distributions and rank movement that a table of
follower counts cannot show.

## Why this exists

The existing ranking sites in this space — [committers.top](https://committers.top),
[gitstar-ranking](https://gitstar-ranking.com), gitista, starfolio — all solve the same
problem the same way: a paginated, essentially unstyled HTML table of logins and one
number. They work. They
also throw away every interesting property of the underlying data — the shape of a
year of commits, how a rank moved between snapshots, how contributions distribute
against followers, where the activity actually is on a map.

Commitgraph does two things differently:

1. **It visualises the data.** Every ranking has a chart behind it: a 371-day
   contribution heatmap per profile, a bump chart of rank movement, a tile-grid map
   of per-country counts, follower/contribution scatter, streak rings, language
   splits.
2. **It says what it does not know.** Free-text location parsing, private-contribution
   counts that GitHub exposes only as a total, calendars that are estimated rather
   than fetched, accounts excluded as automation — all of it is labelled in the UI and
   explained on [`/methodology`](app/methodology/page.tsx). Every other site in this
   category presents its ranking as fact.

## Quick start

```bash
pnpm install
pnpm seed      # builds a bootstrap snapshot into data/ (requires network access)
pnpm dev       # http://localhost:3000
```

`pnpm seed` is only needed on a clone with an empty `data/`. A snapshot is committed
to this repository, so `pnpm install && pnpm dev` is usually enough.

Requires Node 22+ and pnpm 10. No GitHub token is needed to run the site — see below.
Copy [`.env.example`](.env.example) to `.env.local` if you want analytics or a custom
canonical domain locally; every variable in it is optional.

Deeper detail on how the pieces fit together lives in [`ARCH.md`](ARCH.md). The Product
Hunt submission kit is in [`docs/LAUNCH.md`](docs/LAUNCH.md).

## Data pipeline

There are two ways `data/` gets written, and the manifest records which one produced
the current snapshot.

**Bootstrap seeder** — `scripts/bootstrap-seed.ts`, run by `pnpm seed`. It maps the
public [gayanvoice/top-github-users](https://github.com/gayanvoice/top-github-users)
dataset into this project's schema so a fresh clone renders real rankings immediately.
It writes `source: "bootstrap"` into the manifest, and the site surfaces that on
`/methodology` with attribution. It fetches 75 users per country, keeps a city only
where at least 8 tracked developers agree on the name, and generates profile pages for
the worldwide top 500 plus each place's leaders. It is a starting point, not the
intended source — the crawler below replaces it.

**Scheduled crawler** — `scripts/crawler/`, run by `pnpm crawl`. The project's intended
long-term source. It replaces the bootstrap snapshot wholesale on its first successful
run, and it works in four stages:

| Tier | Cost | What it does |
| --- | --- | --- |
| `discover` | **free** | Streams a rolling 7-day window of [GH Archive](https://www.gharchive.org/) and ranks every actor by public authorship events. No token, no API budget. Measured here: 4 hours = 63,444 distinct actors in 8.8 seconds. |
| `verify` | 7 points | Preflight. Checks the token, then measures how many aliases GitHub will actually serve — see below. Runs first inside every hydrating job so a bad credential fails in a second rather than after a 3.5 GB download. |
| `hydrate` | ~25,000 GraphQL points | Fetches the filtered head of that list at **10 aliases a query** (the measured ceiling), six requests in flight, then **derives** the worldwide, country and city boards by grouping one hydrated set. |
| `calendars` | the expensive one | Buys the 371-day contribution calendar — 371 nodes per login — only for the depth that has a profile page. Everyone below keeps a labelled estimate. |
| `supplement` | search budget | Follower- and location-ordered search, for developers whose work is almost entirely private and who therefore emit no public events. Contributes *names* for the next hydration; publishes no board. |

The corpus is capped at **250,000 developers**, a storage decision rather than an API
one: snapshots are committed to git so each can be diffed against the day before.

### The alias ceiling, and why it is measured

CLAUDE.md §1 says a batched `user()` query costs one point per hundred logins. The
*points* half is true — a ten-alias query bills 1, same as a one-alias query — but 100
aliases is unreachable for this selection, and the rate limit is not the reason.

`contributionsCollection` makes GitHub aggregate a year of events per alias inside a
single query's execution budget, and that budget is what runs out. The `verify` tier
measures where. On 2026-08-02, against a personal token:

```
  1 alias   cost 1   0.5s   ok
  2         cost 1   0.9s   ok
  3         cost 1   1.3s   ok
  5         cost 1   2.0s   ok
 10         cost 1   3.4s   ok
 25         —        7.0s   "Resource limits for this query exceeded."
```

So 250,000 developers is 25,000 queries and **five hours of rate-limit budget**, not the
half hour a hundred-per-query assumption predicts. That is longer than a GitHub Actions
job may run, which is why hydration is resumable: two extra cron slots the same UTC day
continue an interrupted pass, and a workflow-level `concurrency` group stops two runs
spending the same hour's budget twice.

Resume rebuilds from the **committed board**, not from the run journal — `data/discovery/`
is gitignored, so the journal only ever survives a crash inside one job. Full profiles are
restored where one exists; below profile depth a board row carries everything any board,
the search index or the API serves.

Re-measure with `pnpm crawl --tier=verify` whenever throughput looks wrong. It takes under
a minute, costs about seven points, and prints the schedule that follows from the result.

The crawler needs a `GH_CRAWL_TOKEN` repository secret — a classic PAT with **no
scopes** is enough, since everything it reads is public.

**Where snapshots live** — everything under `data/`, committed as JSON so any ranking
can be diffed against the day before it:

| Path | Contents |
| --- | --- |
| `data/manifest.json` | Snapshot date, source, counts, totals, and the country/city indexes |
| `data/leaderboard/worldwide.json` | The global ranking |
| `data/country/{id}.json` | Per-country leaderboards (88 at present) |
| `data/city/{id}.json` | Per-city leaderboards (119 at present) |
| `data/user/{shard}/{login}.json` | Full per-developer records, including the calendar (2,529 at present) |
| `data/history/worldwide.json` | Compacted rank history — what the bump chart reads |
| `data/org/top.json`, `data/repo/top.json` | Organization and repository boards |
| `data/flagged.json` | Accounts excluded as automation, published rather than hidden |

**The site is fully static.** `lib/data.ts` reads these files from disk at build time
and validates each one against a zod schema, so a malformed crawl commit fails the
build instead of rendering nonsense. Every dynamic route (`/u/[login]`,
`/countries/[id]`, `/cities/[id]`) has `generateStaticParams`. There is no request-time
GitHub call and no runtime GitHub token anywhere in the app — a token is only ever
needed by the crawler, offline.

## Architecture

- **Next.js 16, App Router.** React 19 server components by default; the `"use client"`
  boundary sits at the individual motion pattern, not at the page.
- **Tailwind v4**, consuming the design-token block at the top of `app/globals.css`
  through `@theme inline`. Tokens resolve at build time, so anything injected at
  runtime via a `style` attribute uses `var()` directly rather than a utility class.
- **`components/patterns/`** — one component per motion pattern, 18 of them, plus three
  shared hooks (`use-in-view`, `use-raf`, `use-reduced-motion`). Each file documents the
  obligations it honours in a header comment.
- **`components/charts/`** — seven hand-rolled SVG charts (`bump-chart`, `heatmap`,
  `scatter`, `sparkline`, `split-bar`, `streak-ring`, `tile-grid-map`). No charting
  library; `d3-scale`, `d3-shape` and `d3-array` are used for maths only, and the
  markup is ours. They render on the server, which is what keeps the no-JS contract
  achievable.
- **`components/background/`** — a four-layer composite: a static radial base wash
  (also the reduced-motion and no-WebGL fallback), a WebGL2 aurora mesh at half DPR and
  30fps that pauses off-screen, a canvas commit field seeded from the real contribution
  distribution, an inline SVG grain tile, and a CSS hairline grid aligned to the
  editorial column grid. The whole thing is `aria-hidden`, fixed and
  `pointer-events-none`.
- **`lib/`** — `data.ts` (loaders), `schema.ts` (zod mirrors of `types.ts`),
  `calendar.ts` (deterministic calendar estimation), `format.ts`, `geo.ts` (country
  centroids for the tile map), `motion.ts` (easing/duration constants mirroring the CSS
  tokens).

## Machine-readable surfaces

The snapshot is not only a website. The same data is served three ways, all from one shared
query layer (`lib/api/queries.ts`) so the surfaces cannot drift apart.

### MCP server — `POST /api/mcp`

A Model Context Protocol server over the snapshot, living inside the Next app, so deploying the
site deploys the server.

```
claude mcp add --transport http commitgraph https://<domain>/api/mcp
```

JSON-RPC 2.0, protocol `2025-06-18`, no authentication, `GET` returns 405. It is hand-rolled
(`lib/mcp/`) rather than built on `@modelcontextprotocol/sdk`: the SDK's HTTP transport expects
Node `req`/`res` rather than the Web `Request`/`Response` a route handler receives, and its
released versions pin zod 3 while this project runs zod 4. Zod 4's `z.toJSONSchema()` generates
each tool's advertised `inputSchema` from the very schema that validates the call, so the two
cannot disagree.

Twelve tools. Start with `commitgraph_describe_dataset` — it returns the snapshot date, every
count, the meaning and provenance of every field, and the full list of valid scope ids. Then
`commitgraph_search_developers`, `commitgraph_get_developer`, `commitgraph_get_leaderboard`,
`commitgraph_compare_developers`, `commitgraph_list_places`, `commitgraph_get_organizations`,
`commitgraph_get_repositories`, `commitgraph_get_rank_history`, `commitgraph_get_statistics`,
`commitgraph_get_flagged_accounts`, and `commitgraph_get_integration_guide`.

Four resources: `commitgraph://policy`, `commitgraph://manifest`, `commitgraph://schema` (JSON
Schema generated from `lib/schema.ts`) and `commitgraph://leaderboard/worldwide`.

### REST — `GET /api/v1`

The same data for clients that do not speak MCP. `/api/v1` describes itself; `/api/openapi.json`
is the OpenAPI 3.1 document.

### Discovery

`/.well-known/mcp.json` points at the MCP endpoint and names its tools; `/llms.txt` orients an
agent in plain text, caveats included.

### Search index

Search has to see every ranked developer, but they live across 88 country files and 119 city
files. `scripts/build-index.ts` flattens them into `data/index/search.json` — one read instead
of 207 — plus `data/index/order.json`, three arrays of row indices so serving any sorted page
is a slice rather than a sort. Both run automatically as `prebuild`.

Rows are stored as **array tuples**, not objects, and the avatar is a numeric account id
rather than a URL. That took a row from 377 bytes to 105 — the difference between 250,000
developers being 94 MB and being ~26 MB, which is the difference between the index fitting in
git and in a serverless function and not.

## Discoverability

Everything here derives from `lib/site.ts`, which owns the canonical origin. Point a real
domain at the deployment by setting `NEXT_PUBLIC_SITE_URL`; nothing else needs editing.

- **Canonical URLs on every route.** `/leaderboard` self-canonicalises including `?sort`
  and `?offset`, because those pages hold genuinely different developers — collapsing them
  onto one URL would tell a search engine that different people are the same page. Past
  rank 1000 the paginated series goes `noindex, follow`: 250,000 rows is 2,500 offset URLs
  per sort, and burying the pages worth finding under 7,500 thin ones is a poor trade. The
  depth is served by individually-indexed profile pages instead. `/search?…` is
  `noindex, follow` for the same reason.
- **Sharded sitemap.** `generateSitemaps` emits `/sitemap/0.xml` (static routes and every
  place) and `/sitemap/N.xml` (profiles, 25,000 each), because the protocol caps one file
  at 50,000 URLs. Note that Next emits no `/sitemap.xml` index, so `robots.ts` lists each
  shard rather than advertising a path that 404s.
- **AI crawlers are named and allowed** in `robots.txt` — nineteen of them, listed in
  `AI_CRAWLERS`. This is a public dataset that exists to be cited, and an assistant reading
  the site is a reader like any other. Naming them means a future decision to exclude one
  is a visible edit rather than a silent default.
- **JSON-LD on every route** (`lib/structured-data.ts`): `WebSite` with a `SearchAction`
  that points at a search route which really works, a `Dataset` naming the measurement
  window and the API endpoints, an `ItemList` per board, a `ProfilePage` per developer, and
  breadcrumbs. Contribution counts are modelled as `InteractionCounter` — never
  `aggregateRating`, which would earn a star snippet by inventing one.
- **Open Graph images are generated from the live snapshot** (`app/opengraph-image.tsx`),
  so the card carries the real developer count and the real name at rank one rather than a
  stale PNG.

## Analytics

PostHog, off by default. `NEXT_PUBLIC_POSTHOG_KEY` is what turns it on; with no key the
site makes no third-party request and shows no consent banner, which is what a fork or a
preview deployment should do.

When it is enabled, the library initialises with `opt_out_capturing_by_default` so that
**no cookie is written before the banner is answered**. Initialising eagerly and opting out
afterwards is the common shortcut, and it sets the cookie first. Pageviews are captured
manually per navigation because App Router transitions never fire a document load, so
PostHog's automatic pageview would record the entry page and nothing else.

## Design system

Motion patterns come from the public **rejouice-patterns** MCP server at
`https://rejouice-patterns.vercel.app/api/mcp`, registered in [`.mcp.json`](.mcp.json).
The token block at the top of `app/globals.css` is fetched verbatim from
`rejouice://tokens` and is never edited in place — it is overridden in a second `:root`
block immediately below it.

That override block is the important design decision here. **The corpus defaults are
scaled down deliberately.** They are agency-scale: a `14rem` display face is correct for
a studio site with six words on the screen. This is a data site, so `--type-display`
drops to `clamp(2rem, 5.5vw, 5.5rem)` — roughly a third of the corpus default — along
with proportional cuts to `--type-h1`, `--type-h2` and `--space-xl`. Dialling the
display down is what lets density, tables and charts carry the page instead of
headlines. The dark/light pair is swapped rather than hard-coded, so
`scroll-color-inversion` can flip a section without new literals.

Two rules govern how patterns are spent:

- **A budget of at most four motion patterns per route.** Chrome patterns in the root
  layout (`condensing-sticky-nav`, `curtain-route-transition`, `contextual-cursor`,
  `numeric-preloader`) are counted once, globally, not against every page.
- **`rejouice_review_pattern_stack`** — the MCP server's review tool — validates each
  route's stack against the corpus before that route is considered done. It is what
  catches a page that has quietly accumulated five patterns, or a combination the
  corpus warns against.

## Accessibility contract

Two rules are non-negotiable and are enforced by a test, not by intent:

1. **Every route is readable with JavaScript disabled.** The rankings, charts and
   copy are server-rendered; motion patterns only ever *remove* a transform or *raise*
   an opacity, so a pattern that never hydrates leaves content visible rather than
   hidden.
2. **Nothing is left translated, faded or hidden under `prefers-reduced-motion:
   reduce`.** Components branch in JS; `app/globals.css` carries a global backstop that
   forces `[data-reveal]` to its final state so a component that forgets is still
   correct.

Both are verified by:

```bash
pnpm build && pnpm start        # in one shell
node tests/shots.mjs            # in another
```

`tests/shots.mjs` drives Playwright over all fifteen routes at desktop and mobile, with
reduced motion on and off and with JavaScript disabled. It fails the run if any element
is left below 5% opacity or heavily translated under reduced motion, if a no-JS page
renders under 200 characters of text in `<main>`, or if any page logs a console error.
Screenshots land in `/tmp/shots` by default.

Beyond that: a skip link, a 3:1 focus ring that swaps colour when a section inverts,
44px touch targets in the condensed nav, `tabular-nums` on every number so odometers do
not reflow, and DOM order that always equals reading order — the asymmetric grid never
reorders content.

## Honesty

The short version; the full account is on `/methodology`.

- **Measured vs estimated.** Contribution totals and follower counts are measured.
  Where the day-by-day calendar has not been fetched, the heatmap shape is a
  *deterministic estimate* derived from the measured total: the same login always
  produces the same calendar, and the total always matches exactly. Every field carries
  a `Provenance` of `measured`, `estimated` or `unavailable` (`lib/types.ts`), and
  anything estimated is labelled in the UI.
- **Automation exclusion.** Accounts above **300,000 contributions in twelve months** —
  over 820 every day without a break — are flagged as automation and excluded from every
  ranking. That threshold is set high enough to keep genuine high-volume maintainers who
  run packaging pipelines under their own name. The excluded accounts are listed openly
  on `/methodology` and in `data/flagged.json` rather than being silently dropped, which
  is the part most leaderboards get wrong: they either leave a bot at number one or
  remove it without telling you.
- **Free-text location parsing.** GitHub has no structured country or city field, only
  a line people fill in however they like. Country comes from searching that field; city
  is parsed from the same string and kept only where at least eight tracked developers
  agree on a name. "Earth", "remote" and "/dev/null" are discarded rather than guessed
  at. This is the largest source of error on the site.
- **Organizations** are ranked by the combined contributions of tracked developers who
  name them in a free-text company field, so the board reflects what people type,
  spelling variants included.

## Scripts

| Script | Command | What it does |
| --- | --- | --- |
| `dev` | `next dev` | Development server |
| `build` | `next build` | Production build; reads and validates `data/` |
| `start` | `next start` | Serves the production build |
| `lint` | `eslint .` | Flat config in `eslint.config.mjs` (`eslint-config-next`) |
| `typecheck` | `tsc --noEmit` | TypeScript, `strict` |
| `crawl` | `tsx scripts/crawler/index.ts` | Scheduled GitHub crawler. Pick a stage with `--tier=verify\|discover\|hydrate\|calendars\|supplement\|countries\|cities\|orgs\|repos` |
| `crawl:fixtures` | `tsx scripts/crawler/index.ts --fixtures` | The whole pipeline against recorded fixtures — no network, no token |
| `seed` | `tsx scripts/bootstrap-seed.ts` | Builds the bootstrap snapshot into `data/` |
| `build:index` | `tsx scripts/build-index.ts` | Rebuilds the search index; runs automatically as `prebuild` |
| `test` | `node --test "scripts/**/*.test.ts"` | 49 pipeline unit tests, all offline |

Three Playwright scripts are deliberately not in `package.json`, because all of them need a
server already running: `node tests/shots.mjs` (the accessibility sweep),
`node tests/launch-media.mjs` (regenerates the Product Hunt gallery) and
`node tests/launch-video.mjs` (records the 65-second demo tour). The two launch scripts
photograph the live site, so their output always matches whatever the site is serving.

## Licence and attribution

**This repository does not yet declare a licence**, which means default copyright applies
and nobody else has permission to reuse it. That is worth fixing before the project is
promoted anywhere. The `Dataset` structured data deliberately omits a `license` field until
one exists, rather than asserting a licence that was never chosen.

The bootstrap snapshot is derived from
[gayanvoice/top-github-users](https://github.com/gayanvoice/top-github-users), with
thanks. Design tokens and motion patterns come from
[rejouice-patterns](https://rejouice-patterns.vercel.app).
