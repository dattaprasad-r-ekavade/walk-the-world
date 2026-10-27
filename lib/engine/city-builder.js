// Main-thread helper: run city geometry in a Worker with transferable buffers.
import * as THREE from "three";
import { recordPerfTiming } from "@/lib/perf";


/** Rebuild a BufferGeometry from a transferable descriptor. */
export function geometryFromTransfer(desc) {
  if (!desc) return null;
  const geo = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(desc)) {
    if (name === "index") continue;
    if (!attr?.array) continue;
    geo.setAttribute(
      name,
      new THREE.BufferAttribute(attr.array, attr.itemSize, attr.normalized)
    );
  }
  if (desc.index) geo.setIndex(new THREE.BufferAttribute(desc.index, 1));
  return geo;
}

function packTerrainTiles(terrainTiles) {
  return [...terrainTiles.entries()].map(([key, t]) => ({
    key,
    // copy so posting to the worker never detaches the live heightmap
    heights: t.heights.slice(),
    n: t.n,
    x0: t.x0,
    z0: t.z0,
    sizeX: t.sizeX,
    sizeZ: t.sizeZ,
  }));
}

/** Two reusable workers owned by one mounted engine. */
export function createCityBuilderPool({
  size = 2,
  maxQueueSize = size * 4,
  workerFactory = () => new Worker(new URL("./city-builder.worker.js", import.meta.url)),
} = {}) {
  const slots = Array.from({ length: size }, () => ({ worker: null, job: null }));
  const queue = [];
  let closed = false, sequence = 0;
  const queueLimit = Math.max(0, Math.floor(maxQueueSize));
  function pump() {
    if (closed) return;
    for (const slot of slots) {
      if (slot.job || !queue.length) continue;
      const job = queue.shift();
      slot.job = job;
      job.slot = slot;
      try {
        if (!slot.worker) {
          const worker = workerFactory();
          slot.worker = worker;
          worker.onmessage = ({ data }) => {
            if (slot.worker !== worker) return;
            const active = slot.job;
            if (!active || active.finished || data.id !== active.id) return;
            if (data.type === "progress") { active.args.onProgress?.(data.done, data.total); return; }
            if (data.type === "done") {
              const receivedAt = performance.now();
              recordPerfTiming("city.worker-roundtrip", receivedAt - (active.postedAt ?? receivedAt), {
                elements: active.args.elements?.length || 0,
                outputBufferBytes: data.metrics?.outputBufferBytes ?? null,
              });
              if (Number.isFinite(data.metrics?.computeMs)) {
                recordPerfTiming("city.worker-compute", data.metrics.computeMs, {
                  elements: active.args.elements?.length || 0,
                });
              }
              if (Number.isFinite(data.metrics?.queryMetrics?.roadPoiQueryMs)) {
                recordPerfTiming("city.worker-poi-road-query", data.metrics.queryMetrics.roadPoiQueryMs, {
                  elements: active.args.elements?.length || 0,
                  queries: data.metrics.queryMetrics.roadPoiQueries,
                  segmentTests: data.metrics.queryMetrics.roadSegmentTests,
                  fullScanSegmentTests: data.metrics.queryMetrics.roadFullScanSegmentTests,
                  roadPaths: data.metrics.queryMetrics.roadPathCount,
                  pois: data.metrics.queryMetrics.poiCount,
                  indexBuildMs: data.metrics.queryMetrics.roadIndexBuildMs,
                  indexedSegments: data.metrics.queryMetrics.indexedRoadSegments,
                  mode: data.metrics.queryMetrics.roadQueryMode,
                });
              }
            }
            settle(active, data.type === "done" ? null : new Error(data.error || "Build failed"), data.result);
          };
          worker.onerror = error => {
            if (slot.worker !== worker) return;
            const active = slot.job;
            worker.terminate();
            slot.worker = null;
            if (active) settle(active, new Error(error.message || "City worker failed"));
          };
        }
        const queueStartedAt = performance.now();
        recordPerfTiming("city.worker-queue", queueStartedAt - job.createdAt, {
          elements: job.args.elements?.length || 0,
        });
        const packStartedAt = performance.now();
        const terrainTiles = packTerrainTiles(job.args.terrainTiles);
        recordPerfTiming("city.worker-input-pack", performance.now() - packStartedAt, {
          elements: job.args.elements?.length || 0,
          terrainTiles: terrainTiles.length,
          copiedHeightBytes: terrainTiles.reduce((sum, tile) => sum + tile.heights.byteLength, 0),
        });
        const postedAt = performance.now();
        slot.worker.postMessage({
          id: job.id,
          elements: job.args.elements,
          lat0: job.args.lat0,
          lon0: job.args.lon0,
          terrainTiles,
          profileQueries: job.args.profileQueries === true,
          roadQueryMode: job.args.roadQueryMode,
        });
        job.postedAt = performance.now();
        recordPerfTiming("city.worker-post-message", job.postedAt - postedAt, {
          elements: job.args.elements?.length || 0,
          terrainTiles: terrainTiles.length,
        });
      } catch (error) { settle(job, error); }
    }
  }
  function settle(job, error, result) {
    if (job.finished) return;
    job.finished = true;
    clearTimeout(job.timer);
    job.args.signal?.removeEventListener("abort", job.abort);
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
    if (job.slot) job.slot.job = null;
    if (error) job.reject(error); else job.resolve(result);
    queueMicrotask(pump);
  }
  function build(args) {
    if (closed) return Promise.reject(new Error("City builder disposed"));
    if (args.signal?.aborted) return Promise.reject(args.signal.reason);
    if (slots.every((slot) => slot.job) && queue.length >= queueLimit) {
      const error = new Error("City builder queue is full");
      error.code = "CITY_BUILDER_QUEUE_FULL";
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const job = { args, resolve, reject, id: ++sequence, createdAt: performance.now() };
      job.abort = () => {
        job.slot?.worker?.terminate();
        if (job.slot) job.slot.worker = null;
        settle(job, args.signal?.reason || new Error("City build timed out"));
      };
      args.signal?.addEventListener("abort", job.abort, { once: true });
      job.timer = setTimeout(job.abort, 60000);
      queue.push(job); pump();
    });
  }
  function dispose() {
    closed = true;
    for (const job of [...queue, ...slots.map(s => s.job).filter(Boolean)]) job.abort();
    for (const slot of slots) { slot.worker?.terminate(); slot.worker = null; }
  }
  function debugState() {
    return {
      closed,
      workerCount: slots.length,
      activeCount: slots.filter((slot) => slot.job).length,
      queuedCount: queue.length,
      queueLimit,
      pendingCount: queue.length + slots.filter((slot) => slot.job).length,
    };
  }
  return { build, dispose, debugState };
}

// Compatibility helper for callers without an engine lifetime (tests/tools).
export async function runCityBuilder(args) {
  if (typeof Worker === "undefined") {
    args.signal?.throwIfAborted();
    const { buildCityGeometry } = await import("@/lib/engine/city-builder-core");
    const terrainTiles = packTerrainTiles(args.terrainTiles);
    const startedAt = performance.now();
    const built = buildCityGeometry({ ...args, terrainTiles });
    recordPerfTiming("city.worker-compute-fallback", performance.now() - startedAt, {
      elements: args.elements?.length || 0,
    });
    return built.result;
  }
  const pool = createCityBuilderPool({ size: 1 });
  try { return await pool.build(args); } finally { pool.dispose(); }
}
