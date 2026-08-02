import { decodeSegment, fail, handle, ok, readQuery } from "@/lib/api/http";
import { getLeaderboard, getPlaceDetail } from "@/lib/api/queries";

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const { id } = await params;
    const query = readQuery(request.url);
    const problem = query.problem();
    if (problem) return fail("bad_request", problem, 400);

    const detail = await getPlaceDetail(decodeSegment(id));
    if (!detail) {
      return fail(
        "not_found",
        `No country or city with id "${id}". Call /api/v1/places for valid ids.`,
        404,
      );
    }

    // The board can run to hundreds of rows, so it is served as a page. Going
    // back through getLeaderboard keeps one implementation of paging and scope
    // naming; both reads hit the same cached snapshot file.
    const board = await getLeaderboard(
      `${detail.place.kind}:${detail.place.id}`,
      query.limit,
      query.offset,
    );

    return ok({
      place: detail.place,
      leaderboard:
        "error" in board
          ? { available: false, note: board.error }
          : {
              available: true,
              scope: board.board.scope,
              total: board.page.total,
              limit: board.page.limit,
              offset: board.page.offset,
              hasMore: board.page.hasMore,
              items: board.page.items,
            },
    });
  });
}
