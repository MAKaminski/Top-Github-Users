/**
 * Contribution-calendar helpers.
 *
 * The scheduled crawler stores a real 371-day calendar per user. Until it has
 * run, we derive a *deterministic estimate* from the user's real contribution
 * total so the heatmaps have shape. Anything derived this way is tagged
 * `estimated`, labelled in the UI, and explained on /methodology — the site
 * never presents an estimate as a measurement.
 */

export const CALENDAR_WEEKS = 53;
export const CALENDAR_DAYS = CALENDAR_WEEKS * 7;

/** xmur3 + mulberry32: a small, fast, fully deterministic PRNG. */
function seedFrom(text: string): () => number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Spread `total` contributions across 371 days with the shape real calendars
 * have: weekday-heavy, bursty, with quiet stretches. Same login and total
 * always produce the same calendar.
 */
export function estimateCalendar(login: string, total: number): number[] {
  const rand = seedFrom(login);
  const days = new Array<number>(CALENDAR_DAYS).fill(0);
  if (total <= 0) return days;

  // A per-user activity profile: how consistent they are, and where their
  // busy stretches fall.
  const consistency = 0.35 + rand() * 0.55;
  const burstPhase = rand() * Math.PI * 2;
  const burstRate = 1.5 + rand() * 3;

  const weights = new Array<number>(CALENDAR_DAYS);
  let sum = 0;

  for (let i = 0; i < CALENDAR_DAYS; i++) {
    const weekday = i % 7;
    // Saturday/Sunday are quieter but never empty.
    const weekendDamp = weekday === 0 || weekday === 6 ? 0.35 : 1;
    // Slow seasonal swell across the year.
    const season = 0.6 + 0.4 * Math.sin((i / CALENDAR_DAYS) * Math.PI * burstRate + burstPhase);
    // Per-day noise, plus a chance of a completely idle day.
    const idle = rand() > consistency ? 0 : 1;
    const noise = 0.25 + rand() * 1.5;

    const w = weekendDamp * season * noise * idle;
    weights[i] = w;
    sum += w;
  }

  if (sum === 0) return days;

  let assigned = 0;
  for (let i = 0; i < CALENDAR_DAYS; i++) {
    const share = Math.floor((weights[i] / sum) * total);
    days[i] = share;
    assigned += share;
  }

  // Hand the rounding remainder to the busiest days so the total is exact.
  const order = days.map((_, i) => i).sort((a, b) => weights[b] - weights[a]);
  let remainder = total - assigned;
  for (let i = 0; remainder > 0; i = (i + 1) % order.length) {
    days[order[i]] += 1;
    remainder--;
  }

  return days;
}

export function calendarFor(
  login: string,
  total: number,
  stored: number[] | null,
): { days: number[]; estimated: boolean } {
  if (stored && stored.length === CALENDAR_DAYS) return { days: stored, estimated: false };
  return { days: estimateCalendar(login, total), estimated: true };
}

/** Five-step level for the contribution ramp, matching GitHub's own buckets. */
export function levelFor(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (max <= 0) return 0;
  const ratio = count / max;
  if (ratio > 0.6) return 4;
  if (ratio > 0.35) return 3;
  if (ratio > 0.15) return 2;
  return 1;
}

export function streaksFrom(days: number[]): { current: number; longest: number } {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    if (d > 0) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }

  let current = 0;
  for (let i = days.length - 1; i >= 0 && days[i] > 0; i--) current++;

  return { current, longest };
}

/** Aggregate the calendar into 12 trailing monthly buckets for sparklines. */
export function monthlyFrom(days: number[], buckets = 12): number[] {
  const out = new Array<number>(buckets).fill(0);
  const size = days.length / buckets;
  for (let i = 0; i < days.length; i++) {
    const b = Math.min(buckets - 1, Math.floor(i / size));
    out[b] += days[i];
  }
  return out;
}
