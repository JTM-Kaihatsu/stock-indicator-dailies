import test from 'node:test';
import assert from 'node:assert/strict';

import { hasAuthCookie, hasAuthSession, type CookieLike } from '../src/auth.ts';

/** Cookie names actually observed on an anonymous TradingView session. */
const ANONYMOUS: CookieLike[] = [
  { name: '_ga', domain: '.tradingview.com' },
  { name: '_gcl_au', domain: '.tradingview.com' },
  { name: 'cookiesSettings', domain: '.tradingview.com' },
  { name: 'g_state', domain: '.tradingview.com' },
];

const SIGNED_IN: CookieLike[] = [
  ...ANONYMOUS,
  { name: 'sessionid', domain: '.tradingview.com' },
  { name: 'sessionid_sign', domain: '.tradingview.com' },
];

test('anonymous session is not treated as signed in', () => {
  assert.equal(hasAuthCookie(ANONYMOUS), false);
});

test('session cookie means signed in', () => {
  assert.equal(hasAuthCookie(SIGNED_IN), true);
});

test('a session cookie on another domain does not count', () => {
  assert.equal(
    hasAuthCookie([{ name: 'sessionid', domain: '.example.com' }]),
    false,
  );
});

test('empty jar is not signed in', () => {
  assert.equal(hasAuthCookie([]), false);
});

test('hasAuthSession reads from a cookie source', async () => {
  assert.equal(await hasAuthSession({ cookies: async () => SIGNED_IN }), true);
  assert.equal(await hasAuthSession({ cookies: async () => ANONYMOUS }), false);
});
