import { handle, ok } from "@/lib/api/http";
import { getManifest } from "@/lib/api/queries";

/** The whole manifest, including every country and city with its aggregates —
 *  this is the endpoint a caller uses to learn which scope ids exist. */
export function GET(): Promise<Response> {
  return handle(async () => {
    const manifest = await getManifest();
    return ok({ manifest });
  });
}
