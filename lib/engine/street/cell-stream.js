// Walk-time city cell streaming.
import * as THREE from "three";
import { fetchCityDataForStream, cityCacheKey } from "@/lib/engine/cityData";
import { runCityBuilder } from "@/lib/engine/city-builder";
import { assembleCityFromBuild } from "@/lib/engine/street/assemble-city";
import {
  CELL_STEP,
  clipElementsToCell,
  takeUnseenElements,
  noteElementIds,
  forgetElementIds,
} from "@/lib/engine/cell-clip";

export { CELL_STEP };

/**
 * @param {object} ctx
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

  /** @type {Map<string, { group: THREE.Group|null, lat: number, lon: number, pinned?: boolean, alias?: string, ids?: string[] }>} */
  const loaded = new Map();
  const loading = new Set();
  const failed = new Map();
  const seenIds = new Set();
  const queue = [];
  let active = 0;
  const CONCURRENCY = 2;
  let disposed = false;

  const markLoaded = (key, lat, lon, ids = []) => {
    if (!loaded.has(key)) {
      loaded.set(key, { group: null, lat, lon, pinned: true, ids });
    }
  };

  const noteSpawnElements = (elements) => {
    // Match spawn assemble: corridors from the fetch + buildings owned by
    // the spawn tile. Do not claim buildings outside the tile — that was
    // why neighbors assembled empty after you walked past ~650 m.
    const owned = clipElementsToCell(elements || [], lat0, lon0);
    const ids = noteElementIds(owned, seenIds);
    const spawnKey = cityCacheKey(lat0, lon0);
    const entry = loaded.get(spawnKey);
    if (entry) entry.ids = ids;
  };

  function snap(lat, lon) {
    return { lat: Number(lat.toFixed(3)), lon: Number(lon.toFixed(3)) };
  }

  function desiredAround(lat, lon) {
    const c = snap(lat, lon);
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
      out.push([Number((c.lat + dla).toFixed(3)), Number((c.lon + dlo).toFixed(3))]);
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

  function pruneEngineMeta(cellKey) {
    if (!engineRef?.current || !cellKey) return;
    const er = engineRef.current;
    const keep = (arr) => (arr || []).filter((item) => item?.cellKey !== cellKey);
    er.roadPaths = keep(er.roadPaths);
    er.propMarkers = keep(er.propMarkers);
    er.pois = keep(er.pois);
    er.bridgeDecks = keep(er.bridgeDecks);
  }

  function evictFar(lat, lon) {
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
      forgetElementIds(drop.v.ids, seenIds);
      pruneEngineMeta(drop.key);
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
      if (Date.now() < (failed.get(key) || 0)) continue;
      active++;
      loading.add(key);
      onLoading?.(loading.size + queue.length);
      try {
        await loadCellBody(lat, lon, key);
      } finally {
        loading.delete(key);
        active--;
        onLoading?.(loading.size + queue.length);
        pump();
      }
    }
  }

  async function loadCellBody(lat, lon, key) {
    try {
      const near = await fetchCityDataForStream(lat, lon);
      if (disposed || isDisposed?.()) return;

      const centerDist = Math.hypot(near.lat - lat, near.lon - lon);
      if (centerDist > CELL_STEP * 0.85) {
        failed.set(key, Date.now() + 5_000);
        console.warn(
          `[stream] ${key}: hit ${near.cacheKey} too far (${centerDist.toFixed(4)}°) — retry`
        );
        return;
      }
      if (loaded.has(key)) return;

      const data = near.data;
      if (!data?.elements?.length) {
        failed.set(key, Date.now() + 45_000);
        console.warn(`[stream] ${key}: empty dataset`);
        return;
      }

      let elements = clipElementsToCell(data.elements, lat, lon);
      const taken = takeUnseenElements(elements, seenIds);
      elements = taken.elements;
      if (!elements.length) {
        // Nothing new — mark loaded so we don't spin, but allow eviction/retry
        // by not pinning.
        loaded.set(key, { group: null, lat, lon, pinned: false, ids: [] });
        return;
      }

      const built = await runCityBuilder({
        elements,
        lat0,
        lon0,
        terrainTiles,
        onProgress: null,
      });
      if (disposed || isDisposed?.()) {
        forgetElementIds(taken.ids, seenIds);
        return;
      }

      const group = new THREE.Group();
      group.name = key;
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
        cellKey: key,
        skipOverture: true,
        skipPlayerSpawn: true,
      });

      loaded.set(key, { group, lat, lon, pinned: false, ids: taken.ids });
      failed.delete(key);
      evictFar(lat, lon);
      console.info(
        `[stream] loaded ${key} (${elements.length} features, data=${near.cacheKey})`
      );
    } catch (e) {
      failed.set(key, Date.now() + 12_000);
      console.warn(`[stream] ${key}:`, e?.message || e);
    }
  }

  function enqueue(lat, lon) {
    const key = cityCacheKey(lat, lon);
    if (disposed || isDisposed?.() || loaded.has(key) || loading.has(key)) return;
    if (queue.some((q) => q.key === key)) return;
    if (Date.now() < (failed.get(key) || 0)) return;
    queue.push({ lat, lon, key });
    pump();
  }

  let lastTickKey = "";
  let lastRetrySweep = 0;
  const tick = (lat, lon) => {
    if (disposed || isDisposed?.()) return;
    const c = snap(lat, lon);
    const tickKey = `${c.lat},${c.lon}`;
    const now = Date.now();
    // Periodically retry expired failures even if still in same snapped cell.
    if (now - lastRetrySweep > 5_000) {
      lastRetrySweep = now;
      for (const [k, until] of [...failed.entries()]) {
        if (now >= until) failed.delete(k);
      }
    }
    if (
      tickKey === lastTickKey &&
      loading.size === 0 &&
      queue.length === 0 &&
      failed.size === 0
    ) {
      return;
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
    seenIds.clear();
    failed.clear();
  };

  return {
    tick,
    markLoaded,
    noteSpawnElements,
    dispose,
    loadingCount: () => loading.size + queue.length,
  };
}
