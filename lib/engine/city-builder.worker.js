// Web Worker entry for city geometry (plan 19.1).
import { buildCityGeometry } from "@/lib/engine/city-builder-core";

self.onmessage = (e) => {
  const { id, elements, lat0, lon0, terrainTiles } = e.data || {};
  const startedAt = performance.now();
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
    self.postMessage({
      id,
      type: "done",
      result,
      metrics: {
        computeMs: performance.now() - startedAt,
        outputBufferBytes: transfers.reduce((sum, buffer) => sum + buffer.byteLength, 0),
      },
    }, transfers);
  } catch (err) {
    self.postMessage({ id, type: "error", error: err?.message || String(err) });
  }
};
