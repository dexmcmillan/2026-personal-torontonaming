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
