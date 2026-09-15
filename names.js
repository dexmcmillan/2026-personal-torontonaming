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
