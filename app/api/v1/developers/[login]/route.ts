import { decodeSegment, fail, handle, ok } from "@/lib/api/http";
import { getDeveloper } from "@/lib/api/queries";

export function GET(
  _request: Request,
  { params }: { params: Promise<{ login: string }> },
): Promise<Response> {
  return handle(async () => {
    const { login } = await params;
    const result = await getDeveloper(decodeSegment(login));

    if (result.found) {
      return ok({
        found: true,
        developer: result.user,
        calendar: result.calendar,
        indexRow: result.indexRow,
      });
    }

    // A ranked login with no stored profile record is a coverage gap in this
    // snapshot, not a missing resource — the leaderboard row exists and is
    // returned, so 404 would be a lie about what we hold.
    if (result.reason === "no-profile") {
      return ok({
        found: false,
        reason: result.reason,
        indexRow: result.indexRow,
        note: result.note,
      });
    }

    return fail("not_found", result.note, 404);
  });
}
