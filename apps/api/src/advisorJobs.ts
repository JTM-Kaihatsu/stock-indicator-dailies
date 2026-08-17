import { researchAndPropose, type AdvisorResult } from '@stock-indicator-dailies/advisor';

import { createJobStore } from './jobStore.ts';

export type AdvisorJobResult = { ok: true; result: AdvisorResult } | { ok: false; reason: string };

const store = createJobStore<AdvisorJobResult>();

export function startAdvisorJob(ticker: string): string {
  return store.start(
    async () => ({ ok: true, result: await researchAndPropose(ticker) }),
    (err) => ({ ok: false, reason: err instanceof Error ? err.message : String(err) }),
  );
}

export function getAdvisorJob(id: string) {
  return store.get(id);
}
