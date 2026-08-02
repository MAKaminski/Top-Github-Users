import { fail, handle, ok, readQuery } from "@/lib/api/http";
import { listPlaces, type PlaceFilters } from "@/lib/api/queries";

const KINDS = ["country", "city", "all"] as const;

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const query = readQuery(request.url);

    const filters: PlaceFilters = {
      kind: query.choice("kind", KINDS),
      region: query.text("region"),
      countryId: query.text("countryId"),
      query: query.text("q"),
    };

    const problem = query.problem();
    if (problem) return fail("bad_request", problem, 400);

    const page = await listPlaces(filters, query.limit, query.offset);
    return ok({
      filters,
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      hasMore: page.hasMore,
      items: page.items,
    });
  });
}
