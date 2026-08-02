/**
 * The things a caller has to know before quoting a number from this dataset.
 *
 * Written once and reused by the REST index, the OpenAPI description and
 * /llms.txt, because a caveat that appears on one surface and not another is
 * worse than no caveat: it makes the omission look deliberate.
 */
export const CAVEATS: readonly string[] = [
  "Contribution totals and follower counts are measured. Daily calendars are measured only " +
    "where the enrichment pass has run; elsewhere they are a deterministic estimate derived " +
    "from the measured total, flagged with calendarSource/estimated, and the total always " +
    "matches exactly. Never present an estimated calendar as observed activity.",

  "Country and city come from GitHub's free-text location field, which has no structured " +
    "form. A city is kept only where at least eight tracked developers agree on the name. " +
    "This is the largest source of error in the dataset.",

  "Accounts exceeding 300,000 contributions in twelve months — over 820 a day without a " +
    "break — are treated as automation and excluded from every ranking. They are listed " +
    "openly rather than dropped silently; see /api/v1/statistics and /methodology.",

  "The snapshot ranks far more logins than it stores full profile records for. A developer " +
    "lookup that returns found:false with reason \"no-profile\" is a coverage gap, not a " +
    "missing account: the leaderboard row is still returned.",

  "This is a periodic crawl, not a live view of GitHub. Every response carries the snapshot " +
    "date it was built from.",
] as const;

/** One-paragraph form, for documents that cannot render a list. */
export const CAVEATS_PARAGRAPH = CAVEATS.join(" ");
