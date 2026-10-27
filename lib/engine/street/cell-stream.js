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
  const deferred = new Map();
  const seenIds = new Set();
  const reservedIds = new Map();
  const activeJobs = new Map();
  const queue = [];
  let active = 0;
  const CONCURRENCY = 2;
  const MAX_QUEUED_CELLS = 9;
  let assemblyTail = Promise.resolve();
  let disposed = false;
  let jobSequence = 0;
  let latest = { lat: lat0, lon: lon0 };
  let prev = { lat: lat0, lon: lon0 };
  let heading = { lat: 0, lon: 0 };
  let lastTickKey = "";
  let lastRetrySweep = 0;

  function withAssemblySlot(assemble) {
    const previous = assemblyTail;
    let release;
    assemblyTail = new Promise((resolve) => { release = resolve; });
    return previous.then(assemble).finally(release);
  }

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
  let desiredKeys = new Set(desiredAround(lat0, lon0).map(([la, lo]) => cityCacheKey(la, lo)));

  function snap(lat, lon) {
    const [la, lo] = desiredAround(lat, lon)[0] || [lat0, lon0];
    return { lat: la, lon: lo };
  }

  function isCurrentJob(job) {
    return !disposed && !isDisposed?.() && !job.obsolete &&
      !job.controller.signal.aborted && activeJobs.get(job.key) === job &&
      desiredKeys.has(job.key);
  }

  function reserveUnseenElements(elements, job) {
    const idsInPayload = new Set();
    for (const el of elements || []) {
      if (el?.id == null || !el.type) continue;
      const id = `${el.type}/${el.id}`;
      if (idsInPayload.has(id) || seenIds.has(id)) continue;
      idsInPayload.add(id);
      const owner = reservedIds.get(id);
      if (owner && owner !== job.id) return { blocked: true, elements: [], ids: [] };
    }

    const kept = [];
    const ids = [];
    for (const el of elements || []) {
      if (el?.id == null || !el.type) continue;
      const id = `${el.type}/${el.id}`;
      if (seenIds.has(id) || reservedIds.has(id)) continue;
      reservedIds.set(id, job.id);
      ids.push(id);
      kept.push(el);
    }
    job.reservedIds = ids;
    return { blocked: false, elements: kept, ids };
  }

  function commitReservations(job) {
    let changed = false;
    for (const id of job.reservedIds || []) {
      if (reservedIds.get(id) !== job.id) continue;
      reservedIds.delete(id);
      seenIds.add(id);
      changed = true;
    }
    job.reservedIds = [];
    job.reservationsChanged ||= changed;
  }

  function releaseReservations(job) {
    let changed = false;
    for (const id of job.reservedIds || []) {
      if (reservedIds.get(id) !== job.id) continue;
      reservedIds.delete(id);
      changed = true;
    }
    job.reservedIds = [];
    job.reservationsChanged ||= changed;
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

  function retryDeferred() {
    let queuedAny = false;
    const now = Date.now();
    for (const [key, coords] of deferred) {
      if (!desiredKeys.has(key)) {
        deferred.delete(key);
        continue;
      }
      if (loaded.has(key) || loading.has(key) || queue.some((job) => job.key === key)) {
        deferred.delete(key);
        continue;
      }
      if (now < (failed.get(key) || 0) || queue.length >= MAX_QUEUED_CELLS) continue;
      queue.push({ ...coords, key });
      deferred.delete(key);
      queuedAny = true;
    }
    if (queuedAny) {
      onLoading?.(loading.size + queue.length);
      pump();
    }
  }

  function pump() {
    while (active < CONCURRENCY && queue.length && !disposed) {
      const queued = queue.shift();
      if (!queued) break;
      const { lat, lon, key } = queued;
      if (!desiredKeys.has(key) || loaded.has(key) || loading.has(key)) continue;
      if (Date.now() < (failed.get(key) || 0)) continue;

      const job = {
        ...queued,
        id: ++jobSequence,
        controller: new AbortController(),
        obsolete: false,
        reservedIds: [],
        reservationsChanged: false,
      };
      activeJobs.set(key, job);
      active++;
      loading.add(key);
      onLoading?.(loading.size + queue.length);
      void runJob(job);
    }
  }

  async function runJob(job) {
    try {
      await loadCellBody(job);
    } finally {
      loading.delete(job.key);
      if (activeJobs.get(job.key) === job) activeJobs.delete(job.key);
      active--;
      onLoading?.(loading.size + queue.length);
      if (job.reservationsChanged) retryDeferred();
      pump();
    }
  }

  async function loadCellBody(job) {
    const { lat, lon, key } = job;
    const { signal } = job.controller;
    let taken, group;
    let committed = false;
    try {
      if (!isCurrentJob(job)) return;
      const near = await fetchCityDataForStream(lat, lon, { signal });
      if (!isCurrentJob(job)) return;

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

      const clippedElements = measurePerf("city.neighbor-clip", () => clipElementsToCell(data.elements, lat, lon), {
        inputElements: data.elements.length,
      });
      if (data.partial) throw new Error("Partial cell; retrying later");
      if (!isCurrentJob(job)) return;

      taken = reserveUnseenElements(clippedElements, job);
      if (taken.blocked) {
        deferred.set(key, { lat, lon });
        return;
      }
      if (!taken.elements.length) {
        // A fully seen cell needs no scene group, but still becomes retryable
        // after normal eviction. IDs in this path belong to committed cells.
        loaded.set(key, { group: null, lat, lon, pinned: false, ids: [] });
        committed = true;
        deferred.delete(key);
        failed.delete(key);
        evictFar(latest.lat, latest.lon);
        return;
      }

      const built = await measurePerfAsync("city.neighbor-geometry-total", () => buildCity({
        signal,
        elements: taken.elements,
        lat0,
        lon0,
        terrainTiles,
        onProgress: null,
      }), { elements: taken.elements.length });
      if (!isCurrentJob(job)) return;

      await withAssemblySlot(async () => {
        if (!isCurrentJob(job)) return;
        group = new THREE.Group();
        group.name = key;
        scene.add(group);

        const spinners = [];
        const lampGlows = [];
        await measurePerfAsync("city.neighbor-assembly-total", () => assembleCityFromBuild(built, {
          scene,
          signal,
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
        }), { elements: taken.elements.length });
      });

      if (!isCurrentJob(job)) return;
      loaded.set(key, { group, lat, lon, pinned: false, ids: taken.ids });
      committed = true;
      commitReservations(job);
      deferred.delete(key);
      failed.delete(key);
      onCellLoaded?.(key);
      evictFar(latest.lat, latest.lon);
      console.info(
        `[stream] loaded ${key} (${taken.elements.length} features, data=${near.cacheKey})`
      );
    } catch (error) {
      if (!signal.aborted && isCurrentJob(job) && !committed) {
        failed.set(key, Date.now() + 30_000);
        console.warn(`[stream] ${key}:`, error?.message || error);
      }
    } finally {
      if (!committed && (taken?.ids?.length || group)) {
        releaseReservations(job);
        disposeGroup(group);
        removeFootprintsByCell?.(key);
        pruneEngineMeta(key);
      } else if (!committed) {
        releaseReservations(job);
      }
    }
  }

  function enqueue(lat, lon, { startPump = true } = {}) {
    const key = cityCacheKey(lat, lon);
    if (disposed || isDisposed?.() || !desiredKeys.has(key) || loaded.has(key) || loading.has(key)) return false;
    if (queue.some((q) => q.key === key)) return false;
    if (Date.now() < (failed.get(key) || 0) || queue.length >= MAX_QUEUED_CELLS) return false;
    queue.push({ lat, lon, key });
    if (startPump) pump();
    return true;
  }

  function reconcileDesiredWork(nextDesiredKeys) {
    desiredKeys = nextDesiredKeys;
    let queueChanged = false;
    for (let i = queue.length - 1; i >= 0; i--) {
      if (!desiredKeys.has(queue[i].key)) {
        queue.splice(i, 1);
        queueChanged = true;
      }
    }
    for (const [key, job] of activeJobs) {
      if (desiredKeys.has(key) || job.obsolete) continue;
      job.obsolete = true;
      const reason = new Error("City cell is no longer in the desired neighborhood");
      reason.name = "AbortError";
      job.controller.abort(reason);
    }
    for (const key of deferred.keys()) {
      if (!desiredKeys.has(key)) deferred.delete(key);
    }
    for (const key of failed.keys()) {
      if (!desiredKeys.has(key)) failed.delete(key);
    }
    if (queueChanged) onLoading?.(loading.size + queue.length);
  }

  const tick = (lat, lon) => {
    if (disposed || isDisposed?.()) return;
    latest = { lat, lon };
    const c = snap(lat, lon);
    const tickKey = `${c.lat},${c.lon}`;
    const desiredCells = desiredAround(lat, lon);
    reconcileDesiredWork(new Set(desiredCells.map(([la, lo]) => cityCacheKey(la, lo))));
    const now = Date.now();
    let retryDue = false;
    // Periodically retry expired failures even if still in same snapped cell.
    if (now - lastRetrySweep > 5_000) {
      lastRetrySweep = now;
      for (const [k, until] of [...failed.entries()]) {
        if (now >= until) { failed.delete(k); retryDue = true; }
      }
    }
    const desiredCovered = desiredCells.every(([la, lo]) => {
      const key = cityCacheKey(la, lo);
      return loaded.has(key) || loading.has(key) || queue.some((job) => job.key === key) ||
        now < (failed.get(key) || 0);
    });
    if (
      !retryDue && tickKey === lastTickKey && desiredCovered
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
    const orderedCells = desiredCells.sort((a, b) => score(a) - score(b));
    for (const [la, lo] of orderedCells) enqueue(la, lo, { startPump: false });
    queue.sort((a, b) => score([a.lat, a.lon]) - score([b.lat, b.lon]));
    if (queue.length) pump();
    evictFar(lat, lon);
  };

  const dispose = () => {
    disposed = true;
    for (const job of activeJobs.values()) {
      job.obsolete = true;
      job.controller.abort(new Error("City streamer disposed"));
    }
    queue.length = 0;
    for (const [, v] of loaded) {
      if (!v.pinned) disposeGroup(v.group);
    }
    loaded.clear();
    loading.clear();
    seenIds.clear();
    reservedIds.clear();
    deferred.clear();
    failed.clear();
    activeJobs.clear();
  };

  const debugState = () => {
    const center = snap(latest.lat, latest.lon);
    return {
      center: { ...center, key: cityCacheKey(center.lat, center.lon) },
      loadedKeys: [...loaded.keys()].sort(),
      loadingKeys: [...loading].sort(),
      queuedKeys: queue.map((job) => job.key).sort(),
      activeJobKeys: [...activeJobs.keys()].sort(),
      obsoleteJobKeys: [...activeJobs.values()].filter((job) => job.obsolete).map((job) => job.key).sort(),
      failedKeys: [...failed.keys()].sort(),
      deferredKeys: [...deferred.keys()].sort(),
      reservationCount: reservedIds.size,
      queueLimit: MAX_QUEUED_CELLS,
      residentCellCount: [...loaded.values()].filter((entry) => !entry.alias).length,
      maxCells,
      pendingCount: loading.size + queue.length,
    };
  };

  return {
    tick,
    markLoaded,
    noteSpawnElements,
    dispose,
    loadingCount: () => loading.size + queue.length,
    debugState,
  };
}
