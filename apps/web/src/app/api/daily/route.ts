const PIPELINE_URL = process.env.PIPELINE_API_URL;

// The pipeline (Playwright capture + VLM analysis) routinely takes 15-30s,
// well past Vercel's default serverless timeout — without this, a slow run
// gets killed mid-flight and the client sees an HTML error page instead of
// JSON. Clamped to whatever the deployment's plan actually allows.
export const maxDuration = 60;

export async function POST(req: Request) {
  const target = PIPELINE_URL ? `${PIPELINE_URL}/api/daily` : null;
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
