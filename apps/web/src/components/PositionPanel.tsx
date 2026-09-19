'use client';

import { useEffect, useRef, useState } from 'react';
import type { DayRangeResponse, LedgerRow, PositionRisk, UnrealizedPnl } from '@/types/watchlist';
import type { LotInput } from '@/lib/watchlistApi';

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
const usd = (n: number) => `$${n.toFixed(2)}`;

const CONTROL_KEYS = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Escape'];

/** Keystroke filtering is defense-in-depth, not the actual authority (a
 * paste or a direct API call can bypass it); the server re-validates
 * shares/price on every save regardless; see routes/watchlist.ts. */
function filterSharesKey(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.ctrlKey || e.metaKey || CONTROL_KEYS.includes(e.key)) return;
  if (!/^[0-9]$/.test(e.key)) e.preventDefault();
}

function filterPriceKey(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.ctrlKey || e.metaKey || CONTROL_KEYS.includes(e.key)) return;
  if (e.key === '.' && !e.currentTarget.value.includes('.')) return;
  if (!/^[0-9]$/.test(e.key)) e.preventDefault();
}

function sanitizeSharesText(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

function sanitizePriceText(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}

/** A paste can carry any text (letters, "e", symbols); preventDefault the
 * native paste and splice in only the sanitized characters at the current
 * selection, same end result as if the browser had pasted normally. */
function pasteSanitized(
  e: React.ClipboardEvent<HTMLInputElement>,
  current: string,
  sanitize: (raw: string) => string,
  setValue: (v: string) => void,
) {
  e.preventDefault();
  const target = e.currentTarget;
  const start = target.selectionStart ?? current.length;
  const end = target.selectionEnd ?? current.length;
  const spliced = current.slice(0, start) + e.clipboardData.getData('text') + current.slice(end);
  setValue(sanitize(spliced));
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

/** The entry-price info popup: unlike the plain CSS-hover .tip/.info-icon
 * pattern used elsewhere, this is JS-controlled so it can auto-open (with a
 * dismiss X) for 5s whenever the date changes, independently of also
 * showing plain-hover (no X). Fetches the day's range itself once a date
 * is set. */
function EntryPriceTooltip({
  tradeDate,
  onFetchDayRange,
}: {
  tradeDate: string;
  onFetchDayRange: (date: string) => Promise<DayRangeResponse>;
}) {
  const [mode, setMode] = useState<'closed' | 'auto' | 'hover'>('closed');
  const [range, setRange] = useState<{ low: number; high: number } | 'loading' | 'unavailable' | null>(null);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!tradeDate) {
      setRange(null);
      return;
    }
    let cancelled = false;
    setRange('loading');
    void onFetchDayRange(tradeDate).then((res) => {
      if (!cancelled) setRange(res.ok ? { low: res.low, high: res.high } : 'unavailable');
    });

    // Auto-opens (with a dismiss X) for 5s every time the date changes.
    setMode('auto');
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => setMode((m) => (m === 'auto' ? 'closed' : m)), 5000);

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeDate]);

  useEffect(
    () => () => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
    },
    [],
  );

  function dismiss() {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    setMode('closed');
  }

  const content = !tradeDate
    ? "Set an entry date to see the stock's range for that day"
    : range === 'loading' || range === null
      ? 'Loading…'
      : range === 'unavailable'
        ? 'No trading data found for that date.'
        : `${usd(range.low)} - ${usd(range.high)}`;

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setMode((m) => (m === 'closed' ? 'hover' : m))}
      onMouseLeave={() => setMode((m) => (m === 'hover' ? 'closed' : m))}
    >
      <span className="info-icon" tabIndex={0}>
        i
      </span>
      {mode !== 'closed' && (
        <div className="pos-tooltip" role="tooltip">
          {mode === 'auto' && (
            <button type="button" className="pos-tooltip-close" aria-label="Dismiss" onClick={dismiss}>
              ✕
            </button>
          )}
          <div style={{ paddingRight: mode === 'auto' ? 14 : 0 }}>{content}</div>
        </div>
      )}
    </span>
  );
}

interface LotFormState {
  action: 'buy' | 'sell';
  tradeDate: string;
  shares: string;
  price: string;
}

const EMPTY_FORM: LotFormState = { action: 'buy', tradeDate: '', shares: '', price: '' };

function parseLotForm(form: LotFormState): LotInput | 'invalid' {
  if (!form.tradeDate) return 'invalid';
  const shares = Number(form.shares);
  const price = Number(form.price);
  if (!Number.isInteger(shares) || shares <= 0) return 'invalid';
  if (!Number.isFinite(price) || price <= 0) return 'invalid';
  return { action: form.action, tradeDate: form.tradeDate, shares, price };
}

function LotFields({
  value,
  onChange,
  idPrefix,
  onFetchDayRange,
}: {
  value: LotFormState;
  onChange: (next: LotFormState) => void;
  idPrefix: string;
  onFetchDayRange: (date: string) => Promise<DayRangeResponse>;
}) {
  return (
    <div className="settings-group">
      <div className="settings-field">
        <label htmlFor={`${idPrefix}action`}>Buy or sell</label>
        <div className="select-wrap">
          <select
            id={`${idPrefix}action`}
            value={value.action}
            onChange={(e) => onChange({ ...value, action: e.target.value as 'buy' | 'sell' })}
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </div>
      </div>
      <div className="settings-field">
        <label htmlFor={`${idPrefix}tradeDate`}>Entry or sale date</label>
        <input
          id={`${idPrefix}tradeDate`}
          type="date"
          value={value.tradeDate}
          onChange={(e) => onChange({ ...value, tradeDate: e.target.value })}
        />
      </div>
      <div className="settings-field pos-field">
        <label htmlFor={`${idPrefix}shares`}>Shares</label>
        <input
          id={`${idPrefix}shares`}
          type="text"
          inputMode="numeric"
          placeholder="0"
          value={value.shares}
          onKeyDown={filterSharesKey}
          onPaste={(e) => pasteSanitized(e, value.shares, sanitizeSharesText, (v) => onChange({ ...value, shares: v }))}
          onChange={(e) => onChange({ ...value, shares: sanitizeSharesText(e.target.value) })}
        />
      </div>
      <div className="settings-field pos-field">
        <label htmlFor={`${idPrefix}price`} style={{ display: 'inline-flex', alignItems: 'center' }}>
          Entry price
          <EntryPriceTooltip tradeDate={value.tradeDate} onFetchDayRange={onFetchDayRange} />
        </label>
        <span className="pos-price-wrap">
          <span className="pos-price-prefix">$</span>
          <input
            id={`${idPrefix}price`}
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={value.price}
            onKeyDown={filterPriceKey}
            onPaste={(e) => pasteSanitized(e, value.price, sanitizePriceText, (v) => onChange({ ...value, price: v }))}
            onChange={(e) => onChange({ ...value, price: sanitizePriceText(e.target.value) })}
          />
        </span>
      </div>
    </div>
  );
}

export interface LotActionResult {
  ok: boolean;
  reason?: string;
}

/** A watchlisted ticker's real position, now a full buy/sell ledger: record
 * any number of lots over time, see FIFO-accounted realized gains per sale
 * plus running held shares, and (once ATR noise reduction is enabled in
 * Indicator Settings) the live sell-point this ticker's Overall signal is
 * watched against for whatever's still held. */
export function PositionPanel({
  ledgerRows,
  positionRisk,
  unrealizedPnl,
  onAdd,
  onEdit,
  onDelete,
  onClear,
  onFetchDayRange,
}: {
  ledgerRows: LedgerRow[];
  positionRisk: PositionRisk | null;
  unrealizedPnl: UnrealizedPnl | null;
  onAdd: (lot: LotInput) => Promise<LotActionResult>;
  onEdit: (lotId: string, lot: LotInput) => Promise<LotActionResult>;
  onDelete: (lotId: string) => Promise<LotActionResult>;
  onClear: () => Promise<LotActionResult>;
  onFetchDayRange: (date: string) => Promise<DayRangeResponse>;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLot, setNewLot] = useState<LotFormState>(EMPTY_FORM);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingLotId, setEditingLotId] = useState<string | null>(null);
  const [editLot, setEditLot] = useState<LotFormState>(EMPTY_FORM);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);

  function openAddForm() {
    setNewLot(EMPTY_FORM);
    setAddError(null);
    setEditingLotId(null);
    setShowAddForm(true);
  }

  async function saveNewLot() {
    const parsed = parseLotForm(newLot);
    if (parsed === 'invalid') {
      setAddError('Enter a valid date, a positive whole share count, and a positive entry price.');
      return;
    }
    setAddSaving(true);
    setAddError(null);
    const result = await onAdd(parsed);
    setAddSaving(false);
    if (!result.ok) {
      setAddError(result.reason ?? 'Could not save this position.');
      return;
    }
    setShowAddForm(false);
  }

  function openEditRow(row: LedgerRow) {
    setEditLot({ action: row.lot.action, tradeDate: row.lot.tradeDate, shares: String(row.lot.shares), price: String(row.lot.price) });
    setEditError(null);
    setShowAddForm(false);
    setEditingLotId(row.lot.id);
  }

  async function saveEditRow() {
    if (!editingLotId) return;
    const parsed = parseLotForm(editLot);
    if (parsed === 'invalid') {
      setEditError('Enter a valid date, a positive whole share count, and a positive entry price.');
      return;
    }
    setEditSaving(true);
    setEditError(null);
    const result = await onEdit(editingLotId, parsed);
    setEditSaving(false);
    if (!result.ok) {
      setEditError(result.reason ?? 'Could not save this position.');
      return;
    }
    setEditingLotId(null);
  }

  async function deleteEditRow() {
    if (!editingLotId) return;
    setEditSaving(true);
    setEditError(null);
    const result = await onDelete(editingLotId);
    setEditSaving(false);
    if (!result.ok) {
      setEditError(result.reason ?? 'Could not delete this position.');
      return;
    }
    setEditingLotId(null);
  }

  async function confirmClear() {
    setClearing(true);
    setClearError(null);
    const result = await onClear();
    setClearing(false);
    if (!result.ok) {
      setClearError(result.reason ?? 'Could not clear positions.');
      return;
    }
    setShowClearConfirm(false);
  }

  const heldShares = ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1]!.totalHeldShares : 0;
  const hasHolding = heldShares > 0;

  // Realized gain/loss, summed across every sell (weighted by each sell's
  // own cost basis, not an average of per-row percentages, which would
  // misweight sells of different sizes).
  const hasRealized = ledgerRows.some((row) => row.realizedGain !== null);
  const totalRealizedGain = ledgerRows.reduce((sum, row) => sum + (row.realizedGain ?? 0), 0);
  const totalRealizedCostBasis = ledgerRows.reduce((sum, row) => sum + (row.costBasis ?? 0), 0);
  const realizedPctDisplay = hasRealized && totalRealizedCostBasis > 0 ? pct((totalRealizedGain / totalRealizedCostBasis) * 100) : 'N/A';

  // Total Value = Unrealized gain/loss + Realized gain/loss: the combined
  // profit/loss this position has produced across its whole lifetime, not
  // just what's currently held.
  const unrealizedAmount = unrealizedPnl?.amount ?? 0;
  const unrealizedPctDisplay = unrealizedPnl ? pct(unrealizedPnl.pct) : 'N/A';
  const totalValueAmount = unrealizedAmount + totalRealizedGain;
  const totalCostBasisAll = (unrealizedPnl?.costBasis ?? 0) + totalRealizedCostBasis;
  const totalValuePctDisplay = totalCostBasisAll > 0 ? pct((totalValueAmount / totalCostBasisAll) * 100) : 'N/A';

  return (
    <section className="settings-panel" style={{ marginTop: 20 }}>
      <div className="section-label">Your position</div>

      {ledgerRows.length === 0 && (
        <div className="settings-group-hint" style={{ marginBottom: 12 }}>
          Record when you bought this stock, how many shares, and at what price to track unrealized gains/losses
          and, once ATR noise reduction is enabled in Indicator Settings, a live sell-point alert.
        </div>
      )}

      {ledgerRows.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="backtest-stats" style={{ marginBottom: 8 }}>
            <div className="backtest-stat">
              <div className="backtest-stat-label">Unrealized gain/loss</div>
              <div className={`backtest-stat-value ${unrealizedAmount >= 0 ? 'pos' : 'neg'}`}>
                {unrealizedAmount >= 0 ? '+' : ''}
                {usd(unrealizedAmount)} ({unrealizedPctDisplay})
              </div>
              <div style={{ marginTop: 4, fontSize: 11, fontWeight: 400, color: 'var(--faint)' }}>
                Current shares held: {heldShares}
              </div>
            </div>
            <div className="backtest-stat">
              <div className="backtest-stat-label">Realized gain/loss</div>
              <div className={`backtest-stat-value ${totalRealizedGain >= 0 ? 'pos' : 'neg'}`}>
                {totalRealizedGain >= 0 ? '+' : ''}
                {usd(totalRealizedGain)} ({realizedPctDisplay})
              </div>
            </div>
            <div className="backtest-stat">
              <div className="backtest-stat-label">Total Value</div>
              <div className={`backtest-stat-value ${totalValueAmount >= 0 ? 'pos' : 'neg'}`}>
                {totalValueAmount >= 0 ? '+' : ''}
                {usd(totalValueAmount)} ({totalValuePctDisplay})
              </div>
            </div>
          </div>
          {!hasHolding ? null : positionRisk ? (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 13,
                background: positionRisk.triggered ? 'var(--sell-bg)' : 'var(--buy-bg)',
                color: positionRisk.triggered ? 'var(--sell)' : 'var(--buy)',
                border: `1px solid ${positionRisk.triggered ? 'var(--sell)' : 'var(--buy)'}`,
              }}
            >
              <b>{positionRisk.triggered ? 'Sell point breached' : 'Above sell point'}</b>
              <div style={{ marginTop: 4, fontWeight: 400 }}>
                Peak {usd(positionRisk.peakSinceEntry)} since entry minus {positionRisk.atrMultiplier}x the{' '}
                {positionRisk.atrPeriod}-day ATR ({usd(positionRisk.atrValue)}) = sell point at{' '}
                {usd(positionRisk.stopLevel)}. Current price: {usd(positionRisk.currentPrice)}.
              </div>
            </div>
          ) : (
            <div className="settings-group-hint">
              Enable ATR noise reduction in Indicator Settings to also track a live sell point for this position.
            </div>
          )}
        </div>
      )}

      {!showAddForm && (
        <button type="button" className="settings-toggle" onClick={openAddForm}>
          <PlusIcon /> Record a position
        </button>
      )}

      {showAddForm && (
        <div>
          <LotFields value={newLot} onChange={setNewLot} idPrefix="posNew" onFetchDayRange={onFetchDayRange} />
          {addError && (
            <div className="error-card" style={{ marginTop: 4 }}>
              <p>{addError}</p>
            </div>
          )}
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button type="button" className="analyze-btn" disabled={addSaving} onClick={saveNewLot}>
              {addSaving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="settings-toggle" onClick={() => setShowAddForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {ledgerRows.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button type="button" className="settings-toggle" onClick={() => setHistoryOpen((v) => !v)}>
              {historyOpen ? '▾' : '▸'} Position history
            </button>
            {historyOpen && (
              <button type="button" className="btn-sm" onClick={() => setShowClearConfirm(true)}>
                <TrashIcon /> Clear
              </button>
            )}
          </div>
          {historyOpen && (
          <table className="trade-list">
            <thead>
              <tr>
                <th>Entry or Sale Date</th>
                <th>Shares Added or Sold</th>
                <th>Total Held Shares</th>
                <th>Entry price</th>
                <th>Realized Gains/Losses</th>
                <th>Realized Gain/Loss %</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ledgerRows.map((row) =>
                editingLotId === row.lot.id ? (
                  <tr key={row.lot.id}>
                    <td colSpan={7} style={{ padding: '8px 0' }}>
                      <LotFields value={editLot} onChange={setEditLot} idPrefix={`posEdit${row.lot.id}`} onFetchDayRange={onFetchDayRange} />
                      {editError && (
                        <div className="error-card" style={{ marginTop: 4 }}>
                          <p>{editError}</p>
                        </div>
                      )}
                      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                        <button type="button" className="analyze-btn" disabled={editSaving} onClick={saveEditRow}>
                          {editSaving ? 'Saving…' : 'Save'}
                        </button>
                        <button type="button" className="settings-toggle" onClick={() => setEditingLotId(null)}>
                          Cancel
                        </button>
                        <button type="button" className="danger-btn" disabled={editSaving} onClick={deleteEditRow}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={row.lot.id}>
                    <td className="tabular">{row.lot.tradeDate}</td>
                    <td className="tabular">
                      {row.lot.action === 'buy' ? '+' : '-'}
                      {row.lot.shares}
                    </td>
                    <td className="tabular">{row.totalHeldShares}</td>
                    <td className="tabular">{usd(row.lot.price)}</td>
                    <td className={`tabular ${row.realizedGain !== null ? `ledger-gain ${row.realizedGain >= 0 ? 'pos' : 'neg'}` : ''}`}>
                      {row.realizedGain !== null ? `${row.realizedGain >= 0 ? '+' : ''}${usd(row.realizedGain)}` : 'N/A'}
                    </td>
                    <td className={`tabular ${row.realizedGainPct !== null ? `ledger-gain ${row.realizedGainPct >= 0 ? 'pos' : 'neg'}` : ''}`}>
                      {row.realizedGainPct !== null ? pct(row.realizedGainPct) : 'N/A'}
                    </td>
                    <td>
                      <button type="button" className="icon-btn" aria-label={`Edit ${row.lot.tradeDate} position`} onClick={() => openEditRow(row)}>
                        <PencilIcon />
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          )}
        </div>
      )}

      {showClearConfirm && (
        <div className="modal-backdrop" onClick={() => !clearing && setShowClearConfirm(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="section-label" style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <TrashIcon /> Clear all positions?
            </div>
            <p>
              This will permanently clear all recorded positions for this ticker and can&apos;t be retrieved again.
            </p>
            {clearError && (
              <div className="error-card" style={{ marginBottom: 12 }}>
                <p>{clearError}</p>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="danger-btn" disabled={clearing} onClick={confirmClear}>
                {clearing ? 'Clearing…' : 'Proceed'}
              </button>
              <button type="button" className="settings-toggle" disabled={clearing} onClick={() => setShowClearConfirm(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
