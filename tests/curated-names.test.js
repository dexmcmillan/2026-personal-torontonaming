// tests/curated-names.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const curated = JSON.parse(readFileSync(new URL('../data/curated-names.json', import.meta.url)));

// Toronto's rough bounding box
const LAT_MIN = 43.58, LAT_MAX = 43.86;
const LNG_MIN = -79.64, LNG_MAX = -79.12;

test('curated-names.json is a non-empty array of well-formed entries', () => {
  assert.ok(Array.isArray(curated));
  assert.ok(curated.length >= 15, `expected at least 15 curated names, got ${curated.length}`);
});

test('every curated name has a unique, non-empty name', () => {
  const names = curated.map(c => c.name.trim().toLowerCase());
  assert.ok(names.every(n => n.length > 0));
  assert.equal(new Set(names).size, names.length, 'duplicate curated names found');
});

test('every curated coordinate falls within the Toronto bounding box', () => {
  for (const entry of curated) {
    assert.ok(
      entry.lat >= LAT_MIN && entry.lat <= LAT_MAX,
      `${entry.name}: lat ${entry.lat} out of Toronto range`
    );
    assert.ok(
      entry.lng >= LNG_MIN && entry.lng <= LNG_MAX,
      `${entry.name}: lng ${entry.lng} out of Toronto range`
    );
  }
});
