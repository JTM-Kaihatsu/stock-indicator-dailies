const PIPELINE_URL = process.env.PIPELINE_API_URL;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const target = PIPELINE_URL ? `${PIPELINE_URL}/api/advisor/jobs/${id}` : null;
  if (!target) {
    return Response.json({ status: 'not-found', reason: 'PIPELINE_API_URL not configured' }, { status: 503 });
  }

  const upstream = await fetch(target);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
