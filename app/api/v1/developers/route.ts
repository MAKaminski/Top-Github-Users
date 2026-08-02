import { fail, handle, ok, readQuery } from "@/lib/api/http";
import { searchDevelopers, type DeveloperFilters } from "@/lib/api/queries";

const SORTS = ["contributions", "followers", "rank", "login"] as const;

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const query = readQuery(request.url);

    const filters: DeveloperFilters = {
      query: query.text("q"),
      countryId: query.text("country"),
      cityId: query.text("city"),
      company: query.text("company"),
      minContributions: query.integer("minContributions", { min: 0 }),
      maxContributions: query.integer("maxContributions", { min: 0 }),
      minFollowers: query.integer("minFollowers", { min: 0 }),
      hasProfile: query.boolean("hasProfile"),
      sort: query.choice("sort", SORTS),
    };

    // Read every parameter before checking, so one request reports all of its
    // mistakes rather than one per round trip.
    const problem = query.problem();
    if (problem) return fail("bad_request", problem, 400);

    const page = await searchDevelopers(filters, query.limit, query.offset);
    return ok({
      filters,
      sort: filters.sort ?? "contributions",
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      hasMore: page.hasMore,
      items: page.items,
    });
  });
}
