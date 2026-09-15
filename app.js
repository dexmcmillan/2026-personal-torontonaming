// app.js
import { buildRegistry, assignColors, nearbyNames } from './names.js';
import { PALETTE } from './palette.js';

const TORONTO_CENTER = [43.7181, -79.3762];
const TORONTO_ZOOM = 11;
const GRID_COLS = 160;
const GRID_ROWS = 160;
const NEARBY_NAME_COUNT = 12;
const ASSIGN_COLOR_RADIUS_KM = 3;

let registry = [];

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

let pendingPin = null;
let pinMarker = null;

const pinIcon = L.divIcon({
  className: 'pin-marker',
  html: '<div class="pin-dot"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

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
  document.querySelectorAll('.tenure-btn').forEach(b => b.classList.remove('selected'));
  updateSubmitEnabled();
  populateNameOptions(pendingPin);
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

document.getElementById('name-search').addEventListener('input', e => {
  const query = e.target.value.trim().toLowerCase();
  const nearby = nearbyNames(registry, pendingPin, NEARBY_NAME_COUNT);
  const filtered = query
    ? nearby.filter(entry => entry.name.toLowerCase().includes(query))
    : nearby;
  renderNameOptions(filtered);
});

function selectName(name) {
  chosenName = name;
  document.querySelectorAll('#name-options li').forEach(li => {
    li.classList.toggle('selected', li.dataset.name === name);
  });
  updateSubmitEnabled();
  document.getElementById('picker-step-name').classList.add('hidden');
  document.getElementById('picker-step-tenure').classList.remove('hidden');
}

function closePicker() {
  document.getElementById('picker-modal').classList.add('hidden');
}

document.getElementById('btn-cancel-pin').addEventListener('click', () => {
  if (pinMarker) { map.removeLayer(pinMarker); pinMarker = null; }
  pendingPin = null;
  closePicker();
});
