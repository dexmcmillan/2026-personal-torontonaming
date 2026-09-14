# Toronto Neighbourhood Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, public-facing web tool where visitors drop a pin at their home location, pick what they call their neighbourhood from a nearby-filtered list, and immediately see a soft, blended, categorical heatmap of what everyone else in the city calls their own areas.

**Architecture:** Single-page static HTML/CSS/JS app, no build step, no bundler. Leaflet.js renders a dark-themed map of Toronto. Firebase Firestore (CDN SDK) persists submissions. Pure computational logic (distance math, name-registry construction, colour assignment, IDW colour blending) lives in dependency-free ES modules covered by `node --test`; DOM/map/Firestore wiring lives in `app.js` and is verified manually in-browser, mirroring the sibling project `2026-personal-eastwesttoronto`'s split between its canvas-heatmap worker and its hand-tested UI code. The blended grid is computed in a module Web Worker (`grid-worker.js`) that imports the same pure modules `app.js` uses, so there is exactly one implementation of the registry/colour logic, not two.

**Tech Stack:** HTML5, CSS3, vanilla JS (ES modules), Leaflet.js 1.9 (CDN), Turf.js 6.5 (CDN, boundary/mask/grid-membership geometry only), Firebase JS SDK v10 (CDN), Node's built-in test runner (`node --test`, zero dependencies) for pure-logic tests, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-09-14-torontonaming-design.md`

## Global Constraints

- No build step, no bundler, no npm dependencies — `package.json` exists only to set `"type": "module"` so `node --test` can run ES module imports.
- No freeform name entry — the name picker is list-only (Task 9).
- No address geocoding — home location is set by clicking/tapping the map only.
- Firestore is public read/write test-mode, no auth — same trust model as eastwesttoronto.
- Categorical palette is the 8-hue **dark** set from the project's dataviz skill (`references/palette.md`), used as-is (values below) — this palette's own validated report states only its first 3 slots pass strict "all names visible at once" (all-pairs) CVD safety; past 3 it relies on the documented mitigation of never encoding identity by colour alone. Because this map can show many differently-coloured regions in one viewport at once (unlike a typical ≤8-series chart), Task 11 makes visible text name-labels on confidently-coloured cells mandatory, not optional — that satisfies the "identity is never colour-alone" rule the skill requires whenever a palette can't clear the all-pairs floor past 3 slots.
- Style: per-cent (not percent) in any user-facing copy, per the Globe and Mail house-style rule that also applies to this personal project's written copy for consistency with the user's other work.

---

## File Structure

```
2026-personal-torontonaming/
├── index.html              UI shell: header, map, name/tenure picker modal, toast, loading overlay
├── style.css                All styling — dark theme, picker modal, pin/label markup
├── app.js                   DOM/Leaflet/Firestore wiring: map init, pin drop, picker, submit, render orchestration
├── geo.js                   Pure: haversineDistanceKm, centroidOfPolygon — no DOM, no dependencies
├── palette.js                Pure: PALETTE constant (8 categorical hues, dataviz skill)
├── names.js                  Pure: buildRegistry, assignColors, nearbyNames — imports geo.js only
├── blend.js                   Pure: idwWeight, computeCellBlend — imports geo.js only
├── grid-worker.js             Web Worker: per-cell grid loop calling blend.js, off the main thread
├── package.json                {"type": "module"} only — enables `node --test` on the pure modules
├── data/
│   ├── toronto-boundary.geojson        Toronto outline (copied from eastwesttoronto)
│   ├── toronto-neighbourhoods.geojson  158 official AREA_NAME polygons (downloaded, Task 1)
│   └── curated-names.json               ~29 hand-authored informal/contested names (Task 2)
├── tests/
│   ├── curated-names.test.js  Validates curated-names.json shape/bounds
│   ├── geo.test.js             Covers geo.js
│   ├── palette.test.js          Covers palette.js
│   ├── names.test.js            Covers names.js (imports geo.js transitively)
│   └── blend.test.js             Covers blend.js (imports geo.js transitively)
└── docs/superpowers/{specs,plans}/  This spec and this plan
```

The pure/DOM split is deliberate: `geo.js`, `palette.js`, `names.js`, and `blend.js` have zero DOM or Firebase dependencies, so they're fully covered by `node --test` (Tasks 3–5). `grid-worker.js` imports only `blend.js`, so the per-cell loop it adds is thin enough to verify manually rather than needing its own test harness. `app.js` is the only file that talks to Leaflet, the DOM, or Firestore — it's covered by in-browser verification steps throughout, mirroring how eastwesttoronto was built and tested.

---

## Prerequisites (manual, before starting)

1. Create a new Firebase project (e.g. `torontonaming`) at console.firebase.google.com, separate from eastwesttoronto's project.
2. Add a Web app to the project to get its config object.
3. Enable Firestore Database in **test mode**.
4. Keep the config object handy — it's pasted into `app.js` in Task 10.

---

### Task 1: Project scaffold + boundary/neighbourhood data acquisition

**Files:**
- Create: `package.json`
- Create: `data/toronto-boundary.geojson` (copied)
- Create: `data/toronto-neighbourhoods.geojson` (downloaded)

**Interfaces:**
- Produces: `data/toronto-boundary.geojson` (single Toronto outline Feature, same shape eastwesttoronto's `loadBoundary()` already consumes), `data/toronto-neighbourhoods.geojson` (GeoJSON FeatureCollection, `AREA_NAME` property, 158 features) — both consumed by Task 4 (`names.js` tests) and Task 7 (`app.js` boundary load).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "2026-personal-torontonaming",
  "private": true,
  "type": "module"
}
```

This has no dependencies — it exists solely so Node treats `.js` files as ES modules, letting `node --test` run the `import`/`export` syntax the pure logic modules use in later tasks.

- [ ] **Step 2: Copy the Toronto boundary GeoJSON from eastwesttoronto**

```bash
cp /Users/DMcMillan@globeandmail.com/Documents/Code/2026-personal-eastwesttoronto/data/toronto-boundary.geojson \
   data/toronto-boundary.geojson
```

- [ ] **Step 3: Download the current official neighbourhoods GeoJSON**

Use the City of Toronto Open Data CKAN API to find the current resource URL (don't hardcode a resource URL — the portal reshuffles resource IDs on republish):

```bash
curl -s --max-time 20 "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=neighbourhoods" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
for r in data['result']['resources']:
    if r.get('format', '').upper() == 'GEOJSON' and 'historical' not in r.get('name', '').lower():
        print(r['name'], '|', r['url'])
"
```

This should print exactly one line, `Neighbourhoods - 4326.geojson | https://...`. Download that URL (not the "historical 140" resource — it suffixes names with numeric codes like "Brookhaven-Amesbury (30)", which we don't want):

```bash
curl -s --max-time 30 "<url from previous step>" -o data/toronto-neighbourhoods.geojson
```

**Fallback if the API call fails or the response shape has changed:** open https://open.toronto.ca/dataset/neighbourhoods/ in a browser, download the GeoJSON format of the (non-historical) "Neighbourhoods" resource, save it to `data/toronto-neighbourhoods.geojson`.

- [ ] **Step 4: Verify the downloaded file**

```bash
python3 -c "
import json
d = json.load(open('data/toronto-neighbourhoods.geojson'))
feats = d['features']
print('feature count:', len(feats))
print('sample AREA_NAME values:', [f['properties']['AREA_NAME'] for f in feats[:5]])
"
```

Expected: `feature count: 158`, and sample names with no trailing `(NN)` numeric suffixes.

- [ ] **Step 5: Commit**

```bash
git add package.json data/toronto-boundary.geojson data/toronto-neighbourhoods.geojson
git commit -m "feat: project scaffold, Toronto boundary and neighbourhoods data"
```

---

### Task 2: Curated informal-neighbourhood name list

**Files:**
- Create: `data/curated-names.json`
- Test: `tests/curated-names.test.js`

**Interfaces:**
- Produces: `data/curated-names.json` — `[{ name: string, lat: number, lng: number }, ...]`, consumed by `names.js`'s `buildRegistry()` in Task 4 and by `app.js` in Task 9.

- [ ] **Step 1: Write `data/curated-names.json`**

These are Toronto neighbourhood names people commonly use that aren't reliably captured by the official 158-name planning-boundary list (or are captured under a different official name than what residents actually say) — the exact "naming" tension this project is about. Coordinates are approximate representative points, not surveyed boundaries; they only need to be roughly right for nearby-name filtering and colour-collision checks.

```json
[
  { "name": "The Annex", "lat": 43.6708, "lng": -79.4060 },
  { "name": "Yorkville", "lat": 43.6708, "lng": -79.3894 },
  { "name": "Kensington Market", "lat": 43.6547, "lng": -79.4005 },
  { "name": "Chinatown", "lat": 43.6529, "lng": -79.3986 },
  { "name": "Little Italy", "lat": 43.6547, "lng": -79.4211 },
  { "name": "Little Portugal", "lat": 43.6469, "lng": -79.4318 },
  { "name": "Trinity Bellwoods", "lat": 43.6467, "lng": -79.4177 },
  { "name": "Parkdale", "lat": 43.6377, "lng": -79.4394 },
  { "name": "Roncesvalles", "lat": 43.6467, "lng": -79.4489 },
  { "name": "Leslieville", "lat": 43.6629, "lng": -79.3345 },
  { "name": "Riverdale", "lat": 43.6667, "lng": -79.3500 },
  { "name": "Cabbagetown", "lat": 43.6669, "lng": -79.3656 },
  { "name": "Corktown", "lat": 43.6558, "lng": -79.3611 },
  { "name": "Distillery District", "lat": 43.6503, "lng": -79.3596 },
  { "name": "Liberty Village", "lat": 43.6377, "lng": -79.4222 },
  { "name": "The Junction", "lat": 43.6660, "lng": -79.4633 },
  { "name": "Junction Triangle", "lat": 43.6656, "lng": -79.4478 },
  { "name": "High Park", "lat": 43.6537, "lng": -79.4653 },
  { "name": "Bloor West Village", "lat": 43.6503, "lng": -79.4877 },
  { "name": "The Beaches", "lat": 43.6700, "lng": -79.2989 },
  { "name": "Greektown", "lat": 43.6786, "lng": -79.3512 },
  { "name": "Church-Wellesley Village", "lat": 43.6656, "lng": -79.3807 },
  { "name": "Regent Park", "lat": 43.6603, "lng": -79.3627 },
  { "name": "Forest Hill", "lat": 43.6944, "lng": -79.4133 },
  { "name": "Rosedale", "lat": 43.6784, "lng": -79.3789 },
  { "name": "Summerhill", "lat": 43.6844, "lng": -79.3925 },
  { "name": "Wychwood", "lat": 43.6797, "lng": -79.4225 },
  { "name": "Casa Loma", "lat": 43.6780, "lng": -79.4094 },
  { "name": "Baby Point", "lat": 43.6614, "lng": -79.4789 }
]
```

This is a starting/seed list, not exhaustive — expanding it later is just editing this JSON file, no code changes needed.

- [ ] **Step 2: Spot-check a sample of coordinates against OpenStreetMap's geocoder**

This is a sanity pass, not a strict pass/fail gate — Toronto's OSM neighbourhood-boundary tagging is known to be incomplete, so a generic result (e.g. a borough name instead of the specific informal name) is expected for some points and isn't itself an error:

```bash
for pair in "43.6708,-79.4060:The Annex" "43.6629,-79.3345:Leslieville" "43.6660,-79.4633:The Junction" "43.6547,-79.4005:Kensington Market"; do
  lat=$(echo $pair | cut -d: -f1 | cut -d, -f1)
  lng=$(echo $pair | cut -d: -f1 | cut -d, -f2)
  label=$(echo $pair | cut -d: -f2)
  result=$(curl -s --max-time 10 -H "User-Agent: torontonaming-datacheck/1.0" \
    "https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16" \
    | python3 -c "
import json,sys
d = json.load(sys.stdin)
addr = d.get('address', {})
print(addr.get('suburb') or addr.get('neighbourhood') or addr.get('quarter') or addr.get('city_district') or d.get('display_name','?'))
")
  echo "${label} (${lat},${lng}) -> ${result}"
  sleep 1.1
done
```

Read the output for anything wildly wrong (e.g. a coordinate landing in a different city or across the harbour) — that would indicate a typo'd digit, not just OSM's usual generic-fallback behaviour.

- [ ] **Step 3: Write the failing validation test**

```javascript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/curated-names.test.js`
Expected: 3 tests pass (this is a validation test written against already-authored data, so it should pass immediately — if it fails, fix `curated-names.json`, not the test).

- [ ] **Step 5: Commit**

```bash
git add data/curated-names.json tests/curated-names.test.js
git commit -m "feat: curated informal-neighbourhood name list"
```

---

### Task 3: `geo.js` and `palette.js` — foundational pure modules

**Files:**
- Create: `geo.js`
- Create: `palette.js`
- Test: `tests/geo.test.js`
- Test: `tests/palette.test.js`

**Interfaces:**
- Produces: `geo.js` exports `haversineDistanceKm(a, b)` and `centroidOfPolygon(geometry)`, both consumed by `names.js` (Task 4) and `blend.js` (Task 5). `palette.js` exports `PALETTE`, an array of 8 `{ hex, r, g, b }` objects, consumed by `app.js` (Task 9, 12) and `grid-worker.js` (Task 6) for colour lookups.

- [ ] **Step 1: Write the failing tests for `geo.js`**

```javascript
// tests/geo.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/geo.test.js`
Expected: FAIL — `geo.js` does not exist yet.

- [ ] **Step 3: Implement `geo.js`**

```javascript
// geo.js
const EARTH_RADIUS_KM = 6371;

export function haversineDistanceKm(a, b) {
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function centroidOfPolygon(geometry) {
  let ring;
  if (geometry.type === 'Polygon') {
    ring = geometry.coordinates[0];
  } else if (geometry.type === 'MultiPolygon') {
    ring = geometry.coordinates
      .map(poly => poly[0])
      .reduce((longest, r) => (r.length > longest.length ? r : longest));
  } else {
    throw new Error(`centroidOfPolygon: unsupported geometry type "${geometry.type}"`);
  }

  // GeoJSON rings repeat their first point as the last, to close the ring —
  // drop that duplicate before averaging, or it skews the mean toward it.
  const uniqueVertices = ring.slice(0, -1);

  let sumLat = 0;
  let sumLng = 0;
  for (const [lng, lat] of uniqueVertices) {
    sumLat += lat;
    sumLng += lng;
  }
  return { lat: sumLat / uniqueVertices.length, lng: sumLng / uniqueVertices.length };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/geo.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Write the failing test for `palette.js`**

```javascript
// tests/palette.test.js
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
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --test tests/palette.test.js`
Expected: FAIL — `palette.js` does not exist yet.

- [ ] **Step 7: Implement `palette.js`**

The 8 dark-mode categorical hues from the project's dataviz skill (`references/palette.md`), converted to RGB for canvas blending. This is the palette used on the dark basemap (Task 11):

```javascript
// palette.js
export const PALETTE = [
  { hex: '#3987e5', r: 0x39, g: 0x87, b: 0xe5 }, // blue
  { hex: '#d95926', r: 0xd9, g: 0x59, b: 0x26 }, // orange
  { hex: '#199e70', r: 0x19, g: 0x9e, b: 0x70 }, // aqua
  { hex: '#c98500', r: 0xc9, g: 0x85, b: 0x00 }, // yellow
  { hex: '#d55181', r: 0xd5, g: 0x51, b: 0x81 }, // magenta
  { hex: '#008300', r: 0x00, g: 0x83, b: 0x00 }, // green
  { hex: '#9085e9', r: 0x90, g: 0x85, b: 0xe9 }, // violet
  { hex: '#e66767', r: 0xe6, g: 0x67, b: 0x67 }, // red
];
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node --test tests/palette.test.js`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add geo.js palette.js tests/geo.test.js tests/palette.test.js
git commit -m "feat: geo distance/centroid helpers and categorical palette"
```

---

### Task 4: `names.js` — registry, colour assignment, nearby-name search

**Files:**
- Create: `names.js`
- Test: `tests/names.test.js`

**Interfaces:**
- Consumes: `geo.js`'s `haversineDistanceKm(a, b)`, `centroidOfPolygon(geometry)`.
- Produces: `buildRegistry(officialFeatureCollection, curatedNames)` → `[{ name, lat, lng, source }]`; `assignColors(registry, palette, radiusKm = 3)` → registry entries with `colorIndex` added; `nearbyNames(registry, pin, count = 12)` → sorted-by-distance slice. All three consumed by `app.js` (Task 9) and `grid-worker.js` (Task 6).

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/names.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/names.test.js`
Expected: FAIL — `names.js` does not exist yet.

- [ ] **Step 3: Implement `names.js`**

```javascript
// names.js
import { haversineDistanceKm, centroidOfPolygon } from './geo.js';

export function buildRegistry(officialFeatureCollection, curatedNames) {
  const registry = [];
  const seen = new Set();

  for (const feature of officialFeatureCollection.features) {
    const name = feature.properties.AREA_NAME;
    const key = name.trim().toLowerCase();
    if (seen.has(key)) continue;
    const { lat, lng } = centroidOfPolygon(feature.geometry);
    registry.push({ name, lat, lng, source: 'official' });
    seen.add(key);
  }

  for (const curated of curatedNames) {
    const key = curated.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    registry.push({ name: curated.name, lat: curated.lat, lng: curated.lng, source: 'curated' });
    seen.add(key);
  }

  return registry;
}

export function assignColors(registry, palette, radiusKm = 3) {
  const assigned = [];
  for (const entry of registry) {
    const nearbyCounts = new Array(palette.length).fill(0);
    for (const other of assigned) {
      if (haversineDistanceKm(entry, other) <= radiusKm) {
        nearbyCounts[other.colorIndex]++;
      }
    }
    let bestIndex = 0;
    for (let i = 1; i < palette.length; i++) {
      if (nearbyCounts[i] < nearbyCounts[bestIndex]) bestIndex = i;
    }
    assigned.push({ ...entry, colorIndex: bestIndex });
  }
  return assigned;
}

export function nearbyNames(registry, pin, count = 12) {
  return registry
    .map(entry => ({ entry, distanceKm: haversineDistanceKm(pin, entry) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, count)
    .map(x => x.entry);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/names.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add names.js tests/names.test.js
git commit -m "feat: name registry, proximity colour assignment, nearby-name search"
```

---

### Task 5: `blend.js` — IDW colour blending

**Files:**
- Create: `blend.js`
- Test: `tests/blend.test.js`

**Interfaces:**
- Consumes: `geo.js`'s `haversineDistanceKm(a, b)`.
- Produces: `idwWeight(distanceKm, maxRadiusKm)` and `computeCellBlend(cellLatLng, submissions, colorLookup, options)` → `{ r, g, b, opacity } | null`, both consumed by `grid-worker.js` (Task 6).

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/blend.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idwWeight, computeCellBlend } from '../blend.js';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/blend.test.js`
Expected: FAIL — `blend.js` does not exist yet.

- [ ] **Step 3: Implement `blend.js`**

```javascript
// blend.js
import { haversineDistanceKm } from './geo.js';

export function idwWeight(distanceKm, maxRadiusKm) {
  if (distanceKm >= maxRadiusKm) return 0;
  const t = 1 - distanceKm / maxRadiusKm;
  return t * t;
}

export function computeCellBlend(cellLatLng, submissions, colorLookup, { maxRadiusKm, densitySaturation }) {
  let totalWeight = 0;
  let r = 0;
  let g = 0;
  let b = 0;

  for (const sub of submissions) {
    const color = colorLookup.get(sub.name);
    if (!color) continue;

    const distanceKm = haversineDistanceKm(cellLatLng, sub);
    const weight = idwWeight(distanceKm, maxRadiusKm);
    if (weight <= 0) continue;

    r += color.r * weight;
    g += color.g * weight;
    b += color.b * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return null;

  return {
    r: Math.round(r / totalWeight),
    g: Math.round(g / totalWeight),
    b: Math.round(b / totalWeight),
    opacity: Math.min(1, totalWeight / densitySaturation),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/blend.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add blend.js tests/blend.test.js
git commit -m "feat: inverse-distance-weighted colour blending for the grid heatmap"
```

---

### Task 6: `grid-worker.js` — Web Worker grid computation

**Files:**
- Create: `grid-worker.js`

**Interfaces:**
- Consumes: `blend.js`'s `computeCellBlend(cellLatLng, submissions, colorLookup, options)`.
- Produces: worker message contract — `postMessage({ type: 'compute', submissions, registry, gridBbox, cols, rows, maskBuffer, maxRadiusKm, densitySaturation })` in; `{ type: 'result', rgba: ArrayBuffer }` out (an RGBA `Uint8ClampedArray` of length `cols * rows * 4`, transferred). Consumed by `app.js` (Task 10).

This is glue code wiring `computeCellBlend` into a per-cell loop and a transferable result buffer — the actual blending math is already covered by Task 5's tests, so this task is verified manually in-browser in Task 10 once `app.js` can post real messages to it (there's no practical way to instantiate a browser Worker under `node --test`).

- [ ] **Step 1: Implement `grid-worker.js`**

```javascript
// grid-worker.js
import { computeCellBlend } from './blend.js';

self.onmessage = ({ data }) => {
  if (data.type !== 'compute') return;

  const { submissions, registry, gridBbox, cols, rows, maskBuffer, maxRadiusKm, densitySaturation } = data;
  const [minLng, minLat, maxLng, maxLat] = gridBbox;
  const cellW = (maxLng - minLng) / cols;
  const cellH = (maxLat - minLat) / rows;
  const mask = new Uint8Array(maskBuffer);

  const colorLookup = new Map(registry.map(entry => [entry.name, entry.color]));

  const rgba = new Uint8ClampedArray(cols * rows * 4);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!mask[idx]) continue;

      const cellLatLng = {
        lng: minLng + (c + 0.5) * cellW,
        lat: minLat + (r + 0.5) * cellH,
      };

      const blend = computeCellBlend(cellLatLng, submissions, colorLookup, { maxRadiusKm, densitySaturation });
      if (!blend) continue;

      const pixelBase = idx * 4;
      rgba[pixelBase] = blend.r;
      rgba[pixelBase + 1] = blend.g;
      rgba[pixelBase + 2] = blend.b;
      rgba[pixelBase + 3] = Math.round(blend.opacity * 255);
    }
  }

  self.postMessage({ type: 'result', rgba: rgba.buffer }, [rgba.buffer]);
};
```

Note: `registry` entries arrive from `app.js` already carrying a resolved `color: { r, g, b }` field (not just `colorIndex`) — `app.js` resolves `colorIndex` against `PALETTE` once before posting, so this worker never needs to import `palette.js` itself. This keeps the worker's only import surface to `blend.js`.

- [ ] **Step 2: Commit**

```bash
git add grid-worker.js
git commit -m "feat: grid-worker computes the blended heatmap off the main thread"
```

---

### Task 7: HTML/CSS shell, map init, boundary + mask

**Files:**
- Create: `index.html`
- Create: `style.css`
- Create: `app.js` (bootstrap portion only — map, boundary, mask, panes)

**Interfaces:**
- Produces: module-level `map` (Leaflet instance), `torontoFeature`, `gridBbox`, `cellCentroids`, `inTorontoMask` in `app.js`, consumed by every later `app.js` task in this plan.

This task adapts eastwesttoronto's already-working `loadBoundary()` / `initGrid()` / mask-pane setup almost directly (see `2026-personal-eastwesttoronto/app.js`), since that geometry plumbing has nothing to do with the interaction-model differences between the two projects.

- [ ] **Step 1: Write `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>What Do You Call Your Neighbourhood?</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div id="header">
    <h1>What Do You Call Your Neighbourhood?</h1>
    <p id="question">Drop a pin where you live, then tell us what you call that area.</p>
  </div>

  <div id="map"></div>

  <div id="picker-modal" class="hidden">
    <div id="picker-card">
      <div id="picker-step-name">
        <p id="picker-prompt">What do you call this area?</p>
        <input type="text" id="name-search" placeholder="Search nearby names…" autocomplete="off" />
        <ul id="name-options"></ul>
      </div>
      <div id="picker-step-tenure" class="hidden">
        <p id="tenure-prompt">How long have you lived here?</p>
        <div id="tenure-options">
          <button class="tenure-btn" data-tenure="&lt;1">&lt; 1 year</button>
          <button class="tenure-btn" data-tenure="1-5">1&ndash;5 years</button>
          <button class="tenure-btn" data-tenure="5-10">5&ndash;10 years</button>
          <button class="tenure-btn" data-tenure="10+">10+ years</button>
        </div>
      </div>
      <div id="picker-buttons">
        <button id="btn-submit" disabled>Submit my answer</button>
        <button id="btn-cancel-pin">Cancel</button>
      </div>
    </div>
  </div>

  <div id="loading">
    <div id="loading-spinner"></div>
    <h2>What Do You Call Your Neighbourhood?</h2>
    <p>Loading map&hellip;</p>
  </div>

  <div id="toast" class="hidden">Thanks! Your answer has been recorded.</div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/@turf/turf@6.5.0/turf.min.js"></script>
  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `style.css`**

Base layout, dark theme, and the loading/toast styling adapted directly from eastwesttoronto's `style.css` (same header/toast/loading treatment), plus new picker-modal styles:

```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f0f0f0;
}

#header {
  padding: 28px 20px 24px;
  background: #1a1a2e;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  text-align: center;
}

#header h1 {
  font-size: 1.4rem;
  font-weight: 700;
  color: #fff;
  letter-spacing: -0.01em;
}

#question {
  font-size: 0.95rem;
  color: rgba(255,255,255,0.85);
  font-weight: 500;
  margin-top: 2px;
}

#map {
  flex: 1;
  cursor: crosshair;
}

#picker-modal {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 8000;
  pointer-events: none;
}

#picker-modal.hidden {
  display: none;
}

#picker-card {
  background: #1a1a2e;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 12px 12px 0 0;
  padding: 20px 24px;
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 -4px 24px rgba(0,0,0,0.35);
  pointer-events: all;
}

#picker-step-tenure.hidden,
#picker-step-name.hidden {
  display: none;
}

#picker-prompt,
#tenure-prompt {
  font-size: 0.9rem;
  font-weight: 600;
  color: rgba(255,255,255,0.85);
}

#name-search {
  width: 100%;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.15);
  background: rgba(255,255,255,0.05);
  color: #fff;
  font-size: 0.9rem;
  font-family: inherit;
}

#name-options {
  list-style: none;
  max-height: 220px;
  overflow-y: auto;
  margin-top: 8px;
  border-radius: 6px;
  overflow-x: hidden;
}

#name-options li {
  padding: 10px 12px;
  color: rgba(255,255,255,0.85);
  cursor: pointer;
  font-size: 0.88rem;
}

#name-options li:hover,
#name-options li.highlighted {
  background: rgba(255,255,255,0.1);
}

#name-options li.selected {
  background: #4a90d9;
  color: #fff;
}

#tenure-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tenure-btn {
  flex: 1 0 40%;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.15);
  background: rgba(255,255,255,0.05);
  color: rgba(255,255,255,0.85);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.tenure-btn.selected {
  background: #4a90d9;
  border-color: #4a90d9;
  color: #fff;
}

#picker-buttons {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

button {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  font-size: 0.88rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}

button:active {
  transform: scale(0.97);
}

#btn-submit {
  background: #4a90d9;
  color: #fff;
  flex: 1;
}

#btn-submit:hover:not(:disabled) {
  background: #3a7bc8;
}

#btn-submit:disabled {
  background: #444;
  color: rgba(255,255,255,0.4);
  cursor: default;
}

#btn-cancel-pin {
  background: rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.8);
  border: 1px solid rgba(255,255,255,0.15);
}

#btn-cancel-pin:hover {
  background: rgba(255,255,255,0.18);
}

#toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: #1a1a2e;
  color: #fff;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 500;
  z-index: 9999;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  border: 1px solid rgba(255,255,255,0.1);
  white-space: nowrap;
}

#toast.hidden {
  display: none;
}

#loading {
  position: fixed;
  inset: 0;
  background: #1a1a2e;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  z-index: 10000;
  font-family: 'Inter', -apple-system, sans-serif;
  font-size: 0.9rem;
  color: rgba(255,255,255,0.5);
}

#loading h2 {
  font-size: 1.1rem;
  font-weight: 700;
  color: #fff;
  letter-spacing: -0.01em;
}

#loading.hidden {
  display: none;
}

#loading-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(255,255,255,0.15);
  border-top-color: #4a90d9;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 3: Write the bootstrap portion of `app.js`**

```javascript
// app.js
const TORONTO_CENTER = [43.7181, -79.3762];
const TORONTO_ZOOM = 11;
const GRID_COLS = 160;
const GRID_ROWS = 160;

const map = L.map('map', {
  zoomControl: true,
  minZoom: 10,
}).setView(TORONTO_CENTER, TORONTO_ZOOM);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
  maxZoom: 19,
}).addTo(map);

map.createPane('heatmapPane');
map.getPane('heatmapPane').style.zIndex = 250;
map.getPane('heatmapPane').style.pointerEvents = 'none';

map.createPane('maskPane');
map.getPane('maskPane').style.zIndex = 300;
map.getPane('maskPane').style.pointerEvents = 'none';

map.createPane('labelsPane');
map.getPane('labelsPane').style.zIndex = 650;
map.getPane('labelsPane').style.pointerEvents = 'none';

let torontoFeature = null;
let gridBbox = null;
let cellCentroids = null;
let inTorontoMask = null;

function initGrid() {
  gridBbox = turf.bbox(torontoFeature);
  const [minLng, minLat, maxLng, maxLat] = gridBbox;
  const cellW = (maxLng - minLng) / GRID_COLS;
  const cellH = (maxLat - minLat) / GRID_ROWS;

  const total = GRID_COLS * GRID_ROWS;
  cellCentroids = new Float64Array(total * 2);
  inTorontoMask = new Uint8Array(total);

  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const idx = r * GRID_COLS + c;
      const lng = minLng + (c + 0.5) * cellW;
      const lat = minLat + (r + 0.5) * cellH;
      cellCentroids[idx * 2] = lng;
      cellCentroids[idx * 2 + 1] = lat;
      inTorontoMask[idx] = turf.booleanPointInPolygon(turf.point([lng, lat]), torontoFeature) ? 1 : 0;
    }
  }
}

function renderMask() {
  const world = turf.polygon([[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]]);
  const mask = turf.difference(world, torontoFeature);
  if (!mask) return;

  L.geoJSON(mask, {
    style: { fillColor: '#f0f0f0', fillOpacity: 0.45, color: '#888', weight: 1.5 },
    pane: 'maskPane',
    interactive: false,
  }).addTo(map);
}

async function loadBoundary() {
  const res = await fetch('data/toronto-boundary.geojson');
  torontoFeature = await res.json();

  const bounds = L.geoJSON(torontoFeature).getBounds();
  map.fitBounds(bounds, { padding: [-40, -40] });
  map.setMaxBounds(bounds.pad(0.15));

  renderMask();
  initGrid();
  document.getElementById('loading').classList.add('hidden');
}

async function init() {
  await loadBoundary();
}
init();
```

- [ ] **Step 4: Verify in browser**

```bash
python3 -m http.server 8080
```

Visit `http://localhost:8080`. Expected: dark header with title, map area showing the Toronto boundary with a semi-opaque mask outside it, loading spinner disappears once the boundary loads.

- [ ] **Step 5: Commit**

```bash
git add index.html style.css app.js
git commit -m "feat: HTML/CSS shell, map init, Toronto boundary and mask"
```

---

### Task 8: Pin-drop interaction

**Files:**
- Modify: `app.js`

**Interfaces:**
- Produces: module-level `pendingPin: {lat, lng} | null` and a `pinMarker` Leaflet marker, consumed by Task 9 (name picker) and Task 10 (submit).

- [ ] **Step 1: Add pin state and click handler to `app.js`**

Leaflet's `click` event fires for both mouse clicks and touch taps out of the box (unlike eastwesttoronto's freehand-drag drawing, which needed custom `touchstart`/`touchmove` tracking) — a plain `map.on('click', ...)` handles both input types here, so no separate touch-handling code is needed for this task.

Add after the `init()` call:

```javascript
let pendingPin = null;
let pinMarker = null;

const pinIcon = L.divIcon({
  className: 'pin-marker',
  html: '<div class="pin-dot"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

map.on('click', e => {
  if (!torontoFeature) return; // ignore clicks before boundary has loaded
  if (!turf.booleanPointInPolygon(turf.point([e.latlng.lng, e.latlng.lat]), torontoFeature)) {
    showToast("That's outside Toronto — try clicking inside the boundary.");
    return;
  }

  pendingPin = { lat: e.latlng.lat, lng: e.latlng.lng };

  if (pinMarker) map.removeLayer(pinMarker);
  pinMarker = L.marker(e.latlng, { icon: pinIcon, interactive: false }).addTo(map);

  openPicker();
});

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

function openPicker() {
  document.getElementById('picker-modal').classList.remove('hidden');
}

function closePicker() {
  document.getElementById('picker-modal').classList.add('hidden');
}

document.getElementById('btn-cancel-pin').addEventListener('click', () => {
  if (pinMarker) { map.removeLayer(pinMarker); pinMarker = null; }
  pendingPin = null;
  closePicker();
});
```

- [ ] **Step 2: Add pin marker CSS to `style.css`**

```css
.pin-marker { background: transparent; border: none; }

.pin-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #e63946;
  border: 2px solid #fff;
  box-shadow: 0 0 6px rgba(0,0,0,0.4);
}
```

- [ ] **Step 3: Verify in browser (desktop and mobile emulation)**

Reload the page. Click anywhere inside the Toronto boundary — a red pin should appear and the picker modal should slide up from the bottom (empty/non-functional until Task 9). Click outside the boundary — a toast should appear instead, no pin placed. Click "Cancel" — pin and modal should both disappear. Open browser DevTools device emulation (e.g. iPhone), confirm a tap does the same thing.

- [ ] **Step 4: Commit**

```bash
git add app.js style.css
git commit -m "feat: pin-drop interaction on map click/tap"
```

---

### Task 9: Searchable, list-only name picker

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `names.js`'s `buildRegistry`, `assignColors`, `nearbyNames`; `palette.js`'s `PALETTE`.
- Produces: module-level `registry` (built once at startup) and `chosenName: string | null`, consumed by Task 10 (submit).

- [ ] **Step 1: Import the pure modules and build the registry at startup**

Add near the top of `app.js`:

```javascript
import { buildRegistry, assignColors, nearbyNames } from './names.js';
import { PALETTE } from './palette.js';

const NEARBY_NAME_COUNT = 12;
const ASSIGN_COLOR_RADIUS_KM = 3;

let registry = [];
```

Replace the `init()` function to also load the name sources and build the registry:

```javascript
async function init() {
  await loadBoundary();

  const [neighbourhoodsRes, curatedRes] = await Promise.all([
    fetch('data/toronto-neighbourhoods.geojson'),
    fetch('data/curated-names.json'),
  ]);
  const officialFeatureCollection = await neighbourhoodsRes.json();
  const curatedNames = await curatedRes.json();

  const rawRegistry = buildRegistry(officialFeatureCollection, curatedNames);
  registry = assignColors(rawRegistry, PALETTE, ASSIGN_COLOR_RADIUS_KM).map(entry => ({
    ...entry,
    color: PALETTE[entry.colorIndex],
  }));
}
init();
```

- [ ] **Step 2: Populate the nearby-name list when the picker opens**

Add after `openPicker()`:

```javascript
let chosenName = null;
let chosenTenure = null;

function updateSubmitEnabled() {
  document.getElementById('btn-submit').disabled = !(chosenName && chosenTenure);
}

function populateNameOptions(pin) {
  const options = nearbyNames(registry, pin, NEARBY_NAME_COUNT);
  renderNameOptions(options);
}

function renderNameOptions(options) {
  const list = document.getElementById('name-options');
  list.innerHTML = '';
  for (const entry of options) {
    const li = document.createElement('li');
    li.textContent = entry.name;
    li.dataset.name = entry.name;
    if (entry.name === chosenName) li.classList.add('selected');
    li.addEventListener('click', () => selectName(entry.name));
    list.appendChild(li);
  }
}

function selectName(name) {
  chosenName = name;
  document.querySelectorAll('#name-options li').forEach(li => {
    li.classList.toggle('selected', li.dataset.name === name);
  });
  updateSubmitEnabled();
  document.getElementById('picker-step-name').classList.add('hidden');
  document.getElementById('picker-step-tenure').classList.remove('hidden');
}
```

`chosenTenure` and `updateSubmitEnabled` are declared here (not in Task 10) because the click handler below already needs to reset `chosenTenure` and call `updateSubmitEnabled` — declaring them only when Task 10 adds the tenure *buttons* would leave this task's own browser-verification step throwing a `ReferenceError` on every map click. Task 10 only adds behaviour on top of these, it doesn't redeclare them.

Update `map.on('click', ...)` to call `populateNameOptions` and reset picker state — replace the body of the click handler with:

```javascript
map.on('click', e => {
  if (!torontoFeature) return;
  if (!turf.booleanPointInPolygon(turf.point([e.latlng.lng, e.latlng.lat]), torontoFeature)) {
    showToast("That's outside Toronto — try clicking inside the boundary.");
    return;
  }

  pendingPin = { lat: e.latlng.lat, lng: e.latlng.lng };
  chosenName = null;
  chosenTenure = null;

  if (pinMarker) map.removeLayer(pinMarker);
  pinMarker = L.marker(e.latlng, { icon: pinIcon, interactive: false }).addTo(map);

  document.getElementById('picker-step-name').classList.remove('hidden');
  document.getElementById('picker-step-tenure').classList.add('hidden');
  document.getElementById('name-search').value = '';
  updateSubmitEnabled();
  populateNameOptions(pendingPin);
  openPicker();
});
```

- [ ] **Step 3: Wire the search input to filter within the nearby set (list-only — no freeform)**

Add after `renderNameOptions`:

```javascript
document.getElementById('name-search').addEventListener('input', e => {
  const query = e.target.value.trim().toLowerCase();
  const nearby = nearbyNames(registry, pendingPin, NEARBY_NAME_COUNT);
  const filtered = query
    ? nearby.filter(entry => entry.name.toLowerCase().includes(query))
    : nearby;
  renderNameOptions(filtered);
});
```

Typing filters the list to substring matches within the already-nearby set — it never searches the full ~180-name registry, and there is no way to set `chosenName` except by clicking a rendered `<li>`, so a query that matches nothing simply leaves the list empty and the Submit button stays disabled (enforced in Task 10). This is the "list-only, no freeform" behaviour from the design doc.

- [ ] **Step 4: Verify in browser**

Reload, click inside Toronto. The picker should show a "What do you call this area?" step with a search box and a list of plausible nearby names (mix of official + curated, closest first). Click a name — it highlights, and the view switches to a hidden tenure step (blank/non-functional until Task 10). Type a few letters — the list should filter to matches within that same nearby set; typing something matching nothing should leave the list empty rather than accepting the typed text as an answer.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: searchable list-only nearby-name picker"
```

---

### Task 10: Firestore submit + blended heatmap render

Submitting an answer and seeing the resulting heatmap are one coherent flow — the submit handler's whole point is to trigger a fresh render — so they're one task rather than two. Steps below are ordered so every function/variable is declared before anything references it, keeping each step's own browser check runnable as soon as it's reached.

**Files:**
- Modify: `app.js`
- Modify: `style.css`

**Interfaces:**
- Consumes: Firebase JS SDK (`initializeApp`, `getFirestore`, `collection`, `addDoc`, `getDocs`, `serverTimestamp`); `grid-worker.js`'s message contract (Task 6).
- Produces: Firestore writes to the `submissions` collection; `HeatmapCanvasLayer` rendered on the map, updated on load and after every submit.

- [ ] **Step 1: Add Firebase imports and config to the top of `app.js`**

```javascript
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getFirestore, collection, addDoc, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_AUTH_DOMAIN",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_STORAGE_BUCKET",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const COLLECTION = 'submissions';
```

Paste in the real values from the Firebase project created in Prerequisites before testing this task.

- [ ] **Step 2: Add the canvas heatmap layer**

Adapted from eastwesttoronto's `HeatmapCanvasLayer`, rendering an RGBA buffer per-cell instead of a two-colour lerp:

```javascript
const HeatmapCanvasLayer = L.Layer.extend({
  onAdd(map) {
    this._map = map;
    this._canvas = L.DomUtil.create('canvas', 'heatmap-canvas');
    this._canvas.style.position = 'absolute';
    this._canvas.style.pointerEvents = 'none';
    map.getPane('heatmapPane').appendChild(this._canvas);
    map.on('moveend zoomend move zoom', this._redraw, this);
  },

  onRemove(map) {
    this._canvas.remove();
    map.off('moveend zoomend move zoom', this._redraw, this);
  },

  update(rgba) {
    this._rgba = rgba;
    this._redraw();
  },

  _redraw() {
    if (!this._rgba || !gridBbox) return;
    const [minLng, minLat, maxLng, maxLat] = gridBbox;

    const topLeft = this._map.latLngToLayerPoint([maxLat, minLng]);
    const bottomRight = this._map.latLngToLayerPoint([minLat, maxLng]);
    const width = Math.round(bottomRight.x - topLeft.x);
    const height = Math.round(bottomRight.y - topLeft.y);

    this._canvas.width = width;
    this._canvas.height = height;
    L.DomUtil.setPosition(this._canvas, topLeft);

    const ctx = this._canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    const cellW = width / GRID_COLS;
    const cellH = height / GRID_ROWS;

    for (let r = 0; r < GRID_ROWS; r++) {
      const canvasRow = GRID_ROWS - 1 - r;
      for (let c = 0; c < GRID_COLS; c++) {
        const idx = r * GRID_COLS + c;
        const pixelBase = idx * 4;
        const alpha = this._rgba[pixelBase + 3];
        if (alpha === 0) continue;

        ctx.fillStyle = `rgb(${this._rgba[pixelBase]},${this._rgba[pixelBase + 1]},${this._rgba[pixelBase + 2]})`;
        ctx.globalAlpha = alpha / 255;

        const px = Math.floor(c * cellW);
        const py = Math.floor(canvasRow * cellH);
        const pw = Math.floor((c + 1) * cellW) - px + 1;
        const ph = Math.floor((canvasRow + 1) * cellH) - py + 1;
        ctx.fillRect(px, py, pw, ph);
      }
    }
    ctx.globalAlpha = 1;
  },
});

let heatmapLayer = null;
let heatmapWorker = null;
```

- [ ] **Step 3: Add worker init and `loadAggregates`**

```javascript
const MAX_RADIUS_KM = 1.5;
const DENSITY_SATURATION = 3;

function initWorker() {
  heatmapWorker = new Worker('grid-worker.js', { type: 'module' });
  heatmapWorker.onmessage = ({ data }) => {
    if (data.type !== 'result') return;
    heatmapLayer.update(new Uint8ClampedArray(data.rgba));
  };
}

async function loadAggregates() {
  const snapshot = await getDocs(collection(db, COLLECTION));

  const submissions = [];
  snapshot.forEach(docSnap => {
    const d = docSnap.data();
    if (d.lat != null && d.lng != null && d.name) {
      submissions.push({ lat: d.lat, lng: d.lng, name: d.name });
    }
  });

  if (submissions.length === 0) return;

  const registryForWorker = registry.map(({ name, color }) => ({ name, color }));
  const maskCopy = inTorontoMask.slice();

  heatmapWorker.postMessage({
    type: 'compute',
    submissions,
    registry: registryForWorker,
    gridBbox,
    cols: GRID_COLS,
    rows: GRID_ROWS,
    maskBuffer: maskCopy.buffer,
    maxRadiusKm: MAX_RADIUS_KM,
    densitySaturation: DENSITY_SATURATION,
  }, [maskCopy.buffer]);
}
```

- [ ] **Step 4: Wire worker/layer into bootstrap**

Update `init()` (previously set up in Task 9) to also initialize the worker and heatmap layer, and to render once on load:

```javascript
async function init() {
  initWorker();
  heatmapLayer = new HeatmapCanvasLayer();
  heatmapLayer.addTo(map);

  await loadBoundary();

  const [neighbourhoodsRes, curatedRes] = await Promise.all([
    fetch('data/toronto-neighbourhoods.geojson'),
    fetch('data/curated-names.json'),
  ]);
  const officialFeatureCollection = await neighbourhoodsRes.json();
  const curatedNames = await curatedRes.json();

  const rawRegistry = buildRegistry(officialFeatureCollection, curatedNames);
  registry = assignColors(rawRegistry, PALETTE, ASSIGN_COLOR_RADIUS_KM).map(entry => ({
    ...entry,
    color: PALETTE[entry.colorIndex],
  }));

  await loadAggregates();
}
init();
```

- [ ] **Step 5: Verify the load-time render in browser**

Reload the page. With no submissions yet, the map should just show the boundary/mask with no coloured cells (empty Firestore collection → `loadAggregates` returns early). No console errors.

- [ ] **Step 6: Add tenure selection and rate-limit helpers**

`chosenTenure` and `updateSubmitEnabled` already exist from Task 9 — this only adds the button wiring that assigns to them:

```javascript
const MAX_SUBMISSIONS_PER_BROWSER = 20;

document.querySelectorAll('.tenure-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    chosenTenure = btn.dataset.tenure;
    document.querySelectorAll('.tenure-btn').forEach(b => b.classList.toggle('selected', b === btn));
    updateSubmitEnabled();
  });
});

function getUserId() {
  let id = localStorage.getItem('torontonaming_uuid');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('torontonaming_uuid', id);
  }
  return id;
}
const userId = getUserId();

function getSubmissionCount() {
  return Number(localStorage.getItem('torontonaming_submit_count') || '0');
}

function incrementSubmissionCount() {
  localStorage.setItem('torontonaming_submit_count', String(getSubmissionCount() + 1));
}

let lastSubmittedPin = null;
```

- [ ] **Step 7: Add the submit handler, including the own-pin highlight**

By this step, `loadAggregates`, `chosenName`, `chosenTenure`, `getSubmissionCount`, `incrementSubmissionCount`, and `lastSubmittedPin` are all already declared earlier in the file, so nothing here is a forward reference:

```javascript
document.getElementById('btn-submit').addEventListener('click', async () => {
  if (!pendingPin || !chosenName || !chosenTenure) return;

  if (getSubmissionCount() >= MAX_SUBMISSIONS_PER_BROWSER) {
    showToast("You've submitted the maximum number of answers from this browser.");
    return;
  }

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  await addDoc(collection(db, COLLECTION), {
    lat: pendingPin.lat,
    lng: pendingPin.lng,
    name: chosenName,
    tenure: chosenTenure,
    browserId: userId,
    ts: serverTimestamp(),
  });

  incrementSubmissionCount();
  lastSubmittedPin = pendingPin;

  closePicker();
  showToast('Thanks! Your answer has been recorded.');

  btn.disabled = false;
  btn.textContent = 'Submit my answer';

  await loadAggregates();

  if (pinMarker) map.removeLayer(pinMarker);
  pinMarker = L.marker(lastSubmittedPin, {
    icon: L.divIcon({ className: 'pin-marker', html: '<div class="pin-dot pin-dot-mine"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
    interactive: false,
  }).addTo(map);
});
```

- [ ] **Step 8: Add the own-pin marker CSS**

```css
.pin-dot-mine {
  background: #fff;
  border-color: #e63946;
  border-width: 3px;
}
```

- [ ] **Step 9: Verify the full submit-then-render flow against the real Firebase project**

Drop a pin, pick a name, pick a tenure, submit. Check the Firebase console — a new document should appear in the `submissions` collection with `lat`, `lng`, `name`, `tenure`, `browserId`, `ts`. The map should immediately re-render with a coloured cell near your pin, and your pin should switch to the distinct white-filled "mine" marker. Submit again from a different pin with a different name (use an incognito window or a second browser first to simulate "other respondents" so there's more than one data point) — confirm a second, separate Firestore document appears (not an overwrite of the first), and that the map now shows a visible blend between the two differently-named areas rather than a hard edge. Manually set `localStorage.torontonaming_submit_count` to `20` in DevTools and try submitting again — expect the rate-limit toast and no new document.

- [ ] **Step 10: Commit**

```bash
git add app.js style.css
git commit -m "feat: Firestore submission and blended heatmap rendering via grid-worker"
```

---

### Task 11: Dark basemap, labels, and mandatory name-text labelling

**Files:**
- Modify: `app.js`
- Modify: `style.css`

This task is also where the palette's accessibility requirement from Global Constraints is satisfied: because a full 8-hue categorical palette can't clear strict "all visible at once" CVD-safety past its first 3 slots, every confidently-coloured area on the map must also show its dominant name as visible text — identity is never colour-alone.

**Interfaces:**
- Produces: nothing consumed by later tasks — this is presentation-layer, terminal for the plan.

- [ ] **Step 1: Swap to the dark CartoDB basemap and add a labels-only layer**

Replace the `L.tileLayer(...)` call added in Task 7 with:

```javascript
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
  maxZoom: 19,
}).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
  maxZoom: 19,
  pane: 'labelsPane',
}).addTo(map);
```

- [ ] **Step 2: Update the mask colour for the dark theme**

In `renderMask()`, change the style to a dark-surface-matching mask:

```javascript
  L.geoJSON(mask, {
    style: { fillColor: '#0d0d0d', fillOpacity: 0.55, color: '#333', weight: 1.5 },
    pane: 'maskPane',
    interactive: false,
  }).addTo(map);
```

- [ ] **Step 3: Add dominant-name text labels on confidently-coloured cells**

This is the accessibility mitigation, not just decoration — it must run whenever the heatmap updates. Add after `HeatmapCanvasLayer` and before `initWorker`:

```javascript
let nameLabelMarkers = [];
const LABEL_OPACITY_THRESHOLD = 0.5; // only label cells confident enough to read as "settled"

function updateNameLabels(rgba, submissions) {
  nameLabelMarkers.forEach(m => map.removeLayer(m));
  nameLabelMarkers = [];

  const colorToName = new Map(registry.map(e => [`${e.color.r},${e.color.g},${e.color.b}`, e.name]));

  // Group confidently-coloured cells by exact colour, then place one label
  // per connected component so a name isn't repeated dozens of times.
  const total = GRID_COLS * GRID_ROWS;
  const confident = new Uint8Array(total);
  const nameAt = new Array(total).fill(null);

  for (let i = 0; i < total; i++) {
    const base = i * 4;
    const alpha = rgba[base + 3] / 255;
    if (alpha < LABEL_OPACITY_THRESHOLD) continue;
    const key = `${rgba[base]},${rgba[base + 1]},${rgba[base + 2]}`;
    const name = colorToName.get(key);
    if (!name) continue;
    confident[i] = 1;
    nameAt[i] = name;
  }

  const visited = new Uint8Array(total);
  for (let start = 0; start < total; start++) {
    if (!confident[start] || visited[start]) continue;
    const name = nameAt[start];
    const queue = [start];
    visited[start] = 1;
    let sumLng = 0, sumLat = 0, count = 0, qi = 0;

    while (qi < queue.length) {
      const idx = queue[qi++];
      sumLng += cellCentroids[idx * 2];
      sumLat += cellCentroids[idx * 2 + 1];
      count++;
      const r = Math.floor(idx / GRID_COLS), c = idx % GRID_COLS;
      for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
        if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) continue;
        const ni = nr * GRID_COLS + nc;
        if (confident[ni] && nameAt[ni] === name && !visited[ni]) {
          visited[ni] = 1;
          queue.push(ni);
        }
      }
    }

    if (count < 3) continue; // skip single-cell specks, too small to label legibly

    const marker = L.marker([sumLat / count, sumLng / count], {
      icon: L.divIcon({
        className: 'name-label',
        html: `<span>${name}</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
      interactive: false,
      pane: 'labelsPane',
    }).addTo(map);
    nameLabelMarkers.push(marker);
  }
}
```

- [ ] **Step 4: Call `updateNameLabels` wherever the heatmap updates**

`loadAggregates()` (Task 10) already posts `submissions` to the worker — no change needed there. What's missing is the worker returning those same submissions back in its result, so the label pass has them without needing a second Firestore read. Update `initWorker()`'s `onmessage` handler:

```javascript
function initWorker() {
  heatmapWorker = new Worker('grid-worker.js', { type: 'module' });
  heatmapWorker.onmessage = ({ data }) => {
    if (data.type !== 'result') return;
    const rgba = new Uint8ClampedArray(data.rgba);
    heatmapLayer.update(rgba);
    updateNameLabels(rgba, data.submissions);
  };
}
```

And have `grid-worker.js` pass `submissions` through unchanged in its result. Update `grid-worker.js`'s final `postMessage` call (Task 6) to:

```javascript
  self.postMessage({ type: 'result', rgba: rgba.buffer, submissions: data.submissions }, [rgba.buffer]);
```

(`submissions` here is small — capped by realistic early-stage submission volume — so sending it back by value, not by transfer, is fine.)

- [ ] **Step 5: Add label CSS**

```css
.name-label {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  pointer-events: none;
  overflow: visible !important;
}

.name-label span {
  display: inline-block;
  position: absolute;
  transform: translate(-50%, -50%);
  font-family: 'Inter', -apple-system, sans-serif;
  font-weight: 700;
  font-size: 12px;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,0.8);
  white-space: nowrap;
}
```

- [ ] **Step 6: Verify in browser against the reference look**

Reload, submit a handful of test answers with different names close together. Confirm: dark basemap with light street labels showing through, soft blended colour regions, and visible white name-text over confidently-coloured areas (not just colour) — matching the "identity is never colour-alone" requirement and visually closer to the NYT-style reference screenshot.

- [ ] **Step 7: Commit**

```bash
git add app.js style.css grid-worker.js
git commit -m "feat: dark basemap, labels, and mandatory name-text labelling for accessibility"
```

---

### Task 12: GitHub repo + Pages deployment

**Files:** none (repo/hosting configuration only)

- [ ] **Step 1: Create GitHub repo and push**

```bash
gh repo create 2026-personal-torontonaming --public --source=. --remote=origin --push
```

- [ ] **Step 2: Enable GitHub Pages**

On github.com: repo → Settings → Pages → Source: Deploy from branch → Branch: `main` → folder: `/ (root)` → Save.

- [ ] **Step 3: Verify deployment**

Visit `https://<username>.github.io/2026-personal-torontonaming/`. The page should load and behave identically to the local server.

- [ ] **Step 4: Update Firebase authorized domains**

In the Firebase console → Authentication → Settings → Authorized domains, add the GitHub Pages domain (`<username>.github.io`).

- [ ] **Step 5: No commit needed** (hosting configuration only)

---

## Self-Review Notes

- **Spec coverage:** pin-drop (Task 8), list-only nearby-filtered name search (Task 9), tenure capture + Firestore auto-ID submissions with rate limit + immediate post-submit blended heatmap (Task 10), dark screenshot-matching aesthetic (Task 11), deployment (Task 12) — every section of the design doc has a corresponding task.
- **Data-source correction carried through:** the plan downloads `toronto-neighbourhoods.geojson` fresh (Task 1) rather than assuming it can be copied from eastwesttoronto, consistent with the design doc fix made before this plan was written.
- **Palette accessibility gap:** flagged explicitly in Global Constraints and resolved architecturally in Task 11 (mandatory text labels), not glossed over.
- **Type/interface consistency checked:** `registry` entries carry `{ name, lat, lng, source, colorIndex, color }` consistently from Task 4 (names.js) through Tasks 9, 10, 11 in app.js, and `grid-worker.js` only ever reads `{ name, color }` off registry entries, never `colorIndex` directly — `app.js` resolves the palette lookup before posting, exactly as described in Task 6's note.
- **Sequencing bugs found and fixed during self-review:** Task 9's click handler originally referenced `chosenTenure`/`updateSubmitEnabled` before they existed (moved into Task 9 itself, since Task 9's own browser-verification step needed them). Tasks 10 and 11 were originally split (submit vs. render) with the submit handler forward-referencing a not-yet-defined `loadAggregates` — merged into one task since submit-then-render is a single flow, with steps reordered so every declaration precedes its use.
