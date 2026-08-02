import { decodeSegment, fail, handle, ok } from "@/lib/api/http";
import { getRankHistory, parseScope } from "@/lib/api/queries";

export function GET(
  _request: Request,
  { params }: { params: Promise<{ scope: string }> },
): Promise<Response> {
  return handle(async () => {
    const { scope } = await params;
    const decoded = decodeSegment(scope);

    // Validate the shape first: a scope we cannot parse is a 404, whereas a
    // well-formed scope with no recorded history is a 200 that says so.
    const parsed = parseScope(decoded);
    if ("error" in parsed) return fail("not_found", parsed.error, 404);

    const result = await getRankHistory(decoded);
    return ok({
      scope: decoded,
      plottable: result.plottable,
      note: result.note,
      history: result.history,
    });
  });
}
