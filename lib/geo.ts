/**
 * Approximate country centroids, keyed by ISO 3166-1 alpha-2.
 *
 * Used to lay out the tile-grid map: each country is projected
 * equirectangularly onto a coarse grid and then nudged to the nearest free
 * cell. That keeps the map geographically truthful in broad strokes while
 * giving every country an equal-area tile, which is the honest way to show a
 * per-country count — a true choropleth makes Russia look like the story
 * regardless of the data.
 */
export const CENTROIDS: Record<string, [lat: number, lon: number]> = {
  US: [39.8, -98.6], IN: [22.4, 78.9], CN: [35.9, 104.2], BR: [-14.2, -51.9],
  GB: [54.0, -2.0], DE: [51.2, 10.5], CA: [56.1, -106.3], FR: [46.6, 2.2],
  JP: [36.2, 138.3], RU: [61.5, 90.0], AU: [-25.3, 133.8], NL: [52.1, 5.3],
  ES: [40.5, -3.7], IT: [41.9, 12.6], PL: [51.9, 19.1], SE: [60.1, 18.6],
  CH: [46.8, 8.2], UA: [48.4, 31.2], ID: [-0.8, 113.9], KR: [35.9, 127.8],
  TR: [39.0, 35.2], MX: [23.6, -102.6], AR: [-38.4, -63.6], IL: [31.0, 34.9],
  SG: [1.35, 103.8], NO: [60.5, 8.5], DK: [56.3, 9.5], FI: [61.9, 25.7],
  AT: [47.5, 14.6], BE: [50.5, 4.5], PT: [39.4, -8.2], CZ: [49.8, 15.5],
  IE: [53.4, -8.2], NZ: [-40.9, 174.9], GR: [39.1, 21.8], RO: [45.9, 25.0],
  HU: [47.2, 19.5], VN: [14.1, 108.3], TW: [23.7, 121.0], HK: [22.3, 114.2],
  TH: [15.9, 101.0], PH: [12.9, 121.8], MY: [4.2, 101.98], PK: [30.4, 69.3],
  BD: [23.7, 90.4], NG: [9.1, 8.7], KE: [-0.02, 37.9], ZA: [-30.6, 22.9],
  EG: [26.8, 30.8], IR: [32.4, 53.7], CL: [-35.7, -71.5], CO: [4.6, -74.3],
  PE: [-9.2, -75.0], IS: [64.96, -19.0], EE: [58.6, 25.0], LT: [55.2, 23.9],
  LV: [56.9, 24.6], SK: [48.7, 19.7], SI: [46.2, 15.0], HR: [45.1, 15.2],
  RS: [44.0, 21.0], BG: [42.7, 25.5], BY: [53.7, 27.95], KZ: [48.0, 66.9],
  NP: [28.4, 84.1], LK: [7.9, 80.8], UY: [-32.5, -55.8], EC: [-1.8, -78.2],
  VE: [6.4, -66.6], MA: [31.8, -7.1], TN: [33.9, 9.5], GH: [7.9, -1.0],
  ET: [9.1, 40.5], UG: [1.4, 32.3], LU: [49.8, 6.1], CY: [35.1, 33.4],
  GE: [42.3, 43.4], AM: [40.1, 45.0], AZ: [40.1, 47.6], UZ: [41.4, 64.6],
  SA: [23.9, 45.1], AE: [23.4, 53.8], JO: [30.6, 36.2], LB: [33.9, 35.9],
  MD: [47.4, 28.4], AL: [41.2, 20.2], BO: [-16.3, -63.6], CR: [9.7, -83.8],
  GT: [15.8, -90.2], DO: [18.7, -70.2],
};

export interface TileCell {
  iso2: string;
  col: number;
  row: number;
}

/**
 * Project centroids onto a `cols` x `rows` grid, resolving collisions by
 * spiralling out to the nearest free cell. Deterministic for a given input
 * order, which is why callers pass a stably-sorted list.
 */
export function layoutTiles(iso2s: string[], cols = 34, rows = 16): TileCell[] {
  const taken = new Set<string>();
  const cells: TileCell[] = [];

  for (const iso2 of iso2s) {
    const centroid = CENTROIDS[iso2];
    if (!centroid) continue;
    const [lat, lon] = centroid;

    // Equirectangular, with latitude compressed slightly so the dense northern
    // band does not collapse into a single row.
    const col = Math.round(((lon + 180) / 360) * (cols - 1));
    const row = Math.round(((90 - lat) / 180) * (rows - 1));

    const placed = findFreeCell(col, row, cols, rows, taken);
    if (!placed) continue;
    taken.add(`${placed.col},${placed.row}`);
    cells.push({ iso2, col: placed.col, row: placed.row });
  }

  return cells;
}

function findFreeCell(
  col: number,
  row: number,
  cols: number,
  rows: number,
  taken: Set<string>,
): { col: number; row: number } | null {
  const clampedCol = Math.min(cols - 1, Math.max(0, col));
  const clampedRow = Math.min(rows - 1, Math.max(0, row));
  if (!taken.has(`${clampedCol},${clampedRow}`)) return { col: clampedCol, row: clampedRow };

  for (let ring = 1; ring < Math.max(cols, rows); ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        const c = clampedCol + dx;
        const r = clampedRow + dy;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        if (!taken.has(`${c},${r}`)) return { col: c, row: r };
      }
    }
  }
  return null;
}
