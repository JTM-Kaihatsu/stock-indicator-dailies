'use client';

import { useEffect, useState } from 'react';
import { AdvisorRequestError, fetchCachedAdvice, requestAiSuggestion } from '@/lib/advisorApi';
import { FIELD_LABELS, diffSettings, fromProposedSettings, type IndicatorSettings } from '@/lib/settings';
import type { AdvisorProposal } from '@/types/advisor';

/** Cooldown after a failed request, so a user (or an outage) can't hammer
 * Claude with immediate retries. Longer when the failure looks like Claude
 * itself being unavailable; there's no point retrying instantly into that. */
const OUTAGE_COOLDOWN_MS = 20_000;
const DEFAULT_COOLDOWN_MS = 8_000;

const STATUS_LINKS = [
  { label: 'Downdetector', url: 'https://downdetector.com/status/claude-ai/' },
  { label: 'Claude status', url: 'https://status.claude.com/' },
];

export interface AcceptResult {
  ok: boolean;
  reason?: string;
}

export function AiSuggestionPanel({
  ticker,
  settings,
  onAccept,
}: {
  ticker: string;
  settings: IndicatorSettings;
  onAccept: (settings: IndicatorSettings) => Promise<AcceptResult>;
}) {
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<AdvisorProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorIsOutage, setErrorIsOutage] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  // Seed from any prior cached suggestion on mount, so an already-run
  // suggestion (rationale + proposed settings) shows by default without
  // requiring another click, on both the main page and a watchlisted
  // ticker's page (the cache is global/ticker-keyed, not per-user).
  useEffect(() => {
    let cancelled = false;
    void fetchCachedAdvice(ticker).then((cached) => {
      if (!cancelled && cached) setProposal(cached);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownRemaining(remaining);
      if (remaining === 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  async function request() {
    setLoading(true);
    setError(null);
    setErrorIsOutage(false);
    setProposal(null);
    setAcceptError(null);
    try {
      setProposal(await requestAiSuggestion(ticker));
    } catch (err) {
      const outage = err instanceof AdvisorRequestError && err.outage;
      setError(err instanceof Error ? err.message : 'Network error');
      setErrorIsOutage(outage);
      setCooldownUntil(Date.now() + (outage ? OUTAGE_COOLDOWN_MS : DEFAULT_COOLDOWN_MS));
    } finally {
      setLoading(false);
    }
  }

  async function accept() {
    if (!proposal) return;
    // Fills the fields and auto-runs in one click; the user already saw
    // the proposed diff, so a second manual "Run" click would just be
    // redundant confirmation. Rationale and diff stay visible, nothing
    // collapses, whether this succeeds or not.
    setAccepting(true);
    setAcceptError(null);
    const result = await onAccept(fromProposedSettings(proposal.settings));
    setAccepting(false);
    if (!result.ok) {
      setAcceptError(result.reason ?? 'Could not run Historical Testing with these settings.');
    }
  }

  const proposedSettings = proposal ? fromProposedSettings(proposal.settings) : null;
  const changedFields = proposedSettings ? diffSettings(settings, proposedSettings) : [];
  const onCooldown = cooldownRemaining > 0;

  return (
    <section className="advisor-panel">
      <div className="section-label">AI suggestion</div>
      <button type="button" className="analyze-btn" onClick={request} disabled={loading || onCooldown}>
        {loading ? `Researching ${ticker}…` : onCooldown ? `Retry in ${cooldownRemaining}s` : 'Get AI Suggestion'}
      </button>

      {error && (
        <div className="error-card" style={{ marginTop: 12 }}>
          <h3>Suggestion failed</h3>
          <p>{error}</p>
          {errorIsOutage && (
            <p style={{ marginTop: 6 }}>
              This looks like Claude may be having trouble right now. Check{' '}
              {STATUS_LINKS.map((link, i) => (
                <span key={link.url}>
                  {i > 0 ? ' or ' : ''}
                  <a href={link.url} target="_blank" rel="noreferrer">{link.label}</a>
                </span>
              ))}
              {' '}before retrying.
            </p>
          )}
        </div>
      )}

      {proposal && (
        <div style={{ marginTop: 12 }}>
          <div className="advisor-rationale">{proposal.rationale}</div>
          {/* Proposed settings always render here as plain values, never
           * collapsing into a "matches" message once applied — the numbers
           * are exactly what's useful to see right after accepting. */}
          <div className="compare-card" style={{ marginTop: 0 }}>
            {(Object.keys(FIELD_LABELS) as Array<keyof IndicatorSettings>).map((key) => (
              <div className="compare-row" key={key}>
                <span className="compare-label">{FIELD_LABELS[key]}</span>
                <span className="compare-values">{proposedSettings![key] ?? 'off'}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            {changedFields.length > 0 ? (
              <button type="button" className="analyze-btn" onClick={accept} disabled={accepting}>
                {accepting ? 'Running…' : 'Run Testing on AI Suggestions'}
              </button>
            ) : (
              <span className="badge settings-badge-active">✓ Currently applied</span>
            )}
          </div>
          {acceptError && (
            <div className="error-card" style={{ marginTop: 12 }}>
              <h3>Couldn&apos;t apply this suggestion</h3>
              <p>{acceptError}</p>
              <p style={{ marginTop: 6 }}>The rationale and proposed settings above are still valid; you can try again.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
