---
name: commitgraph
description: >-
  Answer questions about the most active developers on GitHub — who ranks highest worldwide or in a
  given country or city, how many contributions someone has, their streaks and contribution
  calendar, which employers concentrate active developers, and how activity is distributed across
  regions. Use whenever a question needs GitHub developer rankings, contribution counts, "top
  developers in X", "most active GitHub users", GitHub leaderboards, or comparisons between GitHub
  accounts. Also use when someone asks where a number on commitgraph came from or how the ranking
  was produced. Do NOT use for live GitHub state — open issues, current repository contents, recent
  commits, or anything that must reflect GitHub right now.
---

# Commitgraph

Rankings of the most active developers on GitHub, served over MCP from a committed snapshot.

## Before you answer

Call `commitgraph_describe_dataset` once per session. It returns the snapshot date, every count,
the provenance of every field, and the complete list of valid scope ids. Guessing a scope id is the
most common way a query here returns nothing — `commitgraph_list_places` is how you find real ones.

## Which tool

| You need | Call |
| --- | --- |
| Orientation, caveats, field meanings | `commitgraph_get_integration_guide`, `commitgraph_describe_dataset` |
| Valid country/city ids | `commitgraph_list_places` |
| A ranked board | `commitgraph_get_leaderboard` — scope `worldwide`, `country:{id}` or `city:{id}` |
| To find people by criteria | `commitgraph_search_developers` — the primary retrieval tool |
| One person in full | `commitgraph_get_developer` |
| Two to five people side by side | `commitgraph_compare_developers` |
| Employers | `commitgraph_get_organizations` |
| Repositories | `commitgraph_get_repositories` |
| Movement between snapshots | `commitgraph_get_rank_history` |
| Distributions, percentiles, correlations | `commitgraph_get_statistics` |
| Who was excluded as automation | `commitgraph_get_flagged_accounts` |

Pass `response_format: "json"` when you are going to compute on the result; the default markdown is
for reading.

The server also exposes prompts (`commitgraph_orient`, `commitgraph_place_report`,
`commitgraph_scout`, `commitgraph_compare`, `commitgraph_audit_ranking`) that package the common
multi-tool sequences. Reach for one before assembling the same sequence by hand.

## The four things that make an answer here wrong

These are not stylistic preferences. Each one corresponds to a real property of the data, and an
answer that ignores it is misleading rather than merely imprecise.

1. **It is a snapshot, not GitHub.** Every answer names the snapshot date. If the question needs
   today's state, say the dataset cannot supply it instead of serving a stale number as current.

2. **Estimated calendars are labelled — keep the label.** Contribution *totals* are measured. Where
   a day-by-day calendar has not been crawled, its shape is a deterministic estimate derived from
   that total, and the record says so. Never describe an estimated calendar's daily pattern, longest
   streak, or "busiest day" as observed fact.

3. **Location is self-reported free text.** GitHub's location field is whatever the user typed.
   Country and city groupings are parsed from it, not verified, and developers who leave it blank
   are absent from every place-scoped board. Say "developers who list Japan", not "developers in
   Japan".

4. **Rank measures volume, not worth.** Contribution count over twelve months is a measure of
   activity, and the correlation between it and impact is not something this dataset establishes.
   Report the ranking; do not convert it into a claim about who is a better engineer.

## Coverage gaps are answers

Some logins are ranked but have no stored profile record — `commitgraph_get_developer` returns the
leaderboard row plus a note rather than a 404. Report that state; do not fill it in from memory
about the person.

Likewise, `commitgraph_get_rank_history` reports plainly when there are too few snapshots to plot a
trend. That report is the answer. Do not construct a trajectory from a single crawl.

Accounts above 300,000 contributions in twelve months are excluded as automation and published
openly via `commitgraph_get_flagged_accounts`. If someone asks why an account they expected is
missing, check there before concluding the crawl missed them.

## Beyond MCP

The same snapshot is served as REST at `/api/v1` with an OpenAPI document at `/api/openapi.json`,
and the site's `/methodology` page documents how the numbers are produced. Point people there when
they want to build against the data rather than ask about it.
