import { decodeSegment, fail, handle, ok, readQuery } from "@/lib/api/http";
import { getLeaderboard, isSort } from "@/lib/api/queries";

export function GET(
  request: Request,
  { params }: { params: Promise<{ scope: string }> },
): Promise<Response> {
  return handle(async () => {
    // Scopes carry a colon (`country:japan`), so the segment reaches us as
    // `country%3Ajapan` from anything that encodes its URLs properly.
    const { scope } = await params;
    const decoded = decodeSegment(scope);

    const query = readQuery(request.url);
    const problem = query.problem();
    if (problem) return fail("bad_request", problem, 400);

    // An unknown sort is rejected rather than silently falling back: a caller
    // asking for `?sort=stars` and receiving a contributions ranking has no way
    // to tell that it did not get what it asked for.
    const requested = new URL(request.url).searchParams.get("sort");
    if (requested !== null && !isSort(requested)) {
      return fail(
        "bad_request",
        `Unrecognised sort "${requested}". Use contributions, followers or streak.`,
        400,
      );
    }

    const result = await getLeaderboard(
      decoded,
      query.limit,
      query.offset,
      requested ?? "contributions",
    );
    // An unparseable or unknown scope is a missing resource, not a server fault:
    // the query layer already explains which ids are valid.
    if ("error" in result) return fail("not_found", result.error, 404);

    const { board, page, sort } = result;
    return ok({
      scope: board.scope,
      name: board.name,
      generatedAt: board.generatedAt,
      sort,
      // Streak ranks mix fetched and estimated calendars; each row carries
      // `calendarMeasured` so a consumer can tell which is which.
      streakCaveat:
        sort === "streak"
          ? "Ranked on longest streak. Rows with calendarMeasured=false are derived from a " +
            "deterministic estimate of the contribution calendar, not a fetched one."
          : undefined,
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      hasMore: page.hasMore,
      items: page.items,
    });
  });
}
