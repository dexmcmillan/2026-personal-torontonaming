import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineDistanceKm, centroidOfPolygon } from '../geo.js';

test('haversineDistanceKm: distance from a point to itself is 0', () => {
  const p = { lat: 43.6708, lng: -79.4060 };
  assert.equal(haversineDistanceKm(p, p), 0);
});

test('haversineDistanceKm: 1 degree of latitude is roughly 111km', () => {
  const a = { lat: 43.0, lng: -79.0 };
  const b = { lat: 44.0, lng: -79.0 };
  const d = haversineDistanceKm(a, b);
  assert.ok(d > 110 && d < 112, `expected ~111km, got ${d}`);
});

test('haversineDistanceKm: is symmetric', () => {
  const a = { lat: 43.65, lng: -79.38 };
  const b = { lat: 43.70, lng: -79.42 };
  assert.equal(haversineDistanceKm(a, b), haversineDistanceKm(b, a));
});

test('centroidOfPolygon: Polygon geometry returns the mean of its exterior ring', () => {
  // A closed unit square in [lng, lat] order, centred at (0.5, 0.5)
  const geometry = {
    type: 'Polygon',
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
  };
  const c = centroidOfPolygon(geometry);
  assert.ok(Math.abs(c.lat - 0.5) < 1e-9);
  assert.ok(Math.abs(c.lng - 0.5) < 1e-9);
});

test('centroidOfPolygon: MultiPolygon uses the exterior ring with the most vertices', () => {
  const geometry = {
    type: 'MultiPolygon',
    coordinates: [
      // small triangle far away — fewer vertices, should be ignored
      [[[10, 10], [11, 10], [10.5, 11], [10, 10]]],
      // unit square at origin — more vertices, should be used
      [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    ],
  };
  const c = centroidOfPolygon(geometry);
  assert.ok(Math.abs(c.lat - 0.5) < 1e-9);
  assert.ok(Math.abs(c.lng - 0.5) < 1e-9);
});

test('centroidOfPolygon: throws on an unsupported geometry type', () => {
  assert.throws(() => centroidOfPolygon({ type: 'Point', coordinates: [0, 0] }));
});
