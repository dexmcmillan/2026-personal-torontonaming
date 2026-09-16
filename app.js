// app.js
import { buildRegistry, assignColors, nearbyNames } from './names.js';
import { PALETTE } from './palette.js';
import { weightBreakdown } from './blend.js';
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
let colorLookup = new Map();
let lastSubmissions = [];

const map = L.map('map', {
  zoomControl: true,
  minZoom: 10,
}).setView(TORONTO_CENTER, TORONTO_ZOOM);

map.createPane('labelsPane');
map.getPane('labelsPane').style.zIndex = 650;
map.getPane('labelsPane').style.pointerEvents = 'none';

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, and the GIS user community',
  maxZoom: 19,
  maxNativeZoom: 16,
}).addTo(map);

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  maxNativeZoom: 16,
  pane: 'labelsPane',
}).addTo(map);

map.createPane('heatmapPane');
map.getPane('heatmapPane').style.zIndex = 250;
map.getPane('heatmapPane').style.pointerEvents = 'none';

map.createPane('maskPane');
map.getPane('maskPane').style.zIndex = 300;
map.getPane('maskPane').style.pointerEvents = 'none';

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
    style: { fillColor: '#0d0d0d', fillOpacity: 0.55, color: '#333', weight: 1.5 },
    pane: 'maskPane',
    interactive: false,
  }).addTo(map);
}

const HeatmapCanvasLayer = L.Layer.extend({
  onAdd(map) {
    this._map = map;
    this._canvas = L.DomUtil.create('canvas', 'heatmap-canvas leaflet-zoom-animated');
    this._canvas.style.position = 'absolute';
    this._canvas.style.pointerEvents = 'none';
    map.getPane('heatmapPane').appendChild(this._canvas);
    map.on('moveend zoomend', this._redraw, this);
    if (map.options.zoomAnimation) {
      map.on('zoomanim', this._animateZoom, this);
    }
  },

  onRemove(map) {
    this._canvas.remove();
    map.off('moveend zoomend', this._redraw, this);
    map.off('zoomanim', this._animateZoom, this);
  },

  update(rgba) {
    this._rgba = rgba;
    this._redraw();
  },

  // Keeps the canvas visually locked to the basemap during Leaflet's CSS
  // zoom animation — without this, the canvas only repaints on 'zoomend'
  // and visibly lags a beat behind the tiles, then snaps into place.
  // `this._bounds` is the geographic area the canvas currently covers
  // (set in _redraw), not the whole city — see _redraw for why.
  _animateZoom(e) {
    if (!this._bounds) return;
    const scale = this._map.getZoomScale(e.zoom);
    const offset = this._map._latLngBoundsToNewLayerBounds(this._bounds, e.zoom, e.center).min;
    L.DomUtil.setTransform(this._canvas, offset, scale);
  },

  _redraw() {
    if (!this._rgba || !gridBbox) return;
    const [minLng, minLat, maxLng, maxLat] = gridBbox;

    // Cell size comes from the full Toronto bbox projected at the current
    // zoom (cells legitimately grow on screen as you zoom in) — but the
    // canvas element itself is capped to the current viewport's pixel
    // size, never the whole city's. At deep zoom the whole-city bbox
    // projects to hundreds of thousands of pixels per side, which exceeds
    // what browsers allow a <canvas> to be, silently blanking it out.
    const bboxTopLeft = this._map.latLngToLayerPoint([maxLat, minLng]);
    const bboxBottomRight = this._map.latLngToLayerPoint([minLat, maxLng]);
    const fullWidth = bboxBottomRight.x - bboxTopLeft.x;
    const fullHeight = bboxBottomRight.y - bboxTopLeft.y;

    const size = this._map.getSize();
    const viewportTopLeft = this._map.containerPointToLayerPoint([0, 0]);
    const viewportBottomRight = L.point(viewportTopLeft.x + size.x, viewportTopLeft.y + size.y);

    this._canvas.width = size.x;
    this._canvas.height = size.y;
    L.DomUtil.setPosition(this._canvas, viewportTopLeft);
    this._bounds = L.latLngBounds(
      this._map.layerPointToLatLng(viewportTopLeft),
      this._map.layerPointToLatLng(viewportBottomRight)
    );

    const ctx = this._canvas.getContext('2d');
    ctx.clearRect(0, 0, size.x, size.y);

    const cellW = fullWidth / GRID_COLS;
    const cellH = fullHeight / GRID_ROWS;
    const offsetX = viewportTopLeft.x - bboxTopLeft.x;
    const offsetY = viewportTopLeft.y - bboxTopLeft.y;

    for (let r = 0; r < GRID_ROWS; r++) {
      const canvasRow = GRID_ROWS - 1 - r;
      for (let c = 0; c < GRID_COLS; c++) {
        const idx = r * GRID_COLS + c;
        const pixelBase = idx * 4;
        const alpha = this._rgba[pixelBase + 3];
        if (alpha === 0) continue;

        const cellLeft = c * cellW - offsetX;
        const cellTop = canvasRow * cellH - offsetY;
        if (cellLeft + cellW < 0 || cellLeft > size.x || cellTop + cellH < 0 || cellTop > size.y) continue;

        ctx.fillStyle = `rgb(${this._rgba[pixelBase]},${this._rgba[pixelBase + 1]},${this._rgba[pixelBase + 2]})`;
        ctx.globalAlpha = alpha / 255;

        const px = Math.floor(cellLeft);
        const py = Math.floor(cellTop);
        const pw = Math.floor(cellLeft + cellW) - px + 1;
        const ph = Math.floor(cellTop + cellH) - py + 1;
        ctx.fillRect(px, py, pw, ph);
      }
    }
    ctx.globalAlpha = 1;
  },
});

let nameLabelMarkers = [];
const LABEL_OPACITY_THRESHOLD = 0.5; // only label cells confident enough to read as "settled"

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function updateNameLabels(rgba, names) {
  nameLabelMarkers.forEach(m => map.removeLayer(m));
  nameLabelMarkers = [];

  // Group cells that share the same dominant name into connected components,
  // then place one label per component so a name isn't repeated dozens of times.
  const total = GRID_COLS * GRID_ROWS;
  const confident = new Uint8Array(total);
  const nameAt = new Array(total).fill(null);

  for (let i = 0; i < total; i++) {
    const base = i * 4;
    const alpha = rgba[base + 3] / 255;
    if (alpha < LABEL_OPACITY_THRESHOLD) continue;
    const name = names[i];
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
        html: `<span>${escapeHtml(name)}</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
      interactive: false,
      pane: 'labelsPane',
    }).addTo(map);
    nameLabelMarkers.push(marker);
  }
}

let heatmapLayer = null;
let heatmapWorker = null;

const MAX_RADIUS_KM = 1.5;
const DENSITY_SATURATION = 3;

function initWorker() {
  heatmapWorker = new Worker('grid-worker.js', { type: 'module' });
  heatmapWorker.onmessage = ({ data }) => {
    if (data.type !== 'result') return;
    const rgba = new Uint8ClampedArray(data.rgba);
    heatmapLayer.update(rgba);
    updateNameLabels(rgba, data.names);
  };
}

async function loadAggregates() {
  const snapshot = await getDocs(collection(db, COLLECTION));

  const registryNames = new Set(registry.map(e => e.name));
  const submissions = [];
  snapshot.forEach(docSnap => {
    const d = docSnap.data();
    if (Number.isFinite(d.lat) && Number.isFinite(d.lng) &&
        typeof d.name === 'string' && registryNames.has(d.name)) {
      submissions.push({ lat: d.lat, lng: d.lng, name: d.name });
    }
  });

  lastSubmissions = submissions;

  if (submissions.length === 0) {
    heatmapLayer.update(new Uint8ClampedArray(GRID_COLS * GRID_ROWS * 4));
    updateNameLabels(new Uint8ClampedArray(GRID_COLS * GRID_ROWS * 4), new Array(GRID_COLS * GRID_ROWS).fill(null));
    return;
  }

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
}

async function init() {
  try {
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
    colorLookup = new Map(registry.map(e => [e.name, e.color]));

    await loadAggregates();

    document.getElementById('loading').classList.add('hidden');
  } catch (err) {
    console.error('Failed to initialize app:', err);
    document.querySelector('#loading p').textContent = 'Something went wrong loading the map. Please refresh.';
  }
}
init();

let pendingPin = null;
let pinMarker = null;

document.getElementById('btn-confirm-location').addEventListener('click', () => {
  if (!torontoFeature) return;
  const center = map.getCenter();
  if (!turf.booleanPointInPolygon(turf.point([center.lng, center.lat]), torontoFeature)) {
    showToast("That's outside Toronto — pan the map so the pin sits inside the boundary.");
    return;
  }

  pendingPin = { lat: center.lat, lng: center.lng };
  chosenName = null;
  chosenTenure = null;

  document.getElementById('picker-step-name').classList.remove('hidden');
  document.getElementById('picker-step-tenure').classList.add('hidden');
  document.getElementById('name-search').value = '';
  document.querySelectorAll('.tenure-btn').forEach(b => b.classList.remove('selected'));
  updateSubmitEnabled();
  populateNameOptions(pendingPin);
  openPicker();
});

let toastTimer = null;

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

function openPicker() {
  document.getElementById('picker-modal').classList.remove('hidden');
  document.getElementById('center-pin').classList.add('hidden');
  document.getElementById('btn-confirm-location').classList.add('hidden');
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
  document.getElementById('center-pin').classList.remove('hidden');
  document.getElementById('btn-confirm-location').classList.remove('hidden');
}

document.getElementById('btn-cancel-pin').addEventListener('click', () => {
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

  try {
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

    await loadAggregates();

    if (pinMarker) map.removeLayer(pinMarker);
    pinMarker = L.marker(lastSubmittedPin, {
      icon: L.divIcon({ className: 'pin-marker', html: '<div class="pin-dot pin-dot-mine"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
      interactive: false,
    }).addTo(map);
  } catch (err) {
    console.error('Failed to submit answer:', err);
    showToast('Something went wrong — please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit my answer';
  }
});

// ── Hover breakdown tooltip ─────────────────────────────────────────────────

function getCellIndexForLatLng(lat, lng) {
  if (!gridBbox) return null;
  const [minLng, minLat, maxLng, maxLat] = gridBbox;
  if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return null;

  const cellW = (maxLng - minLng) / GRID_COLS;
  const cellH = (maxLat - minLat) / GRID_ROWS;
  const c = Math.floor((lng - minLng) / cellW);
  const r = Math.floor((lat - minLat) / cellH);
  if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) return null;
  return r * GRID_COLS + c;
}

const hoverTooltip = L.tooltip({ direction: 'top', offset: [0, -8], className: 'hover-breakdown', sticky: true });

map.on('mousemove', e => {
  const idx = getCellIndexForLatLng(e.latlng.lat, e.latlng.lng);
  if (idx === null || !inTorontoMask[idx]) {
    map.closeTooltip(hoverTooltip);
    return;
  }

  const cellLatLng = { lng: cellCentroids[idx * 2], lat: cellCentroids[idx * 2 + 1] };
  const breakdown = weightBreakdown(cellLatLng, lastSubmissions, MAX_RADIUS_KM, colorLookup);

  if (breakdown.length === 0) {
    map.closeTooltip(hoverTooltip);
    return;
  }

  const content = breakdown
    .map(b => `${escapeHtml(b.name)} — ${Math.round(b.percent)}%`)
    .join('<br>');
  hoverTooltip.setLatLng(e.latlng).setContent(content);
  if (!map.hasLayer(hoverTooltip)) hoverTooltip.addTo(map);
});

map.on('mouseout', () => map.closeTooltip(hoverTooltip));
