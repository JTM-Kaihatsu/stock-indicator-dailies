const PIPELINE_URL = process.env.PIPELINE_API_URL;

function authHeaders(req: Request): Record<string, string> {
  const auth = req.headers.get('authorization');
  return auth ? { Authorization: auth } : {};
}

export async function GET(req: Request) {
  const target = PIPELINE_URL ? `${PIPELINE_URL}/api/watchlist/notifications` : null;
  if (!target) {
    return Response.json({ ok: false, reason: 'PIPELINE_API_URL not configured' }, { status: 503 });
  }

  const upstream = await fetch(target, { headers: authHeaders(req) });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function PATCH(req: Request) {
  const target = PIPELINE_URL ? `${PIPELINE_URL}/api/watchlist/notifications` : null;
  if (!target) {
    return Response.json({ ok: false, reason: 'PIPELINE_API_URL not configured' }, { status: 503 });
  }

  const body = await req.text();
  const upstream = await fetch(target, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(req) },
    body,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
