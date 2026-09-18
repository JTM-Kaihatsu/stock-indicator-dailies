const PIPELINE_URL = process.env.PIPELINE_API_URL;

export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const riskTolerance = new URL(req.url).searchParams.get('riskTolerance');
  const query = riskTolerance ? `?riskTolerance=${encodeURIComponent(riskTolerance)}` : '';
  const target = PIPELINE_URL ? `${PIPELINE_URL}/api/advisor/cached/${encodeURIComponent(ticker)}${query}` : null;
  if (!target) {
    return Response.json({ ok: false, reason: 'PIPELINE_API_URL not configured' }, { status: 503 });
  }

  const upstream = await fetch(target);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
