// Walk-time city cell streaming.
import * as THREE from "three";
import { cellNeighborhood } from "@/lib/city-contract";
import { disposeSceneGroup } from "./resources";
import { sharedMaterialTextures } from "@/lib/engine/materials";
import { fetchCityDataForStream, cityCacheKey } from "@/lib/engine/cityData";
import { runCityBuilder } from "@/lib/engine/city-builder";
import { assembleCityFromBuild } from "@/lib/engine/street/assemble-city";
import { measurePerf, measurePerfAsync } from "@/lib/perf";
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
    onCellLoaded,
    maxCells = 10, // 3x3 ring + the pinned spawn cell when it sits outside the ring
    buildCity = runCityBuilder,
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
  const controller = new AbortController();

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

  function desiredAround(lat, lon) {
    return cellNeighborhood(lat, lon, lat0, lon0);
  }
  function snap(lat, lon) {
    const [la, lo] = desiredAround(lat, lon)[0] || [lat0, lon0];
    return { lat: la, lon: lo };
  }
  function disposeGroup(group) {
    disposeSceneGroup(group, scene, sharedMaterialTextures());
  }

  function pruneEngineMeta(cellKey) {
    if (!engineRef?.current || !cellKey) return;
    const er = engineRef.current;
    const keep = (arr) => (arr || []).filter((item) => item?.cellKey !== cellKey);
    er.roadPaths = keep(er.roadPaths);
    er.propMarkers = keep(er.propMarkers);
    er.pois = keep(er.pois);
    er.bridgeDecks = keep(er.bridgeDecks);
    er.spinners = keep(er.spinners);
    er.lampGlows = keep(er.lampGlows);
    er.buildingMats = keep(er.buildingMats);
    er.lampPoolMaterials = keep(er.lampPoolMaterials);
  }

  function evictFar(lat, lon) {
    const real = [...loaded.entries()].filter(([, v]) => !v.alias);
    if (real.length <= maxCells) return;
    // Never evict a cell of the current ring: tick() would not re-request it while the player stays put.
    const ring = new Set(desiredAround(lat, lon).map(([la, lo]) => cityCacheKey(la, lo)));
    const ranked = real
      .filter(([key, v]) => !v.pinned && !ring.has(key))
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
    let taken, group;
    let committed = false;
    try {
      const near = await fetchCityDataForStream(lat, lon, { signal: controller.signal });
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

      let elements = measurePerf("city.neighbor-clip", () => clipElementsToCell(data.elements, lat, lon), {
        inputElements: data.elements.length,
      });
      if (data.partial) throw new Error("Partial cell; retrying later");
      taken = takeUnseenElements(elements, seenIds);
      elements = taken.elements;
      if (!elements.length) {
        // Nothing new — mark loaded so we don't spin, but allow eviction/retry
        // by not pinning.
        loaded.set(key, { group: null, lat, lon, pinned: false, ids: [] });
        return;
      }

      const built = await measurePerfAsync("city.neighbor-geometry-total", () => buildCity({
        signal: controller.signal,
        elements,
        lat0,
        lon0,
        terrainTiles,
        onProgress: null,
      }), { elements: elements.length });
      if (disposed || isDisposed?.()) {
        forgetElementIds(taken.ids, seenIds);
        return;
      }

      group = new THREE.Group();
      group.name = key;
      scene.add(group);

      const spinners = [];
      const lampGlows = [];
      await measurePerfAsync("city.neighbor-assembly-total", () => assembleCityFromBuild(built, {
        scene,
        signal: controller.signal,
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
      }), { elements: elements.length });

      if (disposed || isDisposed?.()) return;
      loaded.set(key, { group, lat, lon, pinned: false, ids: taken.ids });
      committed = true;
      onCellLoaded?.(key);
      failed.delete(key);
      evictFar(latest.lat, latest.lon);
      console.info(
        `[stream] loaded ${key} (${elements.length} features, data=${near.cacheKey})`
      );
    } catch (e) {
      if (!disposed) failed.set(key, Date.now() + 30_000);
      if (!disposed) console.warn(`[stream] ${key}:`, e?.message || e);
    } finally {
      if (!committed && taken) {
        forgetElementIds(taken.ids, seenIds);
        disposeGroup(group);
        removeFootprintsByCell?.(key);
        pruneEngineMeta(key);
      }
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

  let latest = { lat: lat0, lon: lon0 };
  let prev = { lat: lat0, lon: lon0 };
  let heading = { lat: 0, lon: 0 };
  let lastTickKey = "";
  let lastRetrySweep = 0;
  const tick = (lat, lon) => {
    if (disposed || isDisposed?.()) return;
    latest = { lat, lon };
    const c = snap(lat, lon);
    const tickKey = `${c.lat},${c.lon}`;
    const now = Date.now();
    let retryDue = false;
    // Periodically retry expired failures even if still in same snapped cell.
    if (now - lastRetrySweep > 5_000) {
      lastRetrySweep = now;
      for (const [k, until] of [...failed.entries()]) {
        if (now >= until) { failed.delete(k); retryDue = true; }
      }
    }
    if (
      !retryDue && tickKey === lastTickKey &&
      loading.size === 0 &&
      queue.length === 0 &&
      failed.size === 0
    ) {
      return;
    }
    lastTickKey = tickKey;

    // Nearest first, biased toward the direction of travel.
    const dLat = lat - prev.lat, dLon = lon - prev.lon, moved = Math.hypot(dLat, dLon);
    if (moved > 1e-6) heading = { lat: dLat / moved, lon: dLon / moved };
    prev = { lat, lon };
    const score = ([la, lo]) => {
      const d = Math.hypot(la - lat, lo - lon);
      return d - (d ? 0.5 * CELL_STEP * ((la - lat) * heading.lat + (lo - lon) * heading.lon) / d : 0);
    };
    for (const [la, lo] of desiredAround(lat, lon).sort((a, b) => score(a) - score(b))) enqueue(la, lo);
    evictFar(lat, lon);
  };

  const dispose = () => {
    disposed = true;
    controller.abort();
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
