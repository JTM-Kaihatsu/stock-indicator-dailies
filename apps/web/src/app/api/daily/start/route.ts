const PIPELINE_URL = process.env.PIPELINE_API_URL;

// A cache hit resolves inline (fast); a miss just kicks off a background job
// and returns immediately — neither needs an extended timeout the way the
// old single-shot blocking proxy did.
export async function POST(req: Request) {
  const target = PIPELINE_URL ? `${PIPELINE_URL}/api/daily/start` : null;
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
