import { ImageResponse } from "next/og";

import { getManifest, getWorldwide } from "@/lib/data";
import { SITE_NAME } from "@/lib/site";

/**
 * The card that shows up in a Slack unfurl, a tweet, and the Product Hunt
 * gallery — for many people the only part of the site they will ever see.
 *
 * It is generated from the live snapshot rather than being a stored PNG, so it
 * carries the real developer count and the real name at rank one. A card that
 * says "6,551 developers" when the board holds 250,000 is worse than no card:
 * it is a stale claim with a picture attached.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${SITE_NAME} — the most active developers on GitHub`;

export default async function OpengraphImage() {
  const [manifest, worldwide] = await Promise.all([getManifest(), getWorldwide()]);
  const leader = worldwide.entries[0];
  const users = manifest.counts.users.toLocaleString("en-US");

  // A row of bars from the actual top of the board. Normalised against rank one
  // so the shape is the real distribution — which falls off a cliff, and looking
  // like it does is the point.
  const bars = worldwide.entries.slice(0, 48).map((entry) => entry.total / leader.total);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#07070a",
          color: "#f4f2ee",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              fontSize: 26,
              letterSpacing: 6,
              textTransform: "uppercase",
              color: "#4b3bff",
            }}
          >
            {SITE_NAME}
          </div>
          <div style={{ display: "flex", fontSize: 76, lineHeight: 1.05, maxWidth: 900 }}>
            The most active developers on GitHub
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "rgba(244,242,238,0.62)" }}>
            {users} ranked · {manifest.counts.countries} countries · {manifest.counts.cities} cities
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 190 }}>
          {bars.map((share, index) => (
            <div
              key={index}
              style={{
                width: 18,
                height: Math.max(6, share * 190),
                borderRadius: 3,
                background: index === 0 ? "#ff5c38" : `rgba(75, 59, 255, ${0.3 + share * 0.7})`,
              }}
            />
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 26,
            color: "rgba(244,242,238,0.62)",
          }}
        >
          <div style={{ display: "flex" }}>
            #1 @{leader.login} · {leader.total.toLocaleString("en-US")} contributions
          </div>
          <div style={{ display: "flex" }}>snapshot {manifest.generatedAt}</div>
        </div>
      </div>
    ),
    size,
  );
}
