/**
 * How long a manually-refreshed watchlisted ticker stays un-refreshable
 * for. A product rule about how often a person should be hand-triggering a
 * *daily* read, deliberately separate from the pipeline's own 30s in-memory
 * anti-hammer guard (`canAttempt`): this one is an hour and is derived from
 * persistent state, so it survives a deploy/restart and is consistent
 * across a user's devices.
 */
export const REFRESH_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * When a manual refresh becomes available again, as an ISO string, or
 * `null` when it's available right now (including when nothing has ever
 * been attempted for this ticker).
 *
 * "Last attempt" is the later of the last successful capture
 * (`chart_cache.retrieved_at`) and the last logged failure
 * (`capture_failures.occurred_at`) — a failed refresh still costs a real
 * capture, so it starts the cooldown too.
 */
export function computeRefreshAvailableAt(
  lastSuccessAt: string | null,
  lastFailureAt: string | null,
  now: number = Date.now(),
  cooldownMs: number = REFRESH_COOLDOWN_MS,
): string | null {
  const attempts = [lastSuccessAt, lastFailureAt]
    .filter((t): t is string => t !== null && t !== undefined)
    .map((t) => new Date(t).getTime())
    .filter((t) => Number.isFinite(t));
  if (attempts.length === 0) return null;

  const availableAt = Math.max(...attempts) + cooldownMs;
  return availableAt > now ? new Date(availableAt).toISOString() : null;
}
