import test from 'node:test';
import assert from 'node:assert/strict';

import { parseVerdict } from '../src/verdict.ts';

/** A structurally valid raw VLM payload; override fields per test. */
function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticker: 'NVDA',
    signal: 'HOLD',
    readings: [
      { indicator: 'macd', signal: 'BUY' },
      { indicator: 'slowStochastic', signal: 'NEUTRAL' },
      { indicator: 'sma', signal: 'NEUTRAL' },
    ],
    ...overrides,
  };
}

/** Assert the result is ok and return the success branch (narrowed). */
function expectOk(result: ReturnType<typeof parseVerdict>) {
  assert.equal(result.ok, true, `expected ok, got errors: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error('unreachable');
  return result;
}

function expectErr(result: ReturnType<typeof parseVerdict>) {
  assert.equal(result.ok, false, `expected error, got: ${JSON.stringify(result)}`);
  if (result.ok) throw new Error('unreachable');
  return result;
}

test('valid payload parses and derives the overall signal', () => {
  // 1 BUY + 2 NEUTRAL -> HOLD (BUY needs all three), and the model said HOLD.
  const { verdict, warnings } = expectOk(parseVerdict(raw()));
  assert.equal(verdict.signal, 'HOLD');
  assert.equal(verdict.ticker, 'NVDA');
  assert.equal(verdict.readings.length, 3);
  assert.deepEqual(warnings, []);
});

test('ticker is trimmed and upper-cased', () => {
  const { verdict } = expectOk(parseVerdict(raw({ ticker: '  nvda ' })));
  assert.equal(verdict.ticker, 'NVDA');
});

test('dotted ticker (e.g. BRK.B) is accepted', () => {
  const { verdict } = expectOk(parseVerdict(raw({ ticker: 'brk.b' })));
  assert.equal(verdict.ticker, 'BRK.B');
});

test('derived signal is authoritative and overrides a disagreeing model signal', () => {
  // Three SELL -> SELL, but the model claimed HOLD.
  const input = raw({
    signal: 'HOLD',
    readings: [
      { indicator: 'macd', signal: 'SELL' },
      { indicator: 'slowStochastic', signal: 'SELL' },
      { indicator: 'sma', signal: 'SELL' },
    ],
  });
  const { verdict, warnings } = expectOk(parseVerdict(input));
  assert.equal(verdict.signal, 'SELL');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /disagreed/);
});

test('matching model signal produces no warning', () => {
  const input = raw({
    signal: 'SELL',
    readings: [
      { indicator: 'macd', signal: 'SELL' },
      { indicator: 'slowStochastic', signal: 'SELL' },
      { indicator: 'sma', signal: 'BUY' },
    ],
  });
  const { verdict, warnings } = expectOk(parseVerdict(input));
  assert.equal(verdict.signal, 'SELL'); // two SELL is enough
  assert.deepEqual(warnings, []);
});

test('invalid model signal value is warned, not fatal', () => {
  const { warnings } = expectOk(parseVerdict(raw({ signal: 'STRONG_BUY' })));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /invalid model signal/);
});

test('a missing model signal is fine (we derive it)', () => {
  const input = raw();
  delete input.signal;
  const { verdict, warnings } = expectOk(parseVerdict(input));
  assert.equal(verdict.signal, 'HOLD');
  assert.deepEqual(warnings, []);
});

test('consensus options flow through to the derived signal', () => {
  const input = raw({
    signal: 'HOLD',
    readings: [
      { indicator: 'macd', signal: 'BUY' },
      { indicator: 'slowStochastic', signal: 'BUY' },
      { indicator: 'sma', signal: 'NEUTRAL' },
    ],
  });
  const { verdict, warnings } = expectOk(parseVerdict(input, { buyConsensus: 2 }));
  assert.equal(verdict.signal, 'BUY');
  assert.match(warnings[0]!, /disagreed/);
});

test('rationale on readings and top-level are preserved', () => {
  const input = raw({
    rationale: 'mixed picture',
    readings: [
      { indicator: 'macd', signal: 'BUY', rationale: 'bullish cross below zero' },
      { indicator: 'slowStochastic', signal: 'NEUTRAL' },
      { indicator: 'sma', signal: 'NEUTRAL' },
    ],
  });
  const { verdict } = expectOk(parseVerdict(input));
  assert.equal(verdict.rationale, 'mixed picture');
  assert.equal(verdict.readings[0]!.rationale, 'bullish cross below zero');
});

test('valid capturedAt is retained; invalid is rejected', () => {
  const iso = '2026-07-14T13:30:00.000Z';
  const { verdict } = expectOk(parseVerdict(raw({ capturedAt: iso })));
  assert.equal(verdict.capturedAt, iso);

  const { errors } = expectErr(parseVerdict(raw({ capturedAt: 'not-a-date' })));
  assert.match(errors.join('\n'), /capturedAt/);
});

// --- structural failures ---

test('non-object input fails', () => {
  assert.equal(parseVerdict(null).ok, false);
  assert.equal(parseVerdict('nope').ok, false);
  assert.equal(parseVerdict([]).ok, false);
});

test('empty / missing ticker fails', () => {
  const { errors } = expectErr(parseVerdict(raw({ ticker: '   ' })));
  assert.match(errors.join('\n'), /ticker/);
});

test('malformed ticker fails', () => {
  assert.equal(expectErr(parseVerdict(raw({ ticker: '123' }))).ok, false);
});

test('readings must be an array', () => {
  const { errors } = expectErr(parseVerdict(raw({ readings: {} })));
  assert.match(errors.join('\n'), /readings must be an array/);
});

test('unknown indicator fails', () => {
  const input = raw({
    readings: [
      { indicator: 'rsi', signal: 'BUY' },
      { indicator: 'slowStochastic', signal: 'NEUTRAL' },
      { indicator: 'sma', signal: 'NEUTRAL' },
    ],
  });
  assert.match(expectErr(parseVerdict(input)).errors.join('\n'), /not a known indicator/);
});

test('invalid reading signal enum fails', () => {
  const input = raw({
    readings: [
      { indicator: 'macd', signal: 'MAYBE' },
      { indicator: 'slowStochastic', signal: 'NEUTRAL' },
      { indicator: 'sma', signal: 'NEUTRAL' },
    ],
  });
  assert.match(expectErr(parseVerdict(input)).errors.join('\n'), /BUY, SELL, or NEUTRAL/);
});

test('duplicate indicator fails', () => {
  const input = raw({
    readings: [
      { indicator: 'macd', signal: 'BUY' },
      { indicator: 'macd', signal: 'SELL' },
      { indicator: 'sma', signal: 'NEUTRAL' },
    ],
  });
  assert.match(expectErr(parseVerdict(input)).errors.join('\n'), /duplicate reading/);
});

test('missing indicator fails when requireAllIndicators (default)', () => {
  const input = raw({
    readings: [
      { indicator: 'macd', signal: 'BUY' },
      { indicator: 'slowStochastic', signal: 'NEUTRAL' },
    ],
  });
  assert.match(expectErr(parseVerdict(input)).errors.join('\n'), /missing reading for indicator "sma"/);
});

test('partial readings allowed when requireAllIndicators is false', () => {
  const input = raw({
    signal: 'HOLD',
    readings: [
      { indicator: 'macd', signal: 'SELL' },
      { indicator: 'slowStochastic', signal: 'SELL' },
    ],
  });
  const { verdict } = expectOk(parseVerdict(input, { requireAllIndicators: false }));
  assert.equal(verdict.signal, 'SELL'); // two SELL
  assert.equal(verdict.readings.length, 2);
});

test('rationale of wrong type fails', () => {
  assert.equal(parseVerdict(raw({ rationale: 42 })).ok, false);
});

test('visibleRange is preserved when the model reports it', () => {
  const { verdict } = expectOk(parseVerdict(raw({ visibleRange: 'Jan 2026 to Aug 2026' })));
  assert.equal(verdict.visibleRange, 'Jan 2026 to Aug 2026');
});

test('visibleRange is optional', () => {
  const { verdict } = expectOk(parseVerdict(raw()));
  assert.equal(verdict.visibleRange, undefined);
});

test('visibleRange of wrong type fails', () => {
  assert.equal(parseVerdict(raw({ visibleRange: 3 })).ok, false);
});
