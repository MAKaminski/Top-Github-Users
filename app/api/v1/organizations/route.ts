import { handle, ok } from "@/lib/api/http";
import { getOrganizations } from "@/lib/api/queries";

export function GET(): Promise<Response> {
  return handle(async () => {
    const items = await getOrganizations();
    return ok({
      total: items.length,
      items,
      note:
        "Ranked by the combined contributions of tracked developers who name the organization " +
        "in their profile, not by follower count. The company field is free text, so spelling " +
        "variants of the same employer are counted separately.",
    });
  });
}
