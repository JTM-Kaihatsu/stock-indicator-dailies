import { Hono } from 'hono';

import { pendingCount, runPipeline } from '../pipeline.ts';

export const daily = new Hono();

daily.get('/health', (c) => c.json({ ok: true, pending: pendingCount() }));

daily.post('/daily', async (c) => {
  const body = await c.req.json<{ ticker?: string }>().catch(() => ({}) as { ticker?: string });
  const raw = body.ticker?.trim().toUpperCase();
  if (!raw || !/^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(raw)) {
    return c.json({ ok: false, reason: 'Invalid or missing ticker' }, 400);
  }

  const result = await runPipeline(raw);
  if (!result.ok) {
    const status = result.stage === 'capture' ? 502 : 500;
    return c.json(result, status);
  }
  return c.json(result);
});
