// Walk-time city cell streaming: keep the spawn cell plus nearby neighbors
// assembled in the scene so walking past ~650 m still shows buildings.
import * as THREE from "three";
import { fetchCityDataNear, cityCacheKey } from "@/lib/engine/cityData";
import { runCityBuilder } from "@/lib/engine/city-builder";
import { assembleCityFromBuild } from "@/lib/engine/street/assemble-city";

/** Same neighbor offset the seed script / prefetch use (~611 m). */
export const CELL_STEP = 0.0055;

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
  const queue = [];
  let active = 0;
  const CONCURRENCY = 2;
  let disposed = false;

  const markLoaded = (key, lat, lon) => {
    if (!loaded.has(key)) {
      loaded.set(key, { group: null, lat, lon, pinned: true });
    }
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
      const dataKey = near.cacheKey;
      // Same warm R2 blob can satisfy many walk positions — assemble once.
      if (loaded.has(dataKey)) {
        loaded.set(key, { group: null, lat, lon, pinned: false, alias: dataKey });
        return;
      }
      const data = near.data;
      if (!data?.elements?.length) {
        loaded.set(key, { group: null, lat, lon, pinned: false });
        loaded.set(dataKey, { group: null, lat: near.lat, lon: near.lon, pinned: false });
        return;
      }

      const built = await runCityBuilder({
        elements: data.elements,
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

      const entry = { group, lat: near.lat, lon: near.lon, pinned: false };
      loaded.set(dataKey, entry);
      loaded.set(key, { ...entry, alias: dataKey });
      failed.delete(key);
      evictFar(lat, lon);
      console.info(`[stream] loaded ${dataKey} (${data.elements.length} features)`);
    } catch (e) {
      failed.set(key, Date.now() + 20_000);
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
    dispose,
    loadingCount: () => loading.size + queue.length,
  };
}
