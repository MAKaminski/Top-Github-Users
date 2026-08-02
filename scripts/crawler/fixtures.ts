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
   */
  async enrichUsers(logins: string[], _window: ContributionWindow): Promise<EnrichResult> {
    const data: Record<string, GraphUser | null> = {};
    logins.forEach((login, index) => {
      data[`u${index}`] = this.recorded.get(login) ?? null;
    });
    return decodeGraphQlUsers({ data } as GraphQLBody, logins);
  }
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
