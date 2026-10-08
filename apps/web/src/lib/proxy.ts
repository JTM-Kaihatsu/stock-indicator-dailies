/** Shared upstream call for the Next.js proxy routes under app/api. Every
 * route used to hand `upstream.body` straight back labeled as JSON, so
 * whenever Render wasn't actually serving (a restart or redeploy, a deploy
 * swap, a crash loop), its platform's HTML 502/503 page went to the browser
 * dressed as JSON and surfaced as "Unexpected token '<', "<!DOCTYPE "... is
 * not valid JSON". This keeps the contract the client relies on: the proxy
 * always answers with JSON, and an unreachable or non-JSON upstream becomes
 * a clean 503 with a message a person can act on. */

export const SERVICE_UNAVAILABLE_MESSAGE =
  'The analysis service is temporarily unavailable (it may be restarting). Please try again in a minute.';

function unavailable(): Response {
  return Response.json(
    { ok: false, reason: 'service-unavailable', userMessage: SERVICE_UNAVAILABLE_MESSAGE },
    { status: 503 },
  );
}

export async function forward(target: string, init?: RequestInit): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return unavailable();
  }

  // A real API response is always JSON (including its own 4xx/5xx errors);
  // anything else is the hosting platform's error page, not our API.
  if (!(upstream.headers.get('content-type') ?? '').includes('application/json')) {
    return unavailable();
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
