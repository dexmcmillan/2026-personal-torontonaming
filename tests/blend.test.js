// tests/blend.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idwWeight, computeCellBlend, dominantName } from '../blend.js';

test('idwWeight: distance 0 gives weight 1', () => {
  assert.equal(idwWeight(0, 3), 1);
});

test('idwWeight: distance at or beyond maxRadiusKm gives weight 0', () => {
  assert.equal(idwWeight(3, 3), 0);
  assert.equal(idwWeight(5, 3), 0);
});

test('idwWeight: weight decreases monotonically with distance', () => {
  const w1 = idwWeight(0.5, 3);
  const w2 = idwWeight(1.5, 3);
  const w3 = idwWeight(2.5, 3);
  assert.ok(w1 > w2 && w2 > w3);
});

test('computeCellBlend: returns null when no submissions are within range', () => {
  const cell = { lat: 43.65, lng: -79.40 };
  const submissions = [{ lat: 44.50, lng: -79.40, name: 'Far' }]; // ~94km away
  const colorLookup = new Map([['Far', { r: 255, g: 0, b: 0 }]]);

  const result = computeCellBlend(cell, submissions, colorLookup, { maxRadiusKm: 1.5, densitySaturation: 3 });

  assert.equal(result, null);
});

test('dominantName: returns null when no submissions are within range', () => {
  const cell = { lat: 43.65, lng: -79.40 };
  const submissions = [{ lat: 44.50, lng: -79.40, name: 'Far' }];
  assert.equal(dominantName(cell, submissions, 1.5), null);
});

test('dominantName: a single nearby submission wins', () => {
  const cell = { lat: 43.65, lng: -79.40 };
  const submissions = [{ ...cell, name: 'Solo' }];
  assert.equal(dominantName(cell, submissions, 1.5), 'Solo');
});

test('dominantName: a closer name wins over a farther name', () => {
  const cell = { lat: 43.65, lng: -79.40 };
  const submissions = [
    { lat: 43.6505, lng: -79.40, name: 'Closer' },
    { lat: 43.660, lng: -79.40, name: 'Farther' },
  ];
  assert.equal(dominantName(cell, submissions, 1.5), 'Closer');
});

test('dominantName: many weak-weight submissions of one name still lose to one strong nearby submission of another', () => {
  const cell = { lat: 43.65, lng: -79.40 };
  const submissions = [
    { ...cell, name: 'Strong' }, // distance 0, weight 1
    { lat: 43.6636, lng: -79.40, name: 'Weak' }, // ~1.49km away, weight ~0.00004
    { lat: 43.6637, lng: -79.40, name: 'Weak' },
    { lat: 43.6638, lng: -79.40, name: 'Weak' },
  ];
  assert.equal(dominantName(cell, submissions, 1.5), 'Strong');
});

test('computeCellBlend: a cell exactly at a single submission takes on its full colour', () => {
  const point = { lat: 43.65, lng: -79.40 };
  const submissions = [{ ...point, name: 'Solo' }];
  const colorLookup = new Map([['Solo', { r: 100, g: 150, b: 200 }]]);

  const result = computeCellBlend(point, submissions, colorLookup, { maxRadiusKm: 1.5, densitySaturation: 3 });

  assert.equal(result.r, 100);
  assert.equal(result.g, 150);
  assert.equal(result.b, 200);
});

test('computeCellBlend: two equidistant submissions of different names blend ~50/50', () => {
  const cell = { lat: 43.65, lng: -79.40 };
  const submissions = [
    { lat: 43.651, lng: -79.40, name: 'North' }, // ~111m north
    { lat: 43.649, lng: -79.40, name: 'South' }, // ~111m south, same distance
  ];
  const colorLookup = new Map([
    ['North', { r: 200, g: 0, b: 0 }],
    ['South', { r: 0, g: 0, b: 200 }],
  ]);

  const result = computeCellBlend(cell, submissions, colorLookup, { maxRadiusKm: 1.5, densitySaturation: 3 });

  assert.ok(Math.abs(result.r - 100) < 2);
  assert.ok(Math.abs(result.b - 100) < 2);
});

test('computeCellBlend: opacity increases with nearby submission density, capped at 1', () => {
  const cell = { lat: 43.65, lng: -79.40 };
  const colorLookup = new Map([['X', { r: 1, g: 1, b: 1 }]]);
  const options = { maxRadiusKm: 1.5, densitySaturation: 3 };

  const sparse = computeCellBlend(cell, [{ ...cell, name: 'X' }], colorLookup, options);
  const dense = computeCellBlend(
    cell,
    [{ ...cell, name: 'X' }, { ...cell, name: 'X' }, { ...cell, name: 'X' }, { ...cell, name: 'X' }, { ...cell, name: 'X' }],
    colorLookup,
    options
  );

  assert.ok(dense.opacity > sparse.opacity);
  assert.ok(dense.opacity <= 1);
});

test('computeCellBlend: submissions with a name absent from colorLookup are ignored', () => {
  const cell = { lat: 43.65, lng: -79.40 };
  const submissions = [{ ...cell, name: 'Unknown' }];
  const colorLookup = new Map(); // empty

  const result = computeCellBlend(cell, submissions, colorLookup, { maxRadiusKm: 1.5, densitySaturation: 3 });

  assert.equal(result, null);
});
