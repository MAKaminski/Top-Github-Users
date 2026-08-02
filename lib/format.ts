/** Display helpers. Every number on this site goes through one of these. */

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en-US");

/** 12_400 -> "12.4K". Used wherever space is tight. */
export function abbreviate(value: number): string {
  return compact.format(value);
}

/** 12_400 -> "12,400". Used wherever the exact figure matters. */
export function exact(value: number): string {
  return full.format(value);
}

export function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Rank as a zero-padded ordinal: 7 -> "007". */
export function rankLabel(rank: number, width = 3): string {
  return String(rank).padStart(width, "0");
}

/**
 * A stable pseudo-commit-hash for a login. Purely decorative — it is never
 * presented as a real git object, only used as a typographic device on profile
 * pages and in the preloader.
 */
export function pseudoHash(seed: string, length = 7): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let out = "";
  let x = h >>> 0;
  while (out.length < length) {
    out += (x % 16).toString(16);
    x = Math.imul(x ^ (x >>> 7), 2654435761) >>> 0;
  }
  return out.slice(0, length);
}

export function movementOf(rank: number, previousRank: number | null) {
  if (previousRank === null) return { delta: 0, direction: "none" as const };
  const delta = previousRank - rank;
  if (delta === 0) return { delta: 0, direction: "flat" as const };
  return { delta: Math.abs(delta), direction: delta > 0 ? ("up" as const) : ("down" as const) };
}

export function initials(name: string | null, login: string): string {
  const source = name?.trim() || login;
  const parts = source.split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("");
}
