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

export function weightBreakdown(cellLatLng, submissions, maxRadiusKm, colorLookup) {
  const weightByName = new Map();
  let totalWeight = 0;
  for (const sub of submissions) {
    if (!colorLookup.has(sub.name)) continue;
    const distanceKm = haversineDistanceKm(cellLatLng, sub);
    const weight = idwWeight(distanceKm, maxRadiusKm);
    if (weight <= 0) continue;
    weightByName.set(sub.name, (weightByName.get(sub.name) || 0) + weight);
    totalWeight += weight;
  }
  if (totalWeight === 0) return [];
  return [...weightByName.entries()]
    .map(([name, weight]) => ({ name, percent: (weight / totalWeight) * 100 }))
    .sort((a, b) => b.percent - a.percent);
}

export function dominantName(cellLatLng, submissions, maxRadiusKm, colorLookup) {
  const weightByName = new Map();
  for (const sub of submissions) {
    if (!colorLookup.has(sub.name)) continue;
    const distanceKm = haversineDistanceKm(cellLatLng, sub);
    const weight = idwWeight(distanceKm, maxRadiusKm);
    if (weight <= 0) continue;
    weightByName.set(sub.name, (weightByName.get(sub.name) || 0) + weight);
  }
  if (weightByName.size === 0) return null;
  let bestName = null;
  let bestWeight = -Infinity;
  for (const [name, weight] of weightByName) {
    if (weight > bestWeight) { bestWeight = weight; bestName = name; }
  }
  return bestName;
}
