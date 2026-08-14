const PIPELINE_URL = process.env.PIPELINE_API_URL;

// Pure computation on the API side (no Playwright/VLM) — stays well within
// any gateway timeout, so no job/poll pattern needed here unlike /api/daily.
export async function POST(req: Request) {
  const target = PIPELINE_URL ? `${PIPELINE_URL}/api/backtest` : null;
  if (!target) {
    return Response.json({ ok: false, reason: 'PIPELINE_API_URL not configured' }, { status: 503 });
  }

  const body = await req.text();
  const upstream = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
