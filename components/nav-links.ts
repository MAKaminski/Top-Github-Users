/** Single source of truth for primary navigation.
 *
 *  Lives in its own module because the sticky nav renders the menu overlay and
 *  the menu overlay needs the same list — importing it from the nav would make
 *  the two files circular, which silently evaluates to `undefined` at module
 *  init rather than failing loudly.
 */
export const NAV_LINKS = [
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/podium", label: "Top 10" },
  { href: "/countries", label: "Countries" },
  { href: "/cities", label: "Cities" },
  { href: "/orgs", label: "Organizations" },
  { href: "/methodology", label: "Methodology" },
  { href: "/connect", label: "Connect" },
] as const;
