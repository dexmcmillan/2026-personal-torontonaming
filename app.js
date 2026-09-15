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
