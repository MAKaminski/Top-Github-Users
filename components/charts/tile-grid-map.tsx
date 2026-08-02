import Link from "next/link";
import { scaleSqrt } from "d3-scale";
import { layoutTiles } from "@/lib/geo";
import { abbreviate, exact } from "@/lib/format";
import type { Place } from "@/lib/types";

const COLS = 34;
const ROWS = 16;

/**
 * Tile-grid world map.
 *
 * Every country gets an equal-area tile positioned by its real centroid, with
 * intensity mapped to contributions. Deliberately not a true choropleth: on a
 * geographic map Russia and Canada dominate the frame regardless of what the
 * data says, which is the classic way this chart lies.
 */
export function TileGridMap({ places }: { places: Place[] }) {
  const withIso = places.filter((place) => place.iso2);
  const byIso = new Map(withIso.map((place) => [place.iso2 as string, place]));
  const cells = layoutTiles(
    withIso.map((place) => place.iso2 as string),
    COLS,
    ROWS,
  );

  const max = Math.max(1, ...withIso.map((place) => place.totalContributions));
  const intensity = scaleSqrt().domain([0, max]).range([0.14, 1]);


  return (
    <figure className="m-0">
      <div
        className="grid w-full gap-[0.35%]"
        style={{
          gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))`,
          aspectRatio: `${COLS} / ${ROWS}`,
        }}
      >
        {cells.map((cell) => {
          const place = byIso.get(cell.iso2);
          if (!place) return null;
          const alpha = intensity(place.totalContributions);

          return (
            <Link
              key={cell.iso2}
              href={`/countries/${place.id}`}
              data-cursor={place.iso2 ?? undefined}
              title={`${place.name} — ${exact(place.totalContributions)} contributions`}
              className="group relative block outline-offset-2"
              style={{ gridColumn: cell.col + 1, gridRow: cell.row + 1 }}
            >
              <span className="sr-only">
                {place.name}: {exact(place.totalContributions)} contributions from{" "}
                {exact(place.userCount)} tracked developers
              </span>
              <span
                aria-hidden="true"
                className="block size-full transition-transform duration-[var(--dur-quick)] ease-[var(--ease-out-expo)] group-hover:scale-125 group-focus-visible:scale-125"
                style={{
                  background: `color-mix(in oklab, var(--accent) ${Math.round(alpha * 100)}%, var(--level-0))`,
                }}
              />
            </Link>
          );
        })}
      </div>

      <figcaption className="mt-[var(--space-sm)] flex flex-wrap items-center justify-between gap-[var(--space-sm)]">
        <span className="eyebrow">
          {cells.length} countries · tile position from country centroid, intensity from
          contributions
        </span>
        <span className="flex items-center gap-2">
          <span className="eyebrow">Low</span>
          <span aria-hidden="true" className="flex gap-[2px]">
            {[0.14, 0.35, 0.55, 0.78, 1].map((a) => (
              <span
                key={a}
                className="block size-[10px]"
                style={{
                  background: `color-mix(in oklab, var(--accent) ${Math.round(a * 100)}%, var(--level-0))`,
                }}
              />
            ))}
          </span>
          <span className="eyebrow">{abbreviate(max)}</span>
        </span>
      </figcaption>
    </figure>
  );
}
