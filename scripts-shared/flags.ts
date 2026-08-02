/** ISO 3166-1 alpha-2 to a regional-indicator flag glyph.
 *
 *  Lives outside scripts/ so both the crawler and the app can import it without
 *  the app pulling in Node-only crawler modules.
 */
export function flagOf(iso2: string | null): string {
  if (!iso2 || iso2.length !== 2) return "";
  const base = 0x1f1e6;
  return String.fromCodePoint(base + (iso2.charCodeAt(0) - 65), base + (iso2.charCodeAt(1) - 65));
}
