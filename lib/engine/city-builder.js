// Main-thread helper: run city geometry in a Worker with transferable buffers.
import * as THREE from "three";


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
export function createCityBuilderPool({ size = 2, workerFactory = () => new Worker(new URL("./city-builder.worker.js", import.meta.url)) } = {}) {
  const slots = Array.from({ length: size }, () => ({ worker: null, job: null }));
  const queue = [];
  let closed = false, sequence = 0;
  function pump() {
    if (closed) return;
    for (const slot of slots) {
      if (slot.job || !queue.length) continue;
      const job = queue.shift();
      slot.job = job;
      job.slot = slot;
      try {
        if (!slot.worker) {
          slot.worker = workerFactory();
          slot.worker.onmessage = ({ data }) => {
            const active = slot.job;
            if (!active || data.id !== active.id) return;
            if (data.type === "progress") { active.args.onProgress?.(data.done, data.total); return; }
            settle(active, data.type === "done" ? null : new Error(data.error || "Build failed"), data.result);
          };
          slot.worker.onerror = error => {
            const active = slot.job;
            slot.worker?.terminate(); slot.worker = null;
            if (active) settle(active, new Error(error.message || "City worker failed"));
          };
        }
        slot.worker.postMessage({ id: job.id, elements: job.args.elements, lat0: job.args.lat0, lon0: job.args.lon0, terrainTiles: packTerrainTiles(job.args.terrainTiles) });
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
    return new Promise((resolve, reject) => {
      const job = { args, resolve, reject, id: ++sequence };
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
  return { build, dispose };
}

// Compatibility helper for callers without an engine lifetime (tests/tools).
export async function runCityBuilder(args) {
  if (typeof Worker === "undefined") {
    args.signal?.throwIfAborted();
    const { buildCityGeometry } = await import("@/lib/engine/city-builder-core");
    return buildCityGeometry({ ...args, terrainTiles: packTerrainTiles(args.terrainTiles) }).result;
  }
  const pool = createCityBuilderPool({ size: 1 });
  try { return await pool.build(args); } finally { pool.dispose(); }
}
