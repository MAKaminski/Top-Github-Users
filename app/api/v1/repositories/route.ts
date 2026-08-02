import { handle, ok } from "@/lib/api/http";
import { getRepositories } from "@/lib/api/queries";

export function GET(): Promise<Response> {
  return handle(async () => {
    const items = await getRepositories();
    return ok({
      total: items.length,
      items,
      // An empty array with no explanation reads as a broken endpoint. It is
      // not: the current snapshot ranks people and places, and never collected
      // repositories.
      note:
        items.length === 0
          ? "This snapshot contains no repositories. Repository collection is not part of the " +
            "current crawl, so the list is empty by design rather than by failure — see " +
            "counts.repositories in /api/v1/manifest."
          : "Top repositories by stars, as recorded in this snapshot.",
    });
  });
}
