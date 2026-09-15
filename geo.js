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
