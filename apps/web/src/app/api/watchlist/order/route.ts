const PIPELINE_URL = process.env.PIPELINE_API_URL;

export async function PATCH(req: Request) {
  const target = PIPELINE_URL ? `${PIPELINE_URL}/api/watchlist/order` : null;
  if (!target) {
    return Response.json({ ok: false, reason: 'PIPELINE_API_URL not configured' }, { status: 503 });
  }

  const auth = req.headers.get('authorization');
  const body = await req.text();
  const upstream = await fetch(target, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
