# Toronto Neighbourhood Naming — Design Doc

**Date:** 2026-09-14
**Project:** `2026-personal-torontonaming`
**Hosting:** GitHub Pages (static)
**Persistence:** Firebase Firestore (new project, separate from eastwesttoronto)

---

## Overview

A public-facing interactive web tool, inspired by the NYT Upshot piece
["Draw Your NYC Neighborhood"](https://www.nytimes.com/interactive/2022/12/02/upshot/draw-your-nyc-neighborhood.html),
adapted for Toronto with a simpler, point-based mechanic: instead of
drawing a boundary, a visitor drops a pin at their home location and
picks what they call their neighbourhood from a list of nearby names.
Aggregated across visitors, this produces a soft, blended, categorical
map showing which names dominate which parts of the city — and where
neighbourhood identity is contested (multiple names blending at a
boundary) versus settled (one colour, sharply confident).

This is a sibling project to `2026-personal-eastwesttoronto` and
reuses its stack and several of its rendering patterns, but the
interaction model is materially different (no freehand drawing; a
pin + categorical pick instead of a line/shape).

---

## Interaction Flow

1. Visitor loads a Leaflet map of Toronto (dark basemap, styled after
   the reference screenshot).
2. Visitor taps/clicks their home location to drop a pin. No address
   search, no geocoding service, no API key — consistent with
   eastwesttoronto's no-backend-dependency approach.
3. A searchable dropdown appears, pre-filtered to neighbourhood names
   geographically near the pin (nearest ~10-15 by distance from pin
   to each name's reference point), ranked closest-first. Visitor can
   type to filter/search within that nearby set. **List-only** — no
   freeform "other" entry.
4. Visitor picks a tenure bucket: `<1 year`, `1–5 years`, `5–10
   years`, `10+ years`.
5. Visitor submits. This writes one Firestore document (see Data
   Model).
6. Immediately after submitting, the view switches to the full-city
   blended heatmap (see Rendering), with the visitor's own pin
   highlighted so they can see how their answer fits the wider
   picture.
7. Visitor can submit again from a different pin (e.g. to answer for
   a second address) — same per-browser-UUID overwrite pattern as
   eastwesttoronto, keyed this time by pin location rather than a
   single fixed answer, so a new pin should create a **new** document
   rather than overwrite (a person may reasonably want to log more
   than one address, e.g. current + childhood home). Open question
   resolved below under Data Model.

---

## Data Model

### Firestore schema

Collection: `submissions`
Document ID: auto-generated (not the per-browser UUID) — because a
single visitor may legitimately submit more than one pin (current
address, childhood neighbourhood, etc.), unlike eastwesttoronto's
one-answer-per-browser model.

```
submissions/{autoId}
  lat: number
  lng: number
  name: string            // one of the fixed dropdown names, verbatim
  tenure: string           // "<1" | "1-5" | "5-10" | "10+"
  browserId: string        // localStorage UUID, for rate-limiting/spam signal only — not used for overwrite
  timestamp: string        // ISO 8601
```

A lightweight client-side rate limit (e.g. no more than N submissions
per browser per session, or a short cooldown) should guard against
accidental double-submits and casual abuse, enforced client-side only
(consistent with eastwesttoronto's test-mode-Firestore, no-auth
approach) — this is a soft guard, not real spam protection.

### Reference name list

Two source lists, merged into one flat array at build/load time:

1. **Official City of Toronto neighbourhoods** (158 names, current
   2021-consolidation boundary set) — download fresh from the City of
   Toronto open data portal (open.toronto.ca, CKAN package
   `neighbourhoods`, the plain `Neighbourhoods - 4326.geojson`
   resource — not the "historical 140" resource, which suffixes names
   with numeric codes like "Brookhaven-Amesbury (30)"), saved as
   `data/toronto-neighbourhoods.geojson`. Note: this file is *not*
   available to reuse from `2026-personal-eastwesttoronto` — it was
   removed there during their refactor from per-neighbourhood
   colouring to a grid-based heatmap, so it must be re-downloaded.
   `AREA_NAME` is the name field. Reference point per name = polygon
   centroid (arithmetic mean of exterior-ring vertices — see `geo.js`
   in the plan).
2. **Curated informal/contested names** (~15-25 names) — names people
   actually use that aren't well captured by the official list (The
   Annex, Leslieville, Corktown, Liberty Village, The Junction, etc.,
   pending final curation). Authored by hand as
   `data/curated-names.json`: `[{ name, lat, lng }, ...]`, where
   `lat`/`lng` is a manually chosen representative point. Skip any
   curated name that's redundant with an official name at the same
   location.

Both lists are combined client-side at load time into one in-memory
registry giving every assignable name a `{ name, lat, lng,
colorIndex }` — no separate build step or committed merged-JSON
artifact, consistent with eastwesttoronto's no-build-step approach.
The name universe (~180 entries: 158 official + ~20-24 curated) is small enough that computing
this once per page load is trivial.

### Colour assignment

A fixed palette of ~6-8 hues (from the project's dataviz palette).
Because the rendering only needs *locally* distinct colours (two
names far apart in the city can safely share a colour, as the
reference screenshot does), colours are assigned once via a greedy
proximity-graph colouring: for each name, pick the first palette
colour not already used by another name within some radius (e.g.
~3km). This is deterministic given the same name list and palette, so
it's computed client-side at load time alongside the merged registry
above — no separate build artifact needed.

---

## Rendering — Blended Categorical Heatmap

A fine canvas grid covers Toronto's bounding box (starting point: 150×150
cells, tuned during implementation for visual quality vs. performance).
Cells outside the city boundary (reuse eastwesttoronto's
`data/toronto-boundary.geojson`) are masked out, matching
eastwesttoronto's existing mask approach.

For each grid cell:
1. Find nearby submissions (inverse-distance weighting — near
   submissions contribute more, a max search radius bounds the
   contribution set).
2. Group weighted contributions by name, sum weight per name.
3. Blend each name's assigned colour proportionally to its weight
   share in that cell (this produces the soft overlapping-colour-field
   look — a cell near a boundary between two dominant names blends
   both colours rather than hard-cutting).
4. Cell opacity scales with total nearby submission density/confidence
   — sparse data areas stay faint, dense/confident areas render
   vividly (same principle as eastwesttoronto's confidence-scaled
   opacity, extended to multi-colour).

Computation runs in a Web Worker (`grid-worker.js`, extending
eastwesttoronto's `heatmap-worker.js` pattern) and renders to a canvas
layer positioned above the mask, below labels — same z-ordering
eastwesttoronto already solved (`heatmapPane`, z=250).

**Performance note:** naive per-cell distance-to-every-submission is
O(cells × submissions). Fine at low submission volumes (matches
eastwesttoronto's current scale). If this project gets meaningfully
more traffic than eastwesttoronto, a spatial bucket/index for nearby-
submission lookups is a reasonable follow-up — not required for v1.

**Visual style:** dark basemap (CartoDB dark tiles) with light
labels, following the reference screenshot's look rather than
eastwesttoronto's light CartoDB basemap. Official neighbourhood/street
labels rendered as a labels-only tile layer above the heatmap, as
eastwesttoronto already does.

---

## Out of Scope (v1)

- Address search / geocoding.
- Freeform "my neighbourhood is called ___" text entry (deliberately
  list-only, per decision above).
- Tenure-segmented views (e.g. "what do newcomers call this area vs.
  longtimers") — tenure is captured now so this is possible later, but
  no UI for it in v1.
- Admin/editing UI for the curated name list — it's a static committed
  JSON file, edited by hand.
- Backend precomputation (Cloud Functions) — fully client-side for v1
  (see Approach A discussion, approved).

---

## Files

```
2026-personal-torontonaming/
├── index.html
├── style.css
├── app.js
├── grid-worker.js
├── data/
│   ├── toronto-boundary.geojson       (copied from eastwesttoronto)
│   ├── toronto-neighbourhoods.geojson (official AREA_NAME polygons, downloaded fresh from open.toronto.ca)
│   └── curated-names.json             (hand-authored informal/contested names)
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-09-14-torontonaming-design.md
└── .gitignore
```

---

## Firebase Setup (manual, one-time)

1. Create a new Firebase project (e.g. `torontonaming`) — separate
   from eastwesttoronto's, for clean data/quota isolation.
2. Enable Firestore in test mode (public read/write, same trust model
   as eastwesttoronto).
3. Copy the Firebase config object into `app.js`.
4. No authentication required — anonymous public access.

---

## Tech Stack

HTML5, CSS3, vanilla JS (ES modules), Leaflet.js 1.9 (CDN), Firebase
JS SDK v10 (CDN), GitHub Pages. Turf.js is likely unnecessary (no
polygon splitting in this design — only centroid/distance math for
the dropdown filter and colour assignment), but may be pulled in if
distance/geo helpers prove more convenient via Turf than hand-rolled
haversine math — implementation plan will decide.
