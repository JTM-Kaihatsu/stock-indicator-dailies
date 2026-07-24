/**
 * Human-like interaction pacing and rate limiting.
 *
 * Purpose is politeness, not evasion: spacing out actions and capping run
 * frequency keeps the agent within reasonable use of the provider and avoids
 * hammering their servers. Both are pure/injectable so they unit-test cleanly.
 */

export interface PacingOptions {
  /** Lower bound for a single inter-action delay. Default 400ms. */
  minMs?: number;
  /** Upper bound for a single inter-action delay. Default 1200ms. */
  maxMs?: number;
}

export const DEFAULT_PACING: Required<PacingOptions> = {
  minMs: 400,
  maxMs: 1200,
};

/** Read pacing bounds from the environment, falling back to defaults. */
export function pacingFromEnv(env: NodeJS.ProcessEnv = process.env): Required<PacingOptions> {
  const min = Number(env.AGENT_MIN_ACTION_DELAY_MS);
  const max = Number(env.AGENT_MAX_ACTION_DELAY_MS);
  return {
    minMs: Number.isFinite(min) && min >= 0 ? min : DEFAULT_PACING.minMs,
    maxMs: Number.isFinite(max) && max >= 0 ? max : DEFAULT_PACING.maxMs,
  };
}

/**
 * A delay in [minMs, maxMs]. `random` is injectable so tests are deterministic.
 * If the bounds are inverted they're swapped rather than throwing.
 */
export function humanDelayMs(
  options: PacingOptions = {},
  random: () => number = Math.random,
): number {
  const rawMin = options.minMs ?? DEFAULT_PACING.minMs;
  const rawMax = options.maxMs ?? DEFAULT_PACING.maxMs;
  const min = Math.min(rawMin, rawMax);
  const max = Math.max(rawMin, rawMax);
  return Math.round(min + random() * (max - min));
}

/** Await a human-like pause. `sleep` is injectable for tests. */
export async function pause(
  options: PacingOptions = {},
  deps: { random?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<number> {
  const ms = humanDelayMs(options, deps.random ?? Math.random);
  const sleep = deps.sleep ?? ((d: number) => new Promise<void>((r) => setTimeout(r, d)));
  await sleep(ms);
  return ms;
}

/**
 * Minimum-interval rate limiter. `check` reports how long the caller must wait
 * before the next run is allowed; `record` marks a run as having happened.
 * The clock is injectable, so tests never sleep.
 */
export class RateLimiter {
  readonly #minIntervalMs: number;
  readonly #now: () => number;
  #lastRunAt: number | undefined;

  constructor(minIntervalMs: number, now: () => number = Date.now) {
    this.#minIntervalMs = minIntervalMs;
    this.#now = now;
  }

  /** Milliseconds still to wait; 0 when a run is allowed right now. */
  msUntilAllowed(): number {
    if (this.#lastRunAt === undefined) return 0;
    const elapsed = this.#now() - this.#lastRunAt;
    return Math.max(0, this.#minIntervalMs - elapsed);
  }

  allowed(): boolean {
    return this.msUntilAllowed() === 0;
  }

  /** Mark a run as having just occurred. */
  record(): void {
    this.#lastRunAt = this.#now();
  }
}
