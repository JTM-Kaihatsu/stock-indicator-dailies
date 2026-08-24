/**
 * User-facing handling for a Claude / LLM-provider outage. Shared between
 * the chart-interpretation VLM path (packages/vlm) and the AI-suggestion
 * advisor path (packages/advisor), since both call the same provider and
 * both need the same "is this an outage" classification and the same
 * status-page links, even though each stage phrases its own message.
 */

/** Status pages worth surfacing as links in a richer UI. */
export const PROVIDER_STATUS_LINKS = [
  { label: 'Downdetector', url: 'https://downdetector.com/status/claude-ai/' },
  { label: 'Claude status', url: 'https://status.claude.com/' },
];

/**
 * The chart-interpretation stage's outage message. This constant is the
 * single source of that copy so the CLI, the HTML report, and the web UI
 * all say the same thing on a chart-read outage.
 */
export const OUTAGE_MESSAGE =
  "We're sorry, an error occurred in connecting with Claude as the LLM provider " +
  'for interpreting the chart, and it retried once already. It is suggested that ' +
  'you check https://downdetector.com/status/claude-ai/ and https://status.claude.com/';

/**
 * Whether an error looks like a provider outage / connectivity failure; as
 * opposed to a bad request, truncation, or unparseable output. Covers connection
 * errors, timeouts, and 5xx / overloaded (529) responses. Structural (checks
 * status / name / message) so it doesn't couple to a specific SDK error class.
 */
export function isOutageError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as { status?: unknown; name?: unknown; message?: unknown };
  if (typeof e.status === 'number' && e.status >= 500) return true; // 5xx incl. 529 overloaded
  const text = `${typeof e.name === 'string' ? e.name : ''} ${typeof e.message === 'string' ? e.message : ''}`;
  return /\b(connection|timeout|timed out|overloaded|network)\b|econnreset|enotfound|etimedout|socket hang up|fetch failed/i.test(
    text,
  );
}
