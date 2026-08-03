/**
 * Offline client backed by recorded responses.
 *
 * The GitHub API cannot be reached from CI's test job, and a crawler that can
 * only be exercised against the live API is a crawler nobody dares change. The
 * fixtures in `__fixtures__/` are ordinary recorded payloads, and this client
 * feeds them through the *same* decoders `GitHubClient` uses — so the test
 * covers the real parsing, not a parallel implementation of it.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeGraphQlUsers,
  decodeSearchRepositories,
  decodeSearchUsers,
  type ContributionWindow,
  type EnrichOptions,
  type EnrichResult,
  type GitHubApi,
  type GraphQLBody,
  type GraphUser,
  type SearchOptions,
  type SearchRepository,
  type SearchUser,
} from "./github.ts";

export const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");

async function readFixture<T>(dir: string, name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(dir, `${name}.json`), "utf8")) as T;
}

export class FixtureClient implements GitHubApi {
  dir: string;
  users: SearchUser[];
  repositories: SearchRepository[];
  recorded: Map<string, GraphUser>;

  constructor(
    dir: string,
    users: SearchUser[],
    repositories: SearchRepository[],
    recorded: Map<string, GraphUser>,
  ) {
    this.dir = dir;
    this.users = users;
    this.repositories = repositories;
    this.recorded = recorded;
  }

  async searchUsers(_query: string, options: SearchOptions = {}): Promise<SearchUser[]> {
    return this.users.slice(0, options.max ?? this.users.length);
  }

  async searchRepositories(
    _query: string,
    options: SearchOptions = {},
  ): Promise<SearchRepository[]> {
    return this.repositories.slice(0, options.max ?? this.repositories.length);
  }

  /**
   * Replays the recording in whatever order the caller asked for. Logins with
   * no recorded user come back as `skipped`, which is exactly how a live batch
   * reports a deleted or renamed account.
   *
   * `calendar: false` strips `weeks` from the replayed payload rather than
   * ignoring the flag. Mirroring the real response matters: the whole point of
   * the scalars-only pass is that the days are *absent*, and a fixture that
   * quietly supplied them would leave the code path that copes with their
   * absence untested.
   */
  async enrichUsers(
    logins: string[],
    _window: ContributionWindow,
    options: EnrichOptions = {},
  ): Promise<EnrichResult> {
    const batchSize = 100;
    const all: EnrichResult = { users: [], skipped: [] };

    for (let start = 0, index = 0; start < logins.length; start += batchSize, index++) {
      const batch = logins.slice(start, start + batchSize);
      const data: Record<string, GraphUser | null> = {};

      batch.forEach((login, position) => {
        let user = this.recorded.get(login) ?? null;
        if (user && options.calendar === false) user = withoutDays(user);
        // Same reasoning as the days: the scalars pass genuinely does not
        // receive repository nodes, and `languagesFrom` has to be exercised
        // against their absence rather than always seeing them.
        if (user && options.languages === false) user = withoutRepositoryNodes(user);
        data[`u${position}`] = user;
      });

      const decoded = decodeGraphQlUsers({ data } as GraphQLBody, batch);
      if (options.onBatch) await options.onBatch({ ...decoded, index });
      else {
        all.users.push(...decoded.users);
        all.skipped.push(...decoded.skipped);
      }
    }

    return all;
  }
}

/** The same user as a query without `languages` would return them: the
 *  repository count survives, the per-repo nodes do not. */
function withoutRepositoryNodes(user: GraphUser): GraphUser {
  return { ...user, repositories: { totalCount: user.repositories.totalCount } };
}

/** The same user as the scalars-only query would return them. */
function withoutDays(user: GraphUser): GraphUser {
  const { weeks: _days, ...calendar } = user.contributionsCollection.contributionCalendar;
  return {
    ...user,
    contributionsCollection: { ...user.contributionsCollection, contributionCalendar: calendar },
  };
}

export async function loadFixtureClient(dir: string = FIXTURES_DIR): Promise<FixtureClient> {
  const [searchPage, repoPage, graphql] = await Promise.all([
    readFixture<unknown>(dir, "search-users"),
    readFixture<unknown>(dir, "search-repositories"),
    readFixture<GraphQLBody>(dir, "graphql-users"),
  ]);

  const users = decodeSearchUsers(searchPage);
  const decoded = decodeGraphQlUsers(
    graphql,
    users.map((user) => user.login),
  );

  return new FixtureClient(
    dir,
    users,
    decodeSearchRepositories(repoPage),
    new Map(decoded.users.map((user) => [user.login, user])),
  );
}
