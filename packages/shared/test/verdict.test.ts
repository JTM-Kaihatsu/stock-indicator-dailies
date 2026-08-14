import test from 'node:test';
import assert from 'node:assert/strict';

import { parseVerdict } from '../src/verdict.ts';

/** A reading with a recent, qualified crossover in the given direction. */
function cross(indicator: string, direction: 'BULLISH' | 'BEARISH', extra: Record<string, unknown> = {}) {
  return { indicator, crossover: direction, qualified: true, barsAgo: 1, ...extra };
}
/** A reading with no crossover. */
function none(indicator: string) {
  return { indicator, crossover: 'NONE', qualified: false };
}

/** A structurally valid raw VLM payload; override fields per test. */
function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticker: 'NVDA',
    signal: 'HOLD',
    readings: [cross('macd', 'BULLISH'), none('slowStochastic'), none('sma')],
    ...overrides,
  };
}

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
  // 1 bullish + 2 none -> HOLD (BUY needs all three), and the model said HOLD.
  const { verdict, warnings } = expectOk(parseVerdict(raw()));
  assert.equal(verdict.signal, 'HOLD');
  assert.equal(verdict.ticker, 'NVDA');
  assert.equal(verdict.readings.length, 3);
  assert.deepEqual(warnings, []);
});

test('reading facts are preserved', () => {
  const { verdict } = expectOk(parseVerdict(raw()));
  const macd = verdict.readings.find((r) => r.indicator === 'macd')!;
  assert.equal(macd.crossover, 'BULLISH');
  assert.equal(macd.barsAgo, 1);
  assert.equal(macd.qualified, true);
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
  const input = raw({
    signal: 'HOLD',
    readings: [cross('macd', 'BEARISH'), cross('slowStochastic', 'BEARISH'), cross('sma', 'BEARISH')],
  });
  const { verdict, warnings } = expectOk(parseVerdict(input));
  assert.equal(verdict.signal, 'SELL');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /disagreed/);
});

test('a stale crossover does not fire, even if qualified', () => {
  const input = raw({
    readings: [cross('macd', 'BEARISH', { barsAgo: 20 }), cross('slowStochastic', 'BEARISH', { barsAgo: 20 }), none('sma')],
  });
  const { verdict } = expectOk(parseVerdict(input));
  assert.equal(verdict.signal, 'HOLD'); // both crossovers too old
});

test('an unqualified crossover does not fire', () => {
  const input = raw({
    readings: [
      cross('macd', 'BEARISH', { qualified: false }),
      cross('slowStochastic', 'BEARISH', { qualified: false }),
      none('sma'),
    ],
  });
  const { verdict } = expectOk(parseVerdict(input));
  assert.equal(verdict.signal, 'HOLD');
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
    readings: [cross('macd', 'BULLISH'), cross('slowStochastic', 'BULLISH'), none('sma')],
  });
  const { verdict, warnings } = expectOk(parseVerdict(input, { buyConsensus: 2 }));
  assert.equal(verdict.signal, 'BUY');
  assert.match(warnings[0]!, /disagreed/);
});

test('recency window flows through as an option', () => {
  const input = raw({
    readings: [cross('macd', 'BEARISH', { barsAgo: 5 }), cross('slowStochastic', 'BEARISH', { barsAgo: 5 }), none('sma')],
  });
  assert.equal(expectOk(parseVerdict(input)).verdict.signal, 'HOLD'); // default recency window is 3
  // Only 2 of 3 indicators have any crossover here (sma is NONE either way), so
  // sellConsensus is lowered too; isolates the recency-window option being
  // tested from the separate (now stricter, unanimity) SELL consensus default.
  assert.equal(expectOk(parseVerdict(input, { recencyDays: 7, sellConsensus: 2 })).verdict.signal, 'SELL');
});

test('rationale on readings and top-level are preserved', () => {
  const input = raw({
    rationale: 'mixed picture',
    readings: [
      cross('macd', 'BULLISH', { rationale: 'bullish cross below zero' }),
      none('slowStochastic'),
      none('sma'),
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
  assert.match(expectErr(parseVerdict(raw({ capturedAt: 'not-a-date' }))).errors.join('\n'), /capturedAt/);
});

// --- structural failures ---

test('non-object input fails', () => {
  assert.equal(parseVerdict(null).ok, false);
  assert.equal(parseVerdict('nope').ok, false);
  assert.equal(parseVerdict([]).ok, false);
});

test('empty / missing ticker fails', () => {
  assert.match(expectErr(parseVerdict(raw({ ticker: '   ' }))).errors.join('\n'), /ticker/);
});

test('malformed ticker fails', () => {
  assert.equal(expectErr(parseVerdict(raw({ ticker: '123' }))).ok, false);
});

test('readings must be an array', () => {
  assert.match(expectErr(parseVerdict(raw({ readings: {} }))).errors.join('\n'), /readings must be an array/);
});

test('unknown indicator fails', () => {
  const input = raw({ readings: [cross('rsi', 'BULLISH'), none('slowStochastic'), none('sma')] });
  assert.match(expectErr(parseVerdict(input)).errors.join('\n'), /not a known indicator/);
});

test('invalid crossover enum fails', () => {
  const input = raw({
    readings: [{ indicator: 'macd', crossover: 'MAYBE', qualified: false }, none('slowStochastic'), none('sma')],
  });
  assert.match(expectErr(parseVerdict(input)).errors.join('\n'), /BULLISH, BEARISH, or NONE/);
});

test('qualified must be a boolean', () => {
  const input = raw({
    readings: [{ indicator: 'macd', crossover: 'NONE', qualified: 'yes' }, none('slowStochastic'), none('sma')],
  });
  assert.match(expectErr(parseVerdict(input)).errors.join('\n'), /qualified must be a boolean/);
});

test('barsAgo required when a crossover is present', () => {
  const input = raw({
    readings: [{ indicator: 'macd', crossover: 'BULLISH', qualified: true }, none('slowStochastic'), none('sma')],
  });
  assert.match(expectErr(parseVerdict(input)).errors.join('\n'), /barsAgo must be a non-negative integer/);
});

test('barsAgo forbidden when crossover is NONE', () => {
  const input = raw({
    readings: [{ indicator: 'macd', crossover: 'NONE', qualified: false, barsAgo: 2 }, none('slowStochastic'), none('sma')],
  });
  assert.match(expectErr(parseVerdict(input)).errors.join('\n'), /barsAgo must be omitted when crossover is NONE/);
});

test('duplicate indicator fails', () => {
  const input = raw({ readings: [cross('macd', 'BULLISH'), cross('macd', 'BEARISH'), none('sma')] });
  assert.match(expectErr(parseVerdict(input)).errors.join('\n'), /duplicate reading/);
});

test('missing indicator fails when requireAllIndicators (default)', () => {
  const input = raw({ readings: [cross('macd', 'BULLISH'), none('slowStochastic')] });
  assert.match(expectErr(parseVerdict(input)).errors.join('\n'), /missing reading for indicator "sma"/);
});

test('partial readings allowed when requireAllIndicators is false', () => {
  const input = raw({ readings: [cross('macd', 'BEARISH'), cross('slowStochastic', 'BEARISH')] });
  // sellConsensus lowered to isolate the requireAllIndicators behavior under
  // test; with only 2 readings present, unanimity (the new default) can never
  // be reached, regardless of this option.
  const { verdict } = expectOk(parseVerdict(input, { requireAllIndicators: false, sellConsensus: 2 }));
  assert.equal(verdict.signal, 'SELL');
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
  assert.equal(expectOk(parseVerdict(raw())).verdict.visibleRange, undefined);
});

test('visibleRange of wrong type fails', () => {
  assert.equal(parseVerdict(raw({ visibleRange: 3 })).ok, false);
});
