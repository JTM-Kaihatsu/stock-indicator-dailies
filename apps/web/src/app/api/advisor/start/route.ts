import { forward } from '@/lib/proxy';

const PIPELINE_URL = process.env.PIPELINE_API_URL;

export async function POST(req: Request) {
  const target = PIPELINE_URL ? `${PIPELINE_URL}/api/advisor/start` : null;
  if (!target) {
    return Response.json({ ok: false, reason: 'PIPELINE_API_URL not configured' }, { status: 503 });
  }

  const body = await req.text();
  return forward(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}
