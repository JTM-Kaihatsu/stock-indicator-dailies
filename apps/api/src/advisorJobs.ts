import { researchAndPropose, type AdvisorResult } from '@stock-indicator-dailies/advisor';

import { cacheAdvice } from './advisorCache.ts';
import { createJobStore } from './jobStore.ts';

export type AdvisorJobResult = { ok: true; result: AdvisorResult } | { ok: false; reason: string };

// Same TTL/client-timeout headroom reasoning as jobs.ts; the advisor isn't
// subject to the daily pipeline's browser-session queue, but research can
// still legitimately run long (multiple web_search turns).
const store = createJobStore<AdvisorJobResult>(6 * 60 * 1000);

export function startAdvisorJob(ticker: string): string {
  return store.start(
    async () => {
      const result = await researchAndPropose(ticker);
      await cacheAdvice(ticker, result);
      return { ok: true, result };
    },
    (err) => ({ ok: false, reason: err instanceof Error ? err.message : String(err) }),
  );
}

export function getAdvisorJob(id: string) {
  return store.get(id);
}
