const PIPELINE_URL = process.env.PIPELINE_API_URL;

export async function DELETE(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const target = PIPELINE_URL ? `${PIPELINE_URL}/api/watchlist/${encodeURIComponent(ticker)}` : null;
  if (!target) {
    return Response.json({ ok: false, reason: 'PIPELINE_API_URL not configured' }, { status: 503 });
  }

  const auth = req.headers.get('authorization');
  const upstream = await fetch(target, {
    method: 'DELETE',
    headers: auth ? { Authorization: auth } : {},
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
