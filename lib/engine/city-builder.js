// Main-thread helper: run city geometry in a Worker with transferable buffers.
import * as THREE from "three";
import { buildCityGeometry } from "@/lib/engine/city-builder-core";

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

/**
 * Build city geometry off the main thread when Workers are available.
 * Falls back to sync build on the main thread.
 */
export function runCityBuilder({ elements, lat0, lon0, terrainTiles, onProgress }) {
  const packed = packTerrainTiles(terrainTiles);

  if (typeof Worker === "undefined") {
    const { result } = buildCityGeometry({
      elements, lat0, lon0, terrainTiles: packed, onProgress,
    });
    return Promise.resolve(result);
  }

  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL("./city-builder.worker.js", import.meta.url));
    } catch (e) {
      const { result } = buildCityGeometry({
        elements, lat0, lon0, terrainTiles: packed, onProgress,
      });
      resolve(result);
      return;
    }
    const id = Math.random().toString(36).slice(2);
    const onMsg = (ev) => {
      const msg = ev.data;
      if (!msg || msg.id !== id) return;
      if (msg.type === "progress") {
        onProgress?.(msg.done, msg.total);
        return;
      }
      worker.removeEventListener("message", onMsg);
      worker.terminate();
      if (msg.type === "done") resolve(msg.result);
      else reject(new Error(msg.error || "city builder failed"));
    };
    worker.addEventListener("message", onMsg);
    worker.addEventListener("error", (err) => {
      worker.removeEventListener("message", onMsg);
      worker.terminate();
      // fallback: main-thread build
      try {
        const { result } = buildCityGeometry({
          elements, lat0, lon0, terrainTiles: packed, onProgress,
        });
        resolve(result);
      } catch (e2) {
        reject(e2 || err);
      }
    });
    worker.postMessage({ id, elements, lat0, lon0, terrainTiles: packed });
  });
}
