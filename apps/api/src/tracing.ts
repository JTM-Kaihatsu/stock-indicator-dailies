/**
 * OpenTelemetry bootstrap for local Datadog experimentation (interview
 * prep, not part of the deployed app). Not wired into the normal
 * `dev`/`start` scripts on purpose — Render gives this service no host
 * access, so there's nowhere for a Collector to run in production, and
 * pointing this at a nonexistent `localhost:4317` there would just add
 * failed-export noise to every request. Loaded only via the separate
 * `dev:otel` script, which preloads this file with `--import` before
 * `server.ts` — auto-instrumentation has to patch modules (http, undici's
 * fetch, etc.) before anything else imports them, so this must run first,
 * not from inside server.ts itself.
 *
 * Sends traces to an OTel Collector on localhost (see
 * otel-collector-config.yaml, run via `docker run` — not part of this
 * app's own Docker image), which is what actually forwards to Datadog.
 * This file never talks to Datadog directly and never sees a Datadog API
 * key; only the Collector does.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const otlpBase = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

const sdk = new NodeSDK({
  resource: defaultResource().merge(
    resourceFromAttributes({ [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'stock-indicator-dailies-api' }),
  ),
  traceExporter: new OTLPTraceExporter({ url: `${otlpBase}/v1/traces` }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
console.log(`[tracing] OpenTelemetry started, exporting traces to ${otlpBase}/v1/traces`);

// A clean shutdown flushes any spans still buffered rather than dropping
// them; matters here specifically because this is a short-lived local dev
// session (Ctrl+C), not a long-running deploy that only ever restarts.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    sdk
      .shutdown()
      .catch((err) => console.error('[tracing] error shutting down', err))
      .finally(() => process.exit(0));
  });
}
