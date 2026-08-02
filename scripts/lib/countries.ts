/**
 * Country registry.
 *
 * `slug` is the identifier used by the crawler and by the bootstrap source.
 * `iso2` drives the choropleth and the flag glyphs. Countries whose data cannot
 * be fetched are skipped rather than failing the run, so this list can stay
 * ambitious.
 */

export interface CountryDef {
  slug: string;
  name: string;
  iso2: string;
  region: string;
}

export const COUNTRIES: CountryDef[] = [
  { slug: "united_states", name: "United States", iso2: "US", region: "Americas" },
  { slug: "india", name: "India", iso2: "IN", region: "Asia" },
  { slug: "china", name: "China", iso2: "CN", region: "Asia" },
  { slug: "brazil", name: "Brazil", iso2: "BR", region: "Americas" },
  { slug: "united_kingdom", name: "United Kingdom", iso2: "GB", region: "Europe" },
  { slug: "germany", name: "Germany", iso2: "DE", region: "Europe" },
  { slug: "canada", name: "Canada", iso2: "CA", region: "Americas" },
  { slug: "france", name: "France", iso2: "FR", region: "Europe" },
  { slug: "japan", name: "Japan", iso2: "JP", region: "Asia" },
  { slug: "russia", name: "Russia", iso2: "RU", region: "Europe" },
  { slug: "australia", name: "Australia", iso2: "AU", region: "Oceania" },
  { slug: "netherlands", name: "Netherlands", iso2: "NL", region: "Europe" },
  { slug: "spain", name: "Spain", iso2: "ES", region: "Europe" },
  { slug: "italy", name: "Italy", iso2: "IT", region: "Europe" },
  { slug: "poland", name: "Poland", iso2: "PL", region: "Europe" },
  { slug: "sweden", name: "Sweden", iso2: "SE", region: "Europe" },
  { slug: "switzerland", name: "Switzerland", iso2: "CH", region: "Europe" },
  { slug: "ukraine", name: "Ukraine", iso2: "UA", region: "Europe" },
  { slug: "indonesia", name: "Indonesia", iso2: "ID", region: "Asia" },
  { slug: "south_korea", name: "South Korea", iso2: "KR", region: "Asia" },
  { slug: "turkey", name: "Turkey", iso2: "TR", region: "Asia" },
  { slug: "mexico", name: "Mexico", iso2: "MX", region: "Americas" },
  { slug: "argentina", name: "Argentina", iso2: "AR", region: "Americas" },
  { slug: "israel", name: "Israel", iso2: "IL", region: "Asia" },
  { slug: "singapore", name: "Singapore", iso2: "SG", region: "Asia" },
  { slug: "norway", name: "Norway", iso2: "NO", region: "Europe" },
  { slug: "denmark", name: "Denmark", iso2: "DK", region: "Europe" },
  { slug: "finland", name: "Finland", iso2: "FI", region: "Europe" },
  { slug: "austria", name: "Austria", iso2: "AT", region: "Europe" },
  { slug: "belgium", name: "Belgium", iso2: "BE", region: "Europe" },
  { slug: "portugal", name: "Portugal", iso2: "PT", region: "Europe" },
  { slug: "czech_republic", name: "Czech Republic", iso2: "CZ", region: "Europe" },
  { slug: "ireland", name: "Ireland", iso2: "IE", region: "Europe" },
  { slug: "new_zealand", name: "New Zealand", iso2: "NZ", region: "Oceania" },
  { slug: "greece", name: "Greece", iso2: "GR", region: "Europe" },
  { slug: "romania", name: "Romania", iso2: "RO", region: "Europe" },
  { slug: "hungary", name: "Hungary", iso2: "HU", region: "Europe" },
  { slug: "vietnam", name: "Vietnam", iso2: "VN", region: "Asia" },
  { slug: "taiwan", name: "Taiwan", iso2: "TW", region: "Asia" },
  { slug: "hong_kong", name: "Hong Kong", iso2: "HK", region: "Asia" },
  { slug: "thailand", name: "Thailand", iso2: "TH", region: "Asia" },
  { slug: "philippines", name: "Philippines", iso2: "PH", region: "Asia" },
  { slug: "malaysia", name: "Malaysia", iso2: "MY", region: "Asia" },
  { slug: "pakistan", name: "Pakistan", iso2: "PK", region: "Asia" },
  { slug: "bangladesh", name: "Bangladesh", iso2: "BD", region: "Asia" },
  { slug: "nigeria", name: "Nigeria", iso2: "NG", region: "Africa" },
  { slug: "kenya", name: "Kenya", iso2: "KE", region: "Africa" },
  { slug: "south_africa", name: "South Africa", iso2: "ZA", region: "Africa" },
  { slug: "egypt", name: "Egypt", iso2: "EG", region: "Africa" },
  { slug: "iran", name: "Iran", iso2: "IR", region: "Asia" },
  { slug: "chile", name: "Chile", iso2: "CL", region: "Americas" },
  { slug: "colombia", name: "Colombia", iso2: "CO", region: "Americas" },
  { slug: "peru", name: "Peru", iso2: "PE", region: "Americas" },
  { slug: "iceland", name: "Iceland", iso2: "IS", region: "Europe" },
  { slug: "estonia", name: "Estonia", iso2: "EE", region: "Europe" },
  { slug: "lithuania", name: "Lithuania", iso2: "LT", region: "Europe" },
  { slug: "latvia", name: "Latvia", iso2: "LV", region: "Europe" },
  { slug: "slovakia", name: "Slovakia", iso2: "SK", region: "Europe" },
  { slug: "slovenia", name: "Slovenia", iso2: "SI", region: "Europe" },
  { slug: "croatia", name: "Croatia", iso2: "HR", region: "Europe" },
  { slug: "serbia", name: "Serbia", iso2: "RS", region: "Europe" },
  { slug: "bulgaria", name: "Bulgaria", iso2: "BG", region: "Europe" },
  { slug: "belarus", name: "Belarus", iso2: "BY", region: "Europe" },
  { slug: "kazakhstan", name: "Kazakhstan", iso2: "KZ", region: "Asia" },
  { slug: "nepal", name: "Nepal", iso2: "NP", region: "Asia" },
  { slug: "sri_lanka", name: "Sri Lanka", iso2: "LK", region: "Asia" },
  { slug: "uruguay", name: "Uruguay", iso2: "UY", region: "Americas" },
  { slug: "ecuador", name: "Ecuador", iso2: "EC", region: "Americas" },
  { slug: "venezuela", name: "Venezuela", iso2: "VE", region: "Americas" },
  { slug: "morocco", name: "Morocco", iso2: "MA", region: "Africa" },
  { slug: "tunisia", name: "Tunisia", iso2: "TN", region: "Africa" },
  { slug: "ghana", name: "Ghana", iso2: "GH", region: "Africa" },
  { slug: "ethiopia", name: "Ethiopia", iso2: "ET", region: "Africa" },
  { slug: "uganda", name: "Uganda", iso2: "UG", region: "Africa" },
  { slug: "luxembourg", name: "Luxembourg", iso2: "LU", region: "Europe" },
  { slug: "cyprus", name: "Cyprus", iso2: "CY", region: "Europe" },
  { slug: "georgia", name: "Georgia", iso2: "GE", region: "Asia" },
  { slug: "armenia", name: "Armenia", iso2: "AM", region: "Asia" },
  { slug: "azerbaijan", name: "Azerbaijan", iso2: "AZ", region: "Asia" },
  { slug: "uzbekistan", name: "Uzbekistan", iso2: "UZ", region: "Asia" },
  { slug: "saudi_arabia", name: "Saudi Arabia", iso2: "SA", region: "Asia" },
  { slug: "united_arab_emirates", name: "United Arab Emirates", iso2: "AE", region: "Asia" },
  { slug: "jordan", name: "Jordan", iso2: "JO", region: "Asia" },
  { slug: "lebanon", name: "Lebanon", iso2: "LB", region: "Asia" },
  { slug: "moldova", name: "Moldova", iso2: "MD", region: "Europe" },
  { slug: "albania", name: "Albania", iso2: "AL", region: "Europe" },
  { slug: "bolivia", name: "Bolivia", iso2: "BO", region: "Americas" },
  { slug: "costa_rica", name: "Costa Rica", iso2: "CR", region: "Americas" },
  { slug: "guatemala", name: "Guatemala", iso2: "GT", region: "Americas" },
  { slug: "dominican_republic", name: "Dominican Republic", iso2: "DO", region: "Americas" },
];

export const COUNTRY_BY_SLUG = new Map(COUNTRIES.map((c) => [c.slug, c]));

/** ISO 3166-1 alpha-2 to a regional-indicator flag. */
export function flagOf(iso2: string | null): string {
  if (!iso2 || iso2.length !== 2) return "";
  const base = 0x1f1e6;
  return String.fromCodePoint(
    base + (iso2.charCodeAt(0) - 65),
    base + (iso2.charCodeAt(1) - 65),
  );
}
