import { forward } from '@/lib/proxy';

const PIPELINE_URL = process.env.PIPELINE_API_URL;

function authHeaders(req: Request): Record<string, string> {
  const auth = req.headers.get('authorization');
  return auth ? { Authorization: auth } : {};
}

export async function PATCH(req: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker, id } = await params;
  const target = PIPELINE_URL
    ? `${PIPELINE_URL}/api/watchlist/${encodeURIComponent(ticker)}/positions/${encodeURIComponent(id)}`
    : null;
  if (!target) {
    return Response.json({ ok: false, reason: 'PIPELINE_API_URL not configured' }, { status: 503 });
  }

  const body = await req.text();
  return forward(target, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(req) },
    body,
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker, id } = await params;
  const target = PIPELINE_URL
    ? `${PIPELINE_URL}/api/watchlist/${encodeURIComponent(ticker)}/positions/${encodeURIComponent(id)}`
    : null;
  if (!target) {
    return Response.json({ ok: false, reason: 'PIPELINE_API_URL not configured' }, { status: 503 });
  }

  return forward(target, { method: 'DELETE', headers: authHeaders(req) });
}
