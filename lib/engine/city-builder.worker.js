// Web Worker entry for city geometry (plan 19.1).
import { buildCityGeometry } from "@/lib/engine/city-builder-core";

self.onmessage = (e) => {
  const { id, elements, lat0, lon0, terrainTiles, profileQueries, roadQueryMode } = e.data || {};
  const startedAt = performance.now();
  try {
    const { result, transfers, queryMetrics } = buildCityGeometry({
      elements,
      lat0,
      lon0,
      terrainTiles,
      profileQueries,
      roadQueryMode,
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
        queryMetrics,
      },
    }, transfers);
  } catch (err) {
    self.postMessage({ id, type: "error", error: err?.message || String(err) });
  }
};
