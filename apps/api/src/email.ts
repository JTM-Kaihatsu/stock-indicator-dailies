/**
 * Thin wrapper over Resend's HTTP API (a single POST, no SDK needed;
 * consistent with this codebase's preference for a raw fetch over an extra
 * dependency for a one-call integration). The only caller today is
 * notifications.ts's daily digest; kept generic in case anything else here
 * ever needs to send an email.
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Extra email headers, e.g. List-Unsubscribe; mail providers weigh
   * these when deciding spam vs. inbox for recurring/digest-style mail. */
  headers?: Record<string, string>;
}

/** Sends one email. `false` (not a throw) on any failure: misconfiguration,
 * a Resend-side error, or a network blip; so a caller sweeping many users
 * can log and move on to the next one rather than losing the whole run
 * over one bad send. Logs loudly either way, the same "best-effort but
 * never silent" posture cache.ts's cacheReport established. */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn('[email] RESEND_API_KEY / NOTIFICATION_EMAIL_FROM not configured; skipping send to', message.to);
    return false;
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
      }),
    });
    if (!res.ok) {
      console.error(`[email] send to ${message.to} failed: ${res.status} ${await res.text().catch(() => '')}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[email] send to ${message.to} threw`, err);
    return false;
  }
}
