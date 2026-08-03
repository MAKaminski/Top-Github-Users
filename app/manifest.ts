import type { MetadataRoute } from "next";

import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

/** Web app manifest. Not a PWA — there is no offline story and pretending
 *  otherwise would be a lie to the install prompt — but it gives Android and
 *  desktop Chrome a real name, colour and icon when someone bookmarks a board. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — the most active developers on GitHub`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "browser",
    background_color: "#07070a",
    theme_color: "#07070a",
    categories: ["developer", "productivity", "utilities"],
    icons: [{ src: "/icon", sizes: "32x32", type: "image/png" }],
  };
}
