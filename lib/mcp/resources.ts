import { z } from "zod";
import { getManifest, getWorldwide } from "@/lib/data";
import { leaderboardSchema, manifestSchema, rankedUserSchema } from "@/lib/schema";

/**
 * Resources — the things a client can read without calling a tool.
 *
 * Kept deliberately small: the manifest (what exists), the schema (what the
 * shapes are), the policy (what this server can and cannot reach), and the
 * flagship board. Everything else is a tool call, because it takes arguments.
 */

export interface ResourceDefinition {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
  read: () => Promise<string>;
}

const POLICY = `# Commitgraph MCP — policy and data provenance

## What this server can reach

This snapshot, and nothing else. It serves committed JSON from one repository. It has no access
to secrets, environment values, filesystems outside its own data directory, databases, user data,
or the GitHub API at request time. There is no authentication because there is nothing private
here: every figure is derived from public GitHub profiles.

## What it will not do

Requests for credentials, environment values, or anything outside this corpus are refused
deterministically — there is no code path that could satisfy them.

## Where the data comes from

Contribution totals and follower counts are **measured** from the GitHub API by this project's
own crawler, or mapped from a public dataset when the manifest reports \`source: "bootstrap"\`.

Two things are explicitly *not* measurements, and every record says so:

1. **Calendar shape.** Where the day-by-day contribution calendar has not been crawled, it is a
   deterministic estimate derived from the measured total. The same login and total always
   produce the same calendar, and the total always reconciles exactly. \`calendarSource\` carries
   the provenance; treat \`estimated\` as shape-only.
2. **Location.** GitHub has no structured country or city field, only free text. Country comes
   from searching that field; city is parsed from the same string and kept only where several
   developers agree on a name. This is the largest source of error in the dataset.

## Exclusions

Accounts above 300,000 contributions in twelve months are treated as automation and removed from
every ranking. They are published through \`commitgraph_get_flagged_accounts\` rather than dropped
silently, so the rule can be audited.

## Coverage

The snapshot ranks considerably more developers than it stores full profile records for. A miss
on \`commitgraph_get_developer\` is usually coverage, not a bad login — the tool says which.
`;

export const RESOURCES: ResourceDefinition[] = [
  {
    uri: "commitgraph://policy",
    name: "policy",
    title: "Policy and data provenance",
    description:
      "What this server can and cannot reach, how measured and estimated values differ, and the exclusion rules.",
    mimeType: "text/markdown",
    read: async () => POLICY,
  },
  {
    uri: "commitgraph://manifest",
    name: "manifest",
    title: "Snapshot manifest",
    description:
      "Snapshot date and provenance, every count and total, and the full country and city lists.",
    mimeType: "application/json",
    read: async () => JSON.stringify(await getManifest(), null, 2),
  },
  {
    uri: "commitgraph://schema",
    name: "schema",
    title: "JSON Schema for the record types",
    description:
      "JSON Schema for the manifest, leaderboard and developer records, generated from the same zod schemas that validate them on load.",
    mimeType: "application/json",
    read: async () =>
      JSON.stringify(
        {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          $defs: {
            manifest: z.toJSONSchema(manifestSchema),
            leaderboard: z.toJSONSchema(leaderboardSchema),
            developer: z.toJSONSchema(rankedUserSchema),
          },
        },
        null,
        2,
      ),
  },
  {
    uri: "commitgraph://leaderboard/worldwide",
    name: "leaderboard-worldwide",
    title: "Worldwide leaderboard",
    description: "The flagship board — the most active developers on GitHub in this snapshot.",
    mimeType: "application/json",
    read: async () => JSON.stringify(await getWorldwide(), null, 2),
  },
];

export const RESOURCES_BY_URI = new Map(RESOURCES.map((r) => [r.uri, r]));
