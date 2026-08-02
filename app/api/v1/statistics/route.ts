import { handle, ok } from "@/lib/api/http";
import { getStatistics } from "@/lib/api/queries";

export function GET(): Promise<Response> {
  return handle(async () => {
    const statistics = await getStatistics();
    return ok({ statistics });
  });
}
