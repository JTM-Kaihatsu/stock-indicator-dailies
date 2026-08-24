import test from 'node:test';
import assert from 'node:assert/strict';

import { isOutageError, OUTAGE_MESSAGE } from '../src/index.ts';

test('the message names Claude and both status links', () => {
  assert.match(OUTAGE_MESSAGE, /Claude/);
  assert.match(OUTAGE_MESSAGE, /downdetector\.com\/status\/claude-ai/);
  assert.match(OUTAGE_MESSAGE, /status\.claude\.com/);
  assert.match(OUTAGE_MESSAGE, /retried once/);
});

test('5xx / overloaded responses are outages', () => {
  assert.equal(isOutageError({ status: 500 }), true);
  assert.equal(isOutageError({ status: 529, message: 'overloaded_error' }), true);
  assert.equal(isOutageError({ status: 503 }), true);
});

test('connection / timeout errors are outages', () => {
  assert.equal(isOutageError({ name: 'APIConnectionError', message: 'Connection error' }), true);
  assert.equal(isOutageError({ name: 'APIConnectionTimeoutError', message: 'Request timed out' }), true);
  assert.equal(isOutageError(new Error('fetch failed')), true);
  assert.equal(isOutageError({ message: 'socket hang up' }), true);
  assert.equal(isOutageError({ message: 'getaddrinfo ENOTFOUND api.anthropic.com' }), true);
});

test('client errors and unrelated failures are NOT outages', () => {
  assert.equal(isOutageError({ status: 400, message: 'invalid_request_error' }), false);
  assert.equal(isOutageError({ status: 401 }), false);
  assert.equal(isOutageError(new Error('no JSON object found in model output')), false);
  assert.equal(isOutageError(null), false);
  assert.equal(isOutageError('nope'), false);
});
