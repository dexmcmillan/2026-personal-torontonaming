// grid-worker.js
import { computeCellBlend, dominantName } from './blend.js';

self.onmessage = ({ data }) => {
  if (data.type !== 'compute') return;

  const { submissions, registry, gridBbox, cols, rows, maskBuffer, maxRadiusKm, densitySaturation } = data;
  const [minLng, minLat, maxLng, maxLat] = gridBbox;
  const cellW = (maxLng - minLng) / cols;
  const cellH = (maxLat - minLat) / rows;
  const mask = new Uint8Array(maskBuffer);

  const colorLookup = new Map(registry.map(entry => [entry.name, entry.color]));

  const rgba = new Uint8ClampedArray(cols * rows * 4);
  const names = new Array(cols * rows).fill(null);

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

      names[idx] = dominantName(cellLatLng, submissions, maxRadiusKm);
    }
  }

  self.postMessage({ type: 'result', rgba: rgba.buffer, names }, [rgba.buffer]);
};
