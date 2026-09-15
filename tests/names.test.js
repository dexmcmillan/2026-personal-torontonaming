import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry, assignColors, nearbyNames } from '../names.js';

function squareFeature(name, lng, lat, size = 0.01) {
  return {
    type: 'Feature',
    properties: { AREA_NAME: name },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat],
      ]],
    },
  };
}

test('buildRegistry: merges official features and curated names', () => {
  const official = {
    type: 'FeatureCollection',
    features: [squareFeature('Downtown', -79.38, 43.65)],
  };
  const curated = [{ name: 'The Annex', lat: 43.67, lng: -79.40 }];

  const registry = buildRegistry(official, curated);

  assert.equal(registry.length, 2);
  const names = registry.map(r => r.name).sort();
  assert.deepEqual(names, ['Downtown', 'The Annex']);
});

test('buildRegistry: a curated name matching an official name (case-insensitive) is dropped, official kept', () => {
  const official = {
    type: 'FeatureCollection',
    features: [squareFeature('The Beaches', -79.30, 43.67)],
  };
  const curated = [
    { name: 'the beaches', lat: 43.671, lng: -79.301 }, // duplicate, should be skipped
    { name: 'Leslieville', lat: 43.6629, lng: -79.3345 },
  ];

  const registry = buildRegistry(official, curated);

  assert.equal(registry.length, 2);
  assert.equal(registry.filter(r => r.name.toLowerCase() === 'the beaches').length, 1);
  assert.equal(registry.find(r => r.name.toLowerCase() === 'the beaches').source, 'official');
});

test('assignColors: two names within the collision radius get different colours', () => {
  const registry = [
    { name: 'A', lat: 43.65, lng: -79.40 },
    { name: 'B', lat: 43.6505, lng: -79.4005 }, // ~60m away, well within any reasonable radius
  ];
  const palette = [0, 1, 2].map(i => ({ hex: `#${i}`, r: i, g: i, b: i }));

  const assigned = assignColors(registry, palette, 3);

  assert.notEqual(assigned[0].colorIndex, assigned[1].colorIndex);
});

test('assignColors: names far apart can share a colour', () => {
  const registry = [
    { name: 'A', lat: 43.65, lng: -79.40 },
    { name: 'B', lat: 44.50, lng: -79.40 }, // ~94km away
  ];
  const palette = [{ hex: '#0', r: 0, g: 0, b: 0 }]; // only one colour available

  const assigned = assignColors(registry, palette, 3);

  assert.equal(assigned[0].colorIndex, 0);
  assert.equal(assigned[1].colorIndex, 0);
});

test('assignColors: preserves every input field and adds colorIndex', () => {
  const registry = [{ name: 'A', lat: 43.65, lng: -79.40, source: 'curated' }];
  const palette = [{ hex: '#0', r: 0, g: 0, b: 0 }];

  const [assigned] = assignColors(registry, palette, 3);

  assert.equal(assigned.name, 'A');
  assert.equal(assigned.source, 'curated');
  assert.equal(assigned.colorIndex, 0);
});

test('nearbyNames: returns entries sorted by ascending distance, sliced to count', () => {
  const pin = { lat: 43.65, lng: -79.40 };
  const registry = [
    { name: 'Far', lat: 44.00, lng: -79.40, colorIndex: 0 },
    { name: 'Near', lat: 43.651, lng: -79.401, colorIndex: 0 },
    { name: 'Middle', lat: 43.70, lng: -79.40, colorIndex: 0 },
  ];

  const result = nearbyNames(registry, pin, 2);

  assert.equal(result.length, 2);
  assert.deepEqual(result.map(r => r.name), ['Near', 'Middle']);
});
