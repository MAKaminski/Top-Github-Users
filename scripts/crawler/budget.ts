/**
 * Rate-limit budget arithmetic, done *before* a crawl starts.
 *
 * The failure this prevents is specific: a run that looks fine for two hours,
 * exhausts the hourly points, and leaves a half-written snapshot behind. The
 * whole cost of a hydration pass is knowable up front — candidates, batch size,
 * measured points per query — so it is computed and checked first, and a plan
 * that cannot finish inside a day is refused rather than started.
 *
 * `observedCostPerQuery` is the one input that must not be guessed silently.
 * Until a real `rateLimit.cost` has come back from the API the estimate is
 * labelled as assumed, because a query that turns out to cost 4 points instead
 * of 1 turns a 6-hour plan into a 24-hour one.
 */

/** GitHub's GraphQL budget: 5000 points per hour on a personal token. */
export const POINTS_PER_HOUR = 5000;

/** Anything longer than a day is not a crawl, it is an outage. */
export const MAX_ESTIMATED_HOURS = 24;

export interface BudgetEstimate {
  usersToHydrate: number;
  batchSize: number;
  queriesRequired: number;
  observedCostPerQuery: number;
  pointsRequired: number;
  pointsAvailablePerHour: number;
  estimatedHours: number;
}

export interface BudgetInput {
  usersToHydrate: number;
  batchSize: number;
  /** Defaults to 1 — an assumption, not a measurement. See {@link formatBudget}. */
  observedCostPerQuery?: number;
  pointsPerHour?: number;
}

export function estimateBudget(input: BudgetInput): BudgetEstimate {
  const usersToHydrate = Math.max(0, Math.floor(input.usersToHydrate));
  const batchSize = Math.floor(input.batchSize);
  if (!Number.isFinite(batchSize) || batchSize < 1) {
    throw new Error(`batchSize must be at least 1, got ${input.batchSize}`);
  }

  const observedCostPerQuery = input.observedCostPerQuery ?? 1;
  const pointsAvailablePerHour = input.pointsPerHour ?? POINTS_PER_HOUR;
  if (pointsAvailablePerHour <= 0) {
    throw new Error(`pointsPerHour must be positive, got ${pointsAvailablePerHour}`);
  }

  // Ceiling, not rounding: the remainder still costs a whole query.
  const queriesRequired = Math.ceil(usersToHydrate / batchSize);
  const pointsRequired = queriesRequired * observedCostPerQuery;

  return {
    usersToHydrate,
    batchSize,
    queriesRequired,
    observedCostPerQuery,
    pointsRequired,
    pointsAvailablePerHour,
    estimatedHours: pointsRequired / pointsAvailablePerHour,
  };
}

/**
 * The fixed block the rules require in the run log. Its shape is load-bearing:
 * every line is greppable across runs, so a cost that drifted between crawls is
 * visible by diffing two logs rather than by re-deriving the arithmetic.
 */
export function formatBudget(estimate: BudgetEstimate, opts: { measured?: boolean } = {}): string {
  const note = opts.measured ? "measured, from rateLimit.cost" : "assumed — not yet measured";
  return [
    row("users to hydrate:", String(estimate.usersToHydrate)),
    row("batch size:", String(estimate.batchSize)),
    row("queries required:", String(estimate.queriesRequired)),
    row("observed cost per query:", `${trim(estimate.observedCostPerQuery)}   (${note})`),
    row("points required:", String(estimate.pointsRequired)),
    row("points available:", `${estimate.pointsAvailablePerHour} / hr`),
    row("estimated wall clock:", `${trim(estimate.estimatedHours)} hrs`),
  ].join("\n");
}

/**
 * Refuses a plan that cannot finish inside `maxHours`.
 *
 * Throwing here — before anything is fetched or written — is deliberate. A
 * budget this large is a symptom of too loose a candidate filter, and the only
 * fix that works is hydrating fewer users; running longer just spreads the same
 * overspend across more hours and more half-written snapshots.
 */
export function assertWithinBudget(estimate: BudgetEstimate, maxHours = MAX_ESTIMATED_HOURS): void {
  if (estimate.estimatedHours <= maxHours) return;
  throw new Error(
    `Budget refused: ${trim(estimate.estimatedHours)} hrs estimated, ceiling is ${maxHours} hrs ` +
      `(${estimate.usersToHydrate} users / batch ${estimate.batchSize} = ` +
      `${estimate.queriesRequired} queries at ${trim(estimate.observedCostPerQuery)} points, ` +
      `${estimate.pointsRequired} points against ${estimate.pointsAvailablePerHour}/hr). ` +
      "The fix is to tighten the candidate filter so fewer users are hydrated — not to run " +
      "longer. Nothing has been collected or written.",
  );
}

export interface BatchRecord {
  index: number;
  cost: number;
  remaining: number;
  elapsedMs: number;
  errors: number;
}

/**
 * One line per batch, which is the smallest unit at which a run can be seen
 * going wrong. `cost` and `remaining` together are what catch the failure the
 * pre-flight estimate cannot: a query whose real cost climbs partway through
 * because the selection got heavier.
 */
export class BatchLog {
  private readonly log: (msg: string) => void;
  private readonly entries: BatchRecord[] = [];

  constructor(options: { log?: (msg: string) => void } = {}) {
    this.log = options.log ?? (() => {});
  }

  record(entry: BatchRecord): string {
    this.entries.push(entry);
    const line =
      `batch ${entry.index}  cost=${entry.cost}  remaining=${entry.remaining}  ` +
      `${(entry.elapsedMs / 1000).toFixed(2)}s  errors=${entry.errors}`;
    this.log(line);
    return line;
  }

  summary(): string {
    if (this.entries.length === 0) return "no batches";
    const cost = this.entries.reduce((sum, entry) => sum + entry.cost, 0);
    const errors = this.entries.reduce((sum, entry) => sum + entry.errors, 0);
    const elapsedMs = this.entries.reduce((sum, entry) => sum + entry.elapsedMs, 0);
    const remaining = this.entries[this.entries.length - 1].remaining;
    return (
      `${this.entries.length} batches  cost=${cost}  remaining=${remaining}  ` +
      `${(elapsedMs / 1000).toFixed(2)}s  errors=${errors}  ` +
      `avg cost=${trim(cost / this.entries.length)}`
    );
  }

  get count(): number {
    return this.entries.length;
  }
}

/** Labels are padded to a fixed column so the block stays scannable when the
 *  numbers change width between runs. */
function row(label: string, value: string): string {
  return `${label.padEnd(24, " ")} ${value}`;
}

/** Two decimals at most, and no trailing zeros — `1 hrs` and `1.25 hrs` both
 *  read as numbers, `1.00 hrs` reads as a template nobody filled in. */
function trim(value: number): string {
  return String(Number(value.toFixed(2)));
}
