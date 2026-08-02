import { AuroraMesh } from "./aurora-mesh";
import { CommitField } from "./commit-field";

/**
 * The site background: four composited layers on a near-black base.
 *
 *   0. base           — var(--paper), plus a static radial wash that is what
 *                       reduced-motion and no-WebGL users see
 *   1. aurora mesh    — WebGL2 fBm, half DPR, 30fps, pauses off-screen
 *   2. commit field   — canvas grid seeded from the real contribution data
 *   3. grain          — one inline SVG turbulence tile, static
 *   4. hairline grid  — pure CSS, aligned to the 12-column editorial grid
 *
 * Everything is aria-hidden, fixed, and pointer-events-none. Nothing here may
 * block LCP: the layers mount below the content in z-order and paint after it.
 */

/** A 128px turbulence tile, generated once by the browser and then cached. */
const GRAIN =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
      <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/></filter>
      <rect width="128" height="128" filter="url(#n)" opacity="0.5"/>
    </svg>`.replace(/\s+/g, " "),
  );

export function SiteBackground({ seed }: { seed: number[] }) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* 0 — static base wash, the reduced-motion and no-WebGL fallback */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 15% -10%, color-mix(in oklab, var(--accent) 26%, transparent), transparent 60%)," +
            "radial-gradient(90% 70% at 90% 0%, color-mix(in oklab, var(--accent-warm) 12%, transparent), transparent 55%)," +
            "var(--paper)",
        }}
      />

      {/* 1 — aurora mesh */}
      <div className="absolute inset-x-0 top-0 h-[85svh] opacity-90">
        <AuroraMesh />
      </div>

      {/* 2 — commit field, masked so it fades out behind the fold */}
      <div
        className="absolute inset-0 opacity-[0.55]"
        style={{
          maskImage: "linear-gradient(to bottom, black 0%, black 45%, transparent 90%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 45%, transparent 90%)",
        }}
      >
        <CommitField seed={seed} />
      </div>

      {/* 4 — hairline grid, aligned to the editorial grid */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to right, var(--rule) 0 1px, transparent 1px 8.3333%)",
          maskImage: "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
        }}
      />

      {/* 3 — grain, on top of everything so it unifies the stack */}
      <div
        className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
        style={{ backgroundImage: `url("${GRAIN}")`, backgroundRepeat: "repeat" }}
      />
    </div>
  );
}
