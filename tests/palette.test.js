import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE } from '../palette.js';

test('PALETTE has 8 entries with valid hex and rgb', () => {
  assert.equal(PALETTE.length, 8);
  for (const entry of PALETTE) {
    assert.match(entry.hex, /^#[0-9a-f]{6}$/i);
    for (const channel of ['r', 'g', 'b']) {
      assert.ok(Number.isInteger(entry[channel]));
      assert.ok(entry[channel] >= 0 && entry[channel] <= 255);
    }
  }
});

test('PALETTE has no duplicate hex values', () => {
  const hexes = PALETTE.map(e => e.hex.toLowerCase());
  assert.equal(new Set(hexes).size, hexes.length);
});
