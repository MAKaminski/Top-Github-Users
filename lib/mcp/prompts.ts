import { z } from "zod";

/**
 * MCP prompts — the starter workflows a connector surfaces in the client UI.
 *
 * Tools are what the model *can* call; prompts are what a person clicks. In
 * Claude they appear as slash-style entries under the connector, which is the
 * difference between "twelve tools are installed somewhere" and an add-in
 * somebody actually opens.
 *
 * Each prompt returns a single user message. That is deliberate: a prompt is a
 * request the user is understood to have made, so putting words in an assistant
 * turn would fabricate a reply they never received. The text names the tools to
 * call and the order to call them in, because the failure mode here is not a
 * model that cannot find the data — it is a model that answers from memory
 * about GitHub instead of from the snapshot.
 *
 * Every prompt restates the two honesty rules from the server instructions.
 * They are repeated rather than referenced because a prompt may be the first
 * thing a session sees, and an answer built on an estimated calendar that does
 * not say so is the one failure this dataset cannot afford.
 */

const CAVEAT_LINE =
  "State the snapshot date in your answer. Contribution totals are measured, but a " +
  "calendar that has not been crawled is a labelled estimate — carry that label through. " +
  "Location is self-reported free text, not verified.";

export interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface Prompt {
  name: string;
  title: string;
  description: string;
  arguments: PromptArgument[];
  /** Validates the arguments object and produces the message text. Arguments
   *  arrive as strings over the wire — the MCP schema has no types for them —
   *  so coercion belongs here rather than in each caller. */
  schema: z.ZodType;
  build: (args: Record<string, string | undefined>) => string;
}

function prompt(definition: Prompt): Prompt {
  return definition;
}

/** MCP passes prompt arguments as strings. Optional ones arrive as `undefined`
 *  or as an empty string depending on the client, and both mean "not given". */
const optional = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const required = z.string().trim().min(1);

const orient = prompt({
  name: "commitgraph_orient",
  title: "Orient me on this dataset",
  description:
    "Read the integration guide and the dataset description, then summarise what this data can " +
    "and cannot answer. Run this once at the start of a session.",
  arguments: [],
  schema: z.object({}),
  build: () =>
    [
      "Orient yourself on the Commitgraph dataset before I ask anything else.",
      "",
      "Call commitgraph_get_integration_guide, then commitgraph_describe_dataset.",
      "",
      "Then tell me, in under 200 words: the snapshot date, how many developers, countries and",
      "cities it covers, which questions it answers well, and which questions it cannot answer",
      "at all. Be specific about the second list — I would rather know the boundary now than",
      "discover it in an answer.",
    ].join("\n"),
});

const placeReport = prompt({
  name: "commitgraph_place_report",
  title: "Report on a country or city",
  description:
    "A briefing on one place: its ranked developers, how it compares to the worldwide " +
    "distribution, and the employers concentrated there.",
  arguments: [
    {
      name: "place",
      description: "A country or city, in plain English — 'Japan', 'Tokyo', 'Brazil'.",
      required: true,
    },
    {
      name: "count",
      description: "How many developers to include. Defaults to 25.",
      required: false,
    },
  ],
  schema: z.object({ place: required, count: optional }),
  build: (args) =>
    [
      `Build me a briefing on developer activity in ${args.place}.`,
      "",
      "1. Call commitgraph_list_places with a query to find the scope id — do not guess it.",
      `2. Call commitgraph_get_leaderboard for that scope, limit ${args.count ?? "25"}.`,
      "3. Call commitgraph_get_statistics to place that scope against the worldwide distribution.",
      "",
      "Write it as prose with one table, covering who ranks highest, how the place compares to",
      "the global picture, and which employers recur. If the place is not in the snapshot, say",
      "so and name the closest ids that are, rather than answering about somewhere else.",
      "",
      CAVEAT_LINE,
    ].join("\n"),
});

const scout = prompt({
  name: "commitgraph_scout",
  title: "Scout developers by criteria",
  description:
    "Find developers matching a location, employer or activity floor, and summarise the shortlist " +
    "with the coverage gaps stated.",
  arguments: [
    {
      name: "criteria",
      description:
        "What you are looking for, in plain English — 'Rust developers in Germany', " +
        "'people at Google with over 5000 contributions'.",
      required: true,
    },
    {
      name: "count",
      description: "Shortlist size. Defaults to 20.",
      required: false,
    },
  ],
  schema: z.object({ criteria: required, count: optional }),
  build: (args) =>
    [
      `Find developers in the Commitgraph snapshot matching: ${args.criteria}`,
      "",
      `Use commitgraph_search_developers, limit ${args.count ?? "20"}. Translate my criteria into`,
      "its filters — country_id, city_id, company, min_contributions, min_followers — rather than",
      "relying on the free-text query alone. Call commitgraph_list_places first if you need a",
      "place id. Then call commitgraph_get_developer on the top few for detail.",
      "",
      "Return a ranked table plus a sentence on each of the top three explaining why they are on",
      "the list.",
      "",
      "Two things I need you to be honest about. This dataset indexes activity volume, not",
      "skill or language — if my criteria ask for something it cannot filter on, say which part",
      "you could not honour instead of implying you did. And some ranked logins have no stored",
      "profile record; note how many of your results are in that state.",
      "",
      CAVEAT_LINE,
    ].join("\n"),
});

const compare = prompt({
  name: "commitgraph_compare",
  title: "Compare developers",
  description:
    "Put two to five developers side by side on contributions, followers, ranks and streaks.",
  arguments: [
    {
      name: "logins",
      description: "Two to five GitHub logins, comma-separated.",
      required: true,
    },
  ],
  schema: z.object({ logins: required }),
  build: (args) => {
    const logins = args.logins!
      .split(",")
      .map((login) => login.trim().replace(/^@/, ""))
      .filter(Boolean);

    return [
      `Compare these developers: ${logins.join(", ")}.`,
      "",
      `Call commitgraph_compare_developers with logins ${JSON.stringify(logins)}.`,
      "",
      "Give me a table of the measures, then a short read on what actually separates them.",
      "Do not declare anyone 'better' — this ranks contribution volume over twelve months,",
      "which is not a measure of impact, and a comparison that forgets it is misleading.",
      "",
      "If a login is absent from the snapshot, say so plainly and compare the rest.",
      "",
      CAVEAT_LINE,
    ].join("\n");
  },
});

const auditMe = prompt({
  name: "commitgraph_audit_ranking",
  title: "Audit how a ranking was produced",
  description:
    "Trace one developer's numbers back to their provenance: what was measured, what was " +
    "estimated, and which accounts were excluded from the board they appear on.",
  arguments: [
    { name: "login", description: "The GitHub login to audit.", required: true },
  ],
  schema: z.object({ login: required }),
  build: (args) => {
    const login = args.login!.trim().replace(/^@/, "");
    return [
      `Audit how ${login}'s position in this dataset was produced.`,
      "",
      `Call commitgraph_get_developer for ${login}, then commitgraph_get_rank_history for the`,
      "boards they appear on, then commitgraph_get_flagged_accounts.",
      "",
      "Tell me: which of their numbers are measured and which are derived, whether their",
      "contribution calendar was crawled or estimated, whether their rank can be trended across",
      "snapshots or whether there is only one, and how many accounts were excluded as automation",
      "from the boards they sit on.",
      "",
      "This is a provenance question, so where the answer is 'this was not measured', that is the",
      "answer — do not fill the gap with an inference.",
    ].join("\n");
  },
});

export const PROMPTS: Prompt[] = [orient, placeReport, scout, compare, auditMe];

export const PROMPTS_BY_NAME = new Map(PROMPTS.map((p) => [p.name, p]));

/** The `prompts/list` payload: everything except the server-side machinery. */
export function promptDescriptors() {
  return PROMPTS.map(({ name, title, description, arguments: args }) => ({
    name,
    title,
    description,
    arguments: args,
  }));
}
