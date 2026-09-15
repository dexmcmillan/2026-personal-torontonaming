// app.js
import { buildRegistry, assignColors, nearbyNames } from './names.js';
import { PALETTE } from './palette.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getFirestore, collection, addDoc, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyDsCciW4Y2p50qYLOLkkdkINJY_d7vb1Pc",
  authDomain: "neighbourhoods-66aef.firebaseapp.com",
  projectId: "neighbourhoods-66aef",
  storageBucket: "neighbourhoods-66aef.firebasestorage.app",
  messagingSenderId: "228480970326",
  appId: "1:228480970326:web:947c7da8183ba4b8c095f7"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const COLLECTION = 'submissions';

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
