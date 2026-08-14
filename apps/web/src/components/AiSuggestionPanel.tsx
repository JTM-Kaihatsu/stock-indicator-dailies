'use client';

import { useState } from 'react';
import { requestAiSuggestion } from '@/lib/advisorApi';
import { diffSettings, fromProposedSettings, type IndicatorSettings } from '@/lib/settings';
import type { AdvisorProposal } from '@/types/advisor';

export function AiSuggestionPanel({
  ticker,
  settings,
  onAccept,
}: {
  ticker: string;
  settings: IndicatorSettings;
  onAccept: (settings: IndicatorSettings) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<AdvisorProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function request() {
    setLoading(true);
    setError(null);
    setProposal(null);
    try {
      setProposal(await requestAiSuggestion(ticker));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  function accept() {
    if (!proposal) return;
    // Accepting the suggestion IS the confirmation — applies directly,
    // bypassing SettingsPanel's own confirm step.
    onAccept(fromProposedSettings(proposal.settings));
    setProposal(null);
  }

  const proposedSettings = proposal ? fromProposedSettings(proposal.settings) : null;
  const changedFields = proposedSettings ? diffSettings(settings, proposedSettings) : [];

  return (
    <section className="advisor-panel">
      <div className="section-label">AI suggestion</div>
      <button type="button" className="analyze-btn" onClick={request} disabled={loading}>
        {loading ? `Researching ${ticker}…` : 'Get AI Suggestion'}
      </button>

      {error && (
        <div className="error-card" style={{ marginTop: 12 }}>
          <h3>Suggestion failed</h3>
          <p>{error}</p>
        </div>
      )}

      {proposal && (
        <div style={{ marginTop: 12 }}>
          <div className="advisor-rationale">{proposal.rationale}</div>
          {changedFields.length > 0 ? (
            <div className="compare-card" style={{ marginTop: 0 }}>
              {changedFields.map((f) => (
                <div className="compare-row" key={f.key}>
                  <span className="compare-label">{f.label}</span>
                  <span className="compare-values">
                    {f.from ?? 'off'} <span className="compare-arrow">→</span> {f.to ?? 'off'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="advisor-diff-empty">Matches your current settings — nothing to change.</div>
          )}
          {changedFields.length > 0 && (
            <button type="button" className="analyze-btn" style={{ marginTop: 12 }} onClick={accept}>
              Accept AI Suggestion
            </button>
          )}
        </div>
      )}
    </section>
  );
}
