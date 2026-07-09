// Web Worker entry for city geometry (plan 19.1).
import { buildCityGeometry } from "@/lib/engine/city-builder-core";

self.onmessage = (e) => {
  const { id, elements, lat0, lon0, terrainTiles } = e.data || {};
  try {
    const { result, transfers } = buildCityGeometry({
      elements,
      lat0,
      lon0,
      terrainTiles,
      onProgress: (done, total) => {
        self.postMessage({ id, type: "progress", done, total });
      },
    });
    self.postMessage({ id, type: "done", result }, transfers);
  } catch (err) {
    self.postMessage({ id, type: "error", error: err?.message || String(err) });
  }
};
