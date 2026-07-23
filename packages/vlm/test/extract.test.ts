import test from 'node:test';
import assert from 'node:assert/strict';

import { extractJson } from '../src/extract.ts';

test('parses a bare JSON object', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
});

test('parses JSON inside a ```json fence', () => {
  const raw = 'Here you go:\n```json\n{"a":1,"b":"x"}\n```\nHope that helps!';
  assert.deepEqual(extractJson(raw), { a: 1, b: 'x' });
});

test('parses JSON inside a bare ``` fence', () => {
  assert.deepEqual(extractJson('```\n{"a":2}\n```'), { a: 2 });
});

test('parses JSON with surrounding prose (no fence)', () => {
  const raw = 'The verdict is {"signal":"HOLD"} based on the chart.';
  assert.deepEqual(extractJson(raw), { signal: 'HOLD' });
});

test('returns null for text with no JSON', () => {
  assert.equal(extractJson('I could not read the chart.'), null);
});

test('returns null for empty or non-string input', () => {
  assert.equal(extractJson(''), null);
  assert.equal(extractJson('   '), null);
  // @ts-expect-error exercising defensive runtime guard
  assert.equal(extractJson(null), null);
});

test('returns null for malformed JSON that cannot be recovered', () => {
  assert.equal(extractJson('{"a": }'), null);
});
