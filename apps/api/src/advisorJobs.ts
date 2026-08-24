import {
  AdvisorUpstreamError,
  AdvisorWallClockTimeoutError,
  researchAndPropose,
  type AdvisorResult,
} from '@stock-indicator-dailies/advisor';
import { isOutageError } from '@stock-indicator-dailies/shared';

import { cacheAdvice } from './advisorCache.ts';
import { createJobStore } from './jobStore.ts';

export type AdvisorJobResult =
  | { ok: true; result: AdvisorResult }
  | {
      ok: false;
      reason: string;
      /** Whether this looks like Claude being unavailable rather than a
       * one-off/programming error; drives the web UI's retry cooldown and
       * whether it points the user at Claude's status pages. */
      outage: boolean;
    };

// Same TTL/client-timeout headroom reasoning as jobs.ts; the advisor isn't
// subject to the daily pipeline's browser-session queue, but research can
// still legitimately run long (multiple web_search turns).
const store = createJobStore<AdvisorJobResult>(6 * 60 * 1000);

/** AdvisorUpstreamError already carries a friendly, status-specific message
 * as its own .message; AdvisorWallClockTimeoutError's message names an
 * internal constant that isn't itself outage-shaped, so it's classified by
 * type rather than by isOutageError's text matching. Anything else falls
 * back to structural sniffing (connection errors, timeouts, 5xx). */
function classifyOutage(err: unknown): boolean {
  return err instanceof AdvisorUpstreamError || err instanceof AdvisorWallClockTimeoutError || isOutageError(err);
}

export function startAdvisorJob(ticker: string): string {
  return store.start(
    async () => {
      const result = await researchAndPropose(ticker);
      await cacheAdvice(ticker, result);
      return { ok: true, result };
    },
    (err) => ({
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      outage: classifyOutage(err),
    }),
  );
}

export function getAdvisorJob(id: string) {
  return store.get(id);
}
