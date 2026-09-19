import test from 'node:test';
import assert from 'node:assert/strict';

import { computeLedger, computeUnrealizedPnl, type PositionLot } from '../src/positionRisk.ts';

let seq = 0;
function lot(action: 'buy' | 'sell', tradeDate: string, shares: number, price: number, createdAt = tradeDate): PositionLot {
  seq += 1;
  return { id: `lot-${seq}`, action, tradeDate, shares, price, createdAt };
}

test('a single buy: held shares accumulate, nothing realized', () => {
  const { rows, openLots } = computeLedger([lot('buy', '2026-01-01', 10, 100)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.totalHeldShares, 10);
  assert.equal(rows[0]!.realizedGain, null);
  assert.equal(rows[0]!.realizedGainPct, null);
  assert.deepEqual(openLots, [{ tradeDate: '2026-01-01', shares: 10, price: 100 }]);
});

test('a full sell at a higher price realizes a gain against its cost basis', () => {
  const { rows, openLots } = computeLedger([
    lot('buy', '2026-01-01', 10, 100),
    lot('sell', '2026-02-01', 10, 150),
  ]);
  const sellRow = rows[1]!;
  assert.equal(sellRow.totalHeldShares, 0);
  assert.equal(sellRow.realizedGain, 500); // (150-100)*10
  assert.equal(sellRow.realizedGainPct, 50); // 500 / 1000 * 100
  assert.deepEqual(openLots, []);
});

test('a sell at a lower price realizes a loss', () => {
  const { rows } = computeLedger([
    lot('buy', '2026-01-01', 10, 100),
    lot('sell', '2026-02-01', 10, 80),
  ]);
  assert.equal(rows[1]!.realizedGain, -200);
  assert.equal(rows[1]!.realizedGainPct, -20);
});

test('FIFO: a sell spanning two buy lots at different prices sums cost basis and proceeds across both', () => {
  const { rows, openLots } = computeLedger([
    lot('buy', '2026-01-01', 10, 100),
    lot('buy', '2026-01-15', 10, 120),
    lot('sell', '2026-02-01', 15, 150),
  ]);
  // Consumes all 10 of the first lot (cost 1000) plus 5 of the second lot
  // (cost 600) = 1600 cost basis; proceeds = 15 * 150 = 2250.
  const sellRow = rows[2]!;
  assert.equal(sellRow.realizedGain, 2250 - 1600);
  assert.equal(sellRow.totalHeldShares, 5); // 20 bought - 15 sold
  // The remaining open lot is the back half of the second buy, at its own price.
  assert.deepEqual(openLots, [{ tradeDate: '2026-01-15', shares: 5, price: 120 }]);
});

test('FIFO anchor: the oldest still-open lot is whatever is left after partial consumption', () => {
  const { openLots } = computeLedger([
    lot('buy', '2026-01-01', 10, 100),
    lot('sell', '2026-01-10', 4, 110),
  ]);
  assert.deepEqual(openLots, [{ tradeDate: '2026-01-01', shares: 6, price: 100 }]);
});

test('full liquidation then rebuy: the anchor resets to the new buy, not the old one', () => {
  const { openLots } = computeLedger([
    lot('buy', '2026-01-01', 10, 100),
    lot('sell', '2026-01-15', 10, 120),
    lot('buy', '2026-03-01', 5, 90),
  ]);
  assert.deepEqual(openLots, [{ tradeDate: '2026-03-01', shares: 5, price: 90 }]);
});

test('lots are re-sorted by trade date regardless of input order, with created_at as a same-day tiebreak', () => {
  const later = lot('sell', '2026-01-01', 4, 110, '2026-01-01T09:00:00Z');
  const earlier = lot('buy', '2026-01-01', 10, 100, '2026-01-01T08:00:00Z');
  const { rows } = computeLedger([later, earlier]);
  assert.equal(rows[0]!.lot.id, earlier.id);
  assert.equal(rows[1]!.lot.id, later.id);
});

test('an oversell (more than ever bought) drives totalHeldShares negative rather than throwing', () => {
  const { rows } = computeLedger([
    lot('buy', '2026-01-01', 5, 100),
    lot('sell', '2026-01-10', 8, 110),
  ]);
  assert.equal(rows[1]!.totalHeldShares, -3);
});

test('computeUnrealizedPnl values every open lot at its own cost basis', () => {
  const openLots = [
    { tradeDate: '2026-01-01', shares: 10, price: 100 },
    { tradeDate: '2026-01-15', shares: 5, price: 120 },
  ];
  const result = computeUnrealizedPnl(openLots, 130);
  // amount = (130-100)*10 + (130-120)*5 = 300 + 50 = 350
  // cost basis = 1000 + 600 = 1600; pct = 350/1600*100
  assert.equal(result?.amount, 350);
  assert.equal(result?.pct, (350 / 1600) * 100);
});

test('computeUnrealizedPnl is null when nothing is currently held', () => {
  assert.equal(computeUnrealizedPnl([], 130), null);
});
