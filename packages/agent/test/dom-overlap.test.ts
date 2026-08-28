import test from 'node:test';
import assert from 'node:assert/strict';

import { isKnownStructuralElement } from '../src/dom-overlap.ts';

// The browser-dependent half (hasForeignOverlayOverChart) isn't unit-tested
// here — this package's tests never launch a real browser — but was
// verified live: a real capture across ten tickers (NVDA, TSLA, GOOGL,
// META, MSFT, AMZN, AAPL, NFLX, BE, COST) finds zero qualifying elements
// (this denylist plus the overlap threshold correctly excludes every
// legitimate structural element), and a <div> injected over the chart to
// simulate either a large centered modal or a small corner toast is
// correctly the *only* thing flagged, at 28% and 5% overlap respectively.

test('known TradingView structural chrome is recognized', () => {
  assert.equal(isKnownStructuralElement('js-rootresizer__contents'), true);
  assert.equal(isKnownStructuralElement('panel-XpK1dKBC black-border-bigger-radius'), true);
  assert.equal(isKnownStructuralElement('layout__area--center no-border-bottom-left-radius'), true);
  assert.equal(isKnownStructuralElement('toastLayerChart-h0NSCjCQ'), true);
  assert.equal(isKnownStructuralElement('toastList-Iyo_5_y8'), true);
  assert.equal(isKnownStructuralElement('scrollWrap-qYm4x2uu noScrollBar-qYm4x2uu'), true);
});

test('an unrecognized element (a real popup candidate) is not excluded', () => {
  assert.equal(isKnownStructuralElement(''), false);
  assert.equal(isKnownStructuralElement('some-upsell-modal-h4x9k2'), false);
  assert.equal(isKnownStructuralElement('promoCard-2xJq8p'), false);
});
