import { decodeSegment, fail, handle, ok, readQuery } from "@/lib/api/http";
import { getLeaderboard } from "@/lib/api/queries";

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

    const result = await getLeaderboard(decoded, query.limit, query.offset);
    // An unparseable or unknown scope is a missing resource, not a server fault:
    // the query layer already explains which ids are valid.
    if ("error" in result) return fail("not_found", result.error, 404);

    const { board, page } = result;
    return ok({
      scope: board.scope,
      name: board.name,
      generatedAt: board.generatedAt,
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      hasMore: page.hasMore,
      items: page.items,
    });
  });
}
