import type { CountryDef } from "./countries.ts";

/**
 * City extraction from GitHub's free-text location field.
 *
 * There is no structured city on a GitHub profile — every site in this space
 * parses the same free-text string, and every one of them gets some of it
 * wrong. We keep the rules conservative and drop anything ambiguous rather than
 * filing a developer under a city they never named. The limitation is stated
 * on /methodology.
 */

/** Strings that are a country, region or joke rather than a city. */
const NON_CITY = new Set([
  "earth",
  "world",
  "worldwide",
  "internet",
  "remote",
  "everywhere",
  "somewhere",
  "the internet",
  "planet earth",
  "localhost",
  "127.0.0.1",
  "/dev/null",
  "home",
  "space",
  "moon",
  "mars",
  "usa",
  "us",
  "uk",
  "eu",
  "europe",
  "asia",
  "africa",
  "america",
  "north america",
  "south america",
]);

/** US state codes and similar trailing tokens that are not the city. */
const TRAILING_NOISE =
  /^(usa|u\.s\.a|us|united states|uk|u\.k|england|scotland|wales|deutschland|brasil|россия|中国|日本)$/i;

export interface ParsedCity {
  id: string;
  name: string;
}

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseCity(location: string | null, country: CountryDef): ParsedCity | null {
  if (!location) return null;

  const parts = location
    .split(/[,/|·•]/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return null;

  // The city is conventionally the first segment. If the string is a single
  // segment that just names the country, there is no city to extract.
  let candidate = parts[0];

  const lower = candidate.toLowerCase();
  if (NON_CITY.has(lower)) return null;
  if (TRAILING_NOISE.test(candidate)) return null;
  if (lower === country.name.toLowerCase()) return null;
  if (lower === country.iso2.toLowerCase()) return null;

  // Drop decoration: emoji, flags, parentheticals, leading articles.
  candidate = candidate
    .replace(/\([^)]*\)/g, "")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}️]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  if (candidate.length < 2 || candidate.length > 40) return null;
  // Reject anything that is mostly punctuation or digits.
  if (!/\p{L}/u.test(candidate)) return null;
  if (/^\d/.test(candidate)) return null;

  const slug = slugify(candidate);
  if (!slug || slug.length < 2) return null;

  return { id: `${country.iso2.toLowerCase()}-${slug}`, name: titleCase(candidate) };
}

function titleCase(value: string): string {
  return value.replace(
    /\p{L}[\p{L}\p{M}'’-]*/gu,
    (word) => word.charAt(0).toLocaleUpperCase() + word.slice(1),
  );
}
