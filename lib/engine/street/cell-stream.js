// Walk-time city cell streaming: keep the spawn cell plus nearby neighbors
// assembled in the scene so walking past ~650 m still shows buildings.
import * as THREE from "three";
import { fetchCityDataNear, cityCacheKey } from "@/lib/engine/cityData";
import { runCityBuilder } from "@/lib/engine/city-builder";
import { assembleCityFromBuild } from "@/lib/engine/street/assemble-city";
import {
  CELL_STEP,
  clipElementsToCell,
  takeUnseenElements,
  noteElementIds,
} from "@/lib/engine/cell-clip";

export { CELL_STEP };

/**
 * @param {object} ctx
 * @returns {{ tick: (lat:number, lon:number) => void, markLoaded: (key:string) => void, dispose: () => void, loadingCount: () => number }}
 */
export function createCellStreamer(ctx) {
  const {
    scene,
    lat0,
    lon0,
    toLocal,
    groundHeight,
    addFootprint,
    insideBuilding,
    removeFootprintsByCell,
    tileCanvases,
    engineRef,
    player,
    terrainTiles,
    isDisposed,
    onLoading,
    maxCells = 9,
  } = ctx;

  const loaded = new Map();
  const loading = new Set();
  const failed = new Map(); // key -> retryAfter ms
  const seenIds = new Set();
  const queue = [];
  let active = 0;
  const CONCURRENCY = 2;
  let disposed = false;

  const markLoaded = (key, lat, lon) => {
    if (!loaded.has(key)) {
      loaded.set(key, { group: null, lat, lon, pinned: true });
    }
  };

  /** Call after the spawn cell assembles so streamed neighbors don't re-add the same OSM ids. */
  const noteSpawnElements = (elements) => {
    noteElementIds(elements, seenIds);
  };

  function snap(lat, lon) {
    return { lat: Number(lat.toFixed(3)), lon: Number(lon.toFixed(3)) };
  }

  function desiredAround(lat, lon) {
    const c = snap(lat, lon);
    // Cross + diagonals so walking any direction stays populated.
    const out = [[c.lat, c.lon]];
    for (const [dla, dlo] of [
      [CELL_STEP, 0],
      [-CELL_STEP, 0],
      [0, CELL_STEP],
      [0, -CELL_STEP],
      [CELL_STEP, CELL_STEP],
      [CELL_STEP, -CELL_STEP],
      [-CELL_STEP, CELL_STEP],
      [-CELL_STEP, -CELL_STEP],
    ]) {
      out.push([
        Number((c.lat + dla).toFixed(3)),
        Number((c.lon + dlo).toFixed(3)),
      ]);
    }
    return out;
  }

  function disposeGroup(group) {
    if (!group) return;
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          m.map?.dispose?.();
          m.dispose?.();
        }
      }
    });
    scene.remove(group);
  }

  function evictFar(lat, lon) {
    // Count real assemblies only (aliases share a group with their dataKey).
    const real = [...loaded.entries()].filter(([, v]) => !v.alias);
    if (real.length <= maxCells) return;
    const ranked = real
      .filter(([, v]) => !v.pinned)
      .map(([key, v]) => ({
        key,
        v,
        d: Math.hypot(v.lat - lat, v.lon - lon),
      }))
      .sort((a, b) => b.d - a.d);
    let realCount = real.length;
    while (realCount > maxCells && ranked.length) {
      const drop = ranked.shift();
      if (!drop) break;
      disposeGroup(drop.v.group);
      removeFootprintsByCell?.(drop.key);
      loaded.delete(drop.key);
      for (const [k, v] of [...loaded.entries()]) {
        if (v.alias === drop.key) loaded.delete(k);
      }
      realCount--;
    }
  }

  async function pump() {
    while (active < CONCURRENCY && queue.length && !disposed) {
      const job = queue.shift();
      if (!job) break;
      const { lat, lon, key } = job;
      if (loaded.has(key) || loading.has(key)) continue;
      active++;
      loading.add(key);
      onLoading?.(loading.size);
      try {
        await loadCellBody(lat, lon, key);
      } finally {
        loading.delete(key);
        active--;
        onLoading?.(loading.size);
        pump();
      }
    }
  }

  async function loadCellBody(lat, lon, key) {
    const retryAfter = failed.get(key) || 0;
    if (Date.now() < retryAfter) return;
    try {
      const near = await fetchCityDataNear(lat, lon);
      if (disposed || isDisposed?.()) return;

      // Warm hit must be for *this* neighborhood. If fetchCityDataNear returned
      // a distant seed cell, treat as miss and don't poison the slot.
      const centerDist = Math.hypot(near.lat - lat, near.lon - lon);
      if (centerDist > CELL_STEP * 0.85) {
        failed.set(key, Date.now() + 8_000);
        console.warn(
          `[stream] ${key}: warm hit ${near.cacheKey} too far (${centerDist.toFixed(4)}°) — retry`
        );
        return;
      }

      const dataKey = near.cacheKey;
      // Same blob already assembled (true neighbor overlap) — alias only.
      if (loaded.has(dataKey)) {
        loaded.set(key, { group: null, lat, lon, pinned: false, alias: dataKey });
        return;
      }
      const data = near.data;
      if (!data?.elements?.length) {
        // Real empty — don't hammer forever, but allow retry later.
        failed.set(key, Date.now() + 60_000);
        console.warn(`[stream] ${key}: empty dataset`);
        return;
      }

      // Clip to the *requested* cell (player neighborhood), not a far warm center.
      let elements = clipElementsToCell(data.elements, lat, lon);
      elements = takeUnseenElements(elements, seenIds);
      if (!elements.length) {
        // Everything already in scene from spawn/neighbors — fine.
        loaded.set(key, { group: null, lat, lon, pinned: false, alias: dataKey });
        if (!loaded.has(dataKey)) {
          loaded.set(dataKey, { group: null, lat: near.lat, lon: near.lon, pinned: false });
        }
        return;
      }

      const built = await runCityBuilder({
        elements,
        lat0,
        lon0,
        terrainTiles,
        onProgress: null,
      });
      if (disposed || isDisposed?.()) return;

      const group = new THREE.Group();
      group.name = dataKey;
      scene.add(group);

      const spinners = [];
      const lampGlows = [];
      await assembleCityFromBuild(built, {
        scene,
        root: group,
        groundHeight,
        toLocal,
        addFootprint,
        insideBuilding,
        tileCanvases,
        engineRef,
        player,
        lat0,
        lon0,
        spinners,
        lampGlows,
        appendMeta: true,
        cellKey: dataKey,
        skipOverture: true,
        skipPlayerSpawn: true,
      });

      const entry = { group, lat, lon, pinned: false };
      loaded.set(dataKey, entry);
      loaded.set(key, { ...entry, alias: dataKey });
      failed.delete(key);
      evictFar(lat, lon);
      console.info(`[stream] loaded ${dataKey} @ ${lat.toFixed(3)},${lon.toFixed(3)} (${elements.length} features)`);
    } catch (e) {
      failed.set(key, Date.now() + 15_000);
      console.warn(`[stream] ${key}:`, e?.message || e);
    }
  }

  function enqueue(lat, lon) {
    const key = cityCacheKey(lat, lon);
    if (disposed || isDisposed?.() || loaded.has(key) || loading.has(key)) return;
    if (queue.some((q) => q.key === key)) return;
    const retryAfter = failed.get(key) || 0;
    if (Date.now() < retryAfter) return;
    queue.push({ lat, lon, key });
    pump();
  }

  let lastTickKey = "";
  const tick = (lat, lon) => {
    if (disposed || isDisposed?.()) return;
    const c = snap(lat, lon);
    const tickKey = `${c.lat},${c.lon}`;
    if (tickKey === lastTickKey && loading.size === 0 && queue.length === 0) {
      if ([...failed.keys()].length === 0) return;
    }
    lastTickKey = tickKey;

    for (const [la, lo] of desiredAround(lat, lon)) enqueue(la, lo);
    evictFar(lat, lon);
  };

  const dispose = () => {
    disposed = true;
    queue.length = 0;
    for (const [, v] of loaded) {
      if (!v.pinned) disposeGroup(v.group);
    }
    loaded.clear();
    loading.clear();
  };

  return {
    tick,
    markLoaded,
    noteSpawnElements,
    dispose,
    loadingCount: () => loading.size + queue.length,
  };
}
