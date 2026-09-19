'use client';

import { useEffect, useState } from 'react';
import type { RiskTolerance } from '@stock-indicator-dailies/shared';
import { AdvisorRequestError, fetchCachedAdvice, requestAiSuggestion } from '@/lib/advisorApi';
import { loadLastRiskTolerance, saveLastRiskTolerance } from '@/lib/aiPanelPrefs';
import { CitationButton } from '@/components/CitationButton';
import {
  FIELD_LABELS,
  RISK_TOLERANCE_OPTIONS,
  diffSettings,
  fromProposedSettings,
  riskToleranceLabel,
  type DiffableSettingsKey,
  type IndicatorSettings,
  type LiveSettings,
} from '@/lib/settings';
import type { AdvisorProposal, EarningsLikelihood, FitVerdict } from '@/types/advisor';

/** Cooldown after a failed request, so a user (or an outage) can't hammer
 * Claude with immediate retries. Longer when the failure looks like Claude
 * itself being unavailable; there's no point retrying instantly into that. */
const OUTAGE_COOLDOWN_MS = 20_000;
const DEFAULT_COOLDOWN_MS = 8_000;

const STATUS_LINKS = [
  { label: 'Downdetector', url: 'https://downdetector.com/status/claude-ai/' },
  { label: 'Claude status', url: 'https://status.claude.com/' },
];

/** The exact three verdict labels and colors requested: whether the stock
 * itself suits the risk tolerance it was scored against, independent of
 * how the settings were tuned. Reuses the existing buy/hold/sell color
 * tokens rather than inventing new ones. */
const FIT_STYLES: Record<FitVerdict, { label: string; bg: string; fg: string }> = {
  'not-recommended': { label: 'Not recommended given risk-tolerance level', bg: 'var(--sell-bg)', fg: 'var(--sell)' },
  caution: { label: 'Proceed with extra caution', bg: 'var(--hold-bg)', fg: 'var(--hold)' },
  'within-bounds': { label: 'Within risk-tolerance bounds', bg: 'var(--buy-bg)', fg: 'var(--buy)' },
};

/** Reuses the same buy/hold/sell color tokens as FIT_STYLES: a low chance
 * of meeting analyst expectations reads as a caution (red), high as
 * favorable (green). */
const EARNINGS_LIKELIHOOD_STYLES: Record<EarningsLikelihood, { label: string; bg: string; fg: string }> = {
  low: { label: 'Low likelihood of meeting expectations', bg: 'var(--sell-bg)', fg: 'var(--sell)' },
  moderate: { label: 'Moderate likelihood of meeting expectations', bg: 'var(--hold-bg)', fg: 'var(--hold)' },
  high: { label: 'High likelihood of meeting expectations', bg: 'var(--buy-bg)', fg: 'var(--buy)' },
};

export interface AcceptResult {
  ok: boolean;
  reason?: string;
}

export function AiSuggestionPanel({
  ticker,
  settings,
  onApplyAsIndicatorSettings,
  onAccept,
}: {
  ticker: string;
  /** The report's current baseline: live Indicator Settings merged with the
   * default backtest-only filters. Drives both this panel's "already
   * matches" badges and the settings-compare table below. */
  settings: IndicatorSettings;
  /** Applies the proposal's 3 live-sensitivity fields as the actual
   * Indicator Settings (same effect as the Indicator Settings panel's own
   * Apply button); preserves whichever risk tolerance is already set there. */
  onApplyAsIndicatorSettings: (settings: LiveSettings) => void;
  /** Runs the proposal's full settings (including backtest-only fields) as
   * a Historical Testing scenario. */
  onAccept: (settings: IndicatorSettings) => Promise<AcceptResult>;
}) {
  // Defaults to the last tolerance the user picked here for this ticker
  // (remembered across visits, even a closed-and-reopened tab; see
  // aiPanelPrefs.ts), falling back to the ticker's own saved Indicator
  // Settings preference. Changeable per-request without persisting it as
  // the ticker's actual settings; only the Indicator Settings panel itself
  // changes that.
  const [riskTolerance, setRiskTolerance] = useState<RiskTolerance>(
    loadLastRiskTolerance(ticker) ?? settings.riskTolerance ?? 'neutral',
  );
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<AdvisorProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorIsOutage, setErrorIsOutage] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  // A different ticker means a different remembered preference to default
  // the selector back to (not carrying forward whatever was picked for the
  // previous ticker).
  useEffect(() => {
    setRiskTolerance(loadLastRiskTolerance(ticker) ?? settings.riskTolerance ?? 'neutral');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  function selectRiskTolerance(value: RiskTolerance) {
    setRiskTolerance(value);
    saveLastRiskTolerance(ticker, value);
  }

  // Seed from any prior cached suggestion for this exact (ticker, risk
  // tolerance) pair, so an already-run suggestion (rationale + proposed
  // settings + fit) shows by default without requiring another click, on
  // both the main page and a watchlisted ticker's page (the cache is
  // global/ticker-keyed, not per-user); and re-seeds when the selector
  // itself changes, so switching tolerances shows whatever's already
  // cached for each one instead of going blank.
  useEffect(() => {
    let cancelled = false;
    setProposal(null);
    void fetchCachedAdvice(ticker, riskTolerance).then((cached) => {
      if (!cancelled && cached) setProposal(cached);
    });
    return () => {
      cancelled = true;
    };
  }, [ticker, riskTolerance]);

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
      setProposal(await requestAiSuggestion(ticker, riskTolerance));
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
    // collapses, whether this succeeds or not. Tags the scenario with the
    // risk tolerance it was actually generated for, so Historical Testing's
    // own read-only provenance line (see SettingsFields) is correct right
    // after accepting, and so "Apply to stock watchlist settings" persists
    // the right tag too.
    setAccepting(true);
    setAcceptError(null);
    const result = await onAccept({ ...fromProposedSettings(proposal.settings), riskTolerance });
    setAccepting(false);
    if (!result.ok) {
      setAcceptError(result.reason ?? 'Could not run Historical Testing with these settings.');
    }
  }

  /** Applies the 3 live-sensitivity fields, ATR/ADX, and the risk tolerance
   * this suggestion was actually generated for (NOT whatever the current
   * Indicator Settings' tolerance happens to be) as the actual Indicator
   * Settings: applying settings tuned for risk-seeking should also mark
   * the ticker risk-seeking, not silently leave the old tolerance in place
   * alongside numbers tuned for a different one. Synchronous from this
   * component's perspective, same as the Indicator Settings panel's own
   * Apply button; any persistence failure surfaces at the page level. */
  function applyAsIndicatorSettings() {
    if (!proposal) return;
    const full = fromProposedSettings(proposal.settings);
    onApplyAsIndicatorSettings({
      buyConsensus: full.buyConsensus,
      sellConsensus: full.sellConsensus,
      recencyDays: full.recencyDays,
      riskTolerance,
      atrMultiplier: full.atrMultiplier,
      atrPeriod: full.atrPeriod,
      adxThreshold: full.adxThreshold,
      adxPeriod: full.adxPeriod,
    });
  }

  const proposedSettings = proposal ? fromProposedSettings(proposal.settings) : null;
  const changedFields = proposedSettings ? diffSettings(settings, proposedSettings) : [];
  const currentRiskTolerance = settings.riskTolerance ?? 'neutral';
  const riskToleranceDiffers = currentRiskTolerance !== riskTolerance;
  const liveFieldsMatch =
    proposedSettings !== null &&
    !riskToleranceDiffers &&
    settings.buyConsensus === proposedSettings.buyConsensus &&
    settings.sellConsensus === proposedSettings.sellConsensus &&
    settings.recencyDays === proposedSettings.recencyDays &&
    settings.atrMultiplier === proposedSettings.atrMultiplier &&
    settings.atrPeriod === proposedSettings.atrPeriod &&
    settings.adxThreshold === proposedSettings.adxThreshold &&
    settings.adxPeriod === proposedSettings.adxPeriod;
  const onCooldown = cooldownRemaining > 0;
  const fitStyle = proposal ? FIT_STYLES[proposal.fit] : null;
  const earningsStyle = proposal ? EARNINGS_LIKELIHOOD_STYLES[proposal.earningsLikelihood] : null;
  /** What applying this proposal as Indicator Settings would change,
   * denoted against the CURRENT indicator settings (not just Historical
   * Testing's own baseline/scenario comparison, and including risk
   * tolerance, which the settings-only diffSettings above deliberately
   * excludes since the backtest simulation has no concept of it). Always
   * lists every field (not just the ones that differ), same "show the
   * whole picture" precedent as the table below; a differing field is
   * marked with a from-arrow-to instead of a bare value. */
  const compareRows = proposedSettings
    ? [
        { key: 'riskTolerance', label: 'Risk tolerance', current: riskToleranceLabel(currentRiskTolerance), proposed: riskToleranceLabel(riskTolerance), differs: riskToleranceDiffers },
        ...(Object.keys(FIELD_LABELS) as DiffableSettingsKey[]).map((key) => ({
          key,
          label: FIELD_LABELS[key],
          current: String(settings[key] ?? 'off'),
          proposed: String(proposedSettings[key] ?? 'off'),
          differs: settings[key] !== proposedSettings[key],
        })),
      ]
    : [];

  return (
    <section className="advisor-panel">
      <div className="section-label">AI suggestion</div>

      <div className="settings-group-hint" style={{ marginBottom: 4 }}>
        Risk tolerance for this suggestion:
      </div>
      <div role="radiogroup" aria-label="Risk tolerance" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
        {RISK_TOLERANCE_OPTIONS.map((opt) => (
          <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'calc(13px * var(--type-scale))', cursor: 'pointer' }} title={opt.hint}>
            <input
              type="radio"
              name={`riskTolerance-${ticker}`}
              value={opt.value}
              checked={riskTolerance === opt.value}
              onChange={() => selectRiskTolerance(opt.value)}
              disabled={loading}
            />
            {opt.label}
          </label>
        ))}
      </div>

      <button type="button" className="analyze-btn" onClick={request} disabled={loading || onCooldown}>
        {loading
          ? proposal
            ? 'Refreshing…'
            : `Researching ${ticker}…`
          : onCooldown
            ? `Retry in ${cooldownRemaining}s`
            : proposal
              ? 'Refresh AI Suggestion'
              : 'Get AI Suggestion'}
      </button>

      {proposal && (
        <div className="fact" style={{ marginTop: 6 }}>
          Last updated {new Date(proposal.retrievedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
        </div>
      )}

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
          {fitStyle && (
            <div
              style={{
                background: fitStyle.bg,
                color: fitStyle.fg,
                border: `1px solid ${fitStyle.fg}`,
                borderRadius: 8,
                padding: '8px 12px',
                marginBottom: 12,
                fontSize: 'calc(13px * var(--type-scale))',
              }}
            >
              <b>{fitStyle.label}</b>
              <CitationButton citations={proposal.fieldCitations.fitReason} />
              <div style={{ marginTop: 4, fontWeight: 400 }}>{proposal.fitReason}</div>
            </div>
          )}
          <div className="advisor-rationale">
            {proposal.rationale}
            <CitationButton citations={proposal.fieldCitations.rationale} />
          </div>
          {proposal.quickUpdateNote && (
            <div className="settings-group-hint" style={{ marginTop: 6, fontStyle: 'italic' }}>
              {proposal.quickUpdateNote}
            </div>
          )}

          {earningsStyle && (
            <div
              style={{
                background: earningsStyle.bg,
                color: earningsStyle.fg,
                border: `1px solid ${earningsStyle.fg}`,
                borderRadius: 8,
                padding: '8px 12px',
                marginTop: 12,
                fontSize: 'calc(13px * var(--type-scale))',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <b>{earningsStyle.label}</b>
                <span style={{ fontWeight: 400, opacity: 0.85 }}>
                  Next earnings: {proposal.nextEarningsDate ?? 'not found in research'}
                </span>
              </div>
              <div style={{ marginTop: 4, fontWeight: 400 }}>
                {proposal.earningsOutlook}
                <CitationButton citations={proposal.fieldCitations.earningsOutlook} />
              </div>
              <div style={{ marginTop: 4, fontWeight: 400 }}>
                {proposal.earningsLikelihoodReason}
                <CitationButton citations={proposal.fieldCitations.earningsLikelihoodReason} />
              </div>
            </div>
          )}

          {/* Every field always renders here, never collapsing into a
           * "matches" message once applied; the numbers are exactly what's
           * useful to see right after accepting. A field that differs from
           * the current Indicator Settings (risk tolerance included, not
           * just the backtest-relevant fields Historical Testing's own
           * baseline/scenario diff covers) shows current → proposed
           * instead of a bare value. */}
          <div className="compare-card">
            {compareRows.map((row) => (
              <div className="compare-row" key={row.key}>
                <span className="compare-label">{row.label}</span>
                <span className="compare-values">
                  {row.differs ? (
                    <>
                      <span style={{ color: 'var(--muted)' }}>{row.current}</span>
                      <span className="compare-arrow">→</span>
                      <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{row.proposed}</span>
                    </>
                  ) : (
                    row.proposed
                  )}
                </span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {liveFieldsMatch ? (
              <span className="badge settings-badge-active">✓ Matches Indicator Settings</span>
            ) : (
              <button type="button" className="analyze-btn" onClick={applyAsIndicatorSettings}>
                Apply AI Suggestions as the Indicator Settings
              </button>
            )}
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
