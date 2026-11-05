import * as THREE from "three";
import { lat2ty, lon2tx, makeLocalFrame } from "@/lib/engine/geo";
import { cityCacheKey, fetchCityData } from "@/lib/engine/cityData";
import { fetchPrebuiltCell } from "@/lib/engine/prebuilt-cell-runtime";
import { rebasePrebuiltCityResult } from "@/lib/engine/prebuilt-cell-transform";
import { applyCityFeatureEdits, hasGeometryEdits } from "@/lib/engine/city-edits";
import { createPopulation } from "@/lib/engine/population";
import { createAmbience } from "@/lib/engine/ambience";
import { createStreetLights } from "@/lib/engine/street-lights";
import { createCityBuilderPool } from "@/lib/engine/city-builder";
import { clipElementsToCell } from "@/lib/engine/cell-clip";
import {
  clearBuildingNearTextureMaps,
  disposeMaterialCache,
  setBuildingTextureQuality,
  setRoadWetness,
  sharedMaterialTextures,
} from "@/lib/engine/materials";
import { createKtx2BuildingTextureLoader } from "@/lib/engine/ktx2-textures";
import { createPostFx, getPostFxPassState } from "@/lib/engine/post-fx";
import { applyAutoQuality } from "@/lib/engine/gpu-tier";
import { createSeededRandom } from "@/lib/engine/seeded-random";
import { summarizeCityElements } from "@/lib/world-repair";
import { demoHeadingRadians } from "@/lib/geo";
import { downloadCanvasPng, photoFilename } from "@/lib/share";
import { applyTouchLook, readTouchMovement, touchInputRef } from "@/lib/touch-input";
import { setEngineReady, isEngineReady, setStreetTriangles } from "@/lib/bench";
import {
  markPerf,
  measurePerf,
  measurePerfAsync,
  recordFpsSample,
  recordFrameInterval,
  recordPerfTiming,
  setPerfMetadata,
  setPerfResourceCounts,
} from "@/lib/perf";
import { assembleCityFromBuild, primeStationLabelMetrics } from "./assemble-city";
import { createCellStreamer } from "./cell-stream";
import { createCollision } from "./collision";
import { STREET } from "./constants";
import { createStreetEditor } from "./editor";
import { createEditorInput } from "./editor-input";
import { createTerrainSystem } from "./terrain";
import { computeTerrainRevision } from "./terrain-grid";
import { disposeSceneGroup } from "./resources";
import { createVehicleController } from "./vehicle";
import { createFrameRenderer, createStreetRenderer } from "./renderer-setup";
import { createShaderWarmup } from "./shader-warmup";
import { createKtx2Installer } from "./ktx2-install";
import { createSky } from "./sky";
import { createPrecipitation } from "./precipitation";
import { basePixelRatioFor, createQualityGovernor, populationBudget, populationStep, shadowMapSizeFor } from "./quality-governor";
import { chaseBoom, nearestOpenSpot, readMoveAxes, standingHeight, stepFly, stepWalk } from "./player-motion";
import { fetchLiveWeather } from "./live-weather";
import { disposePopulationModels, loadPopulationModels } from "./population-models";
import { createHeadlights, createMannequin } from "./avatar";
import { createStreetDebugApi } from "./debug-api";

const { EYE, WALK_SPEED, RUN_MULT, TERRAIN_Z: Z, COLLISION_GRID: GRID, PRECIP_WEATHER_THRESHOLD } = STREET;

const clampPitch = (pitch) => Math.max(-1.45, Math.min(1.45, pitch));
const clampHour = (hour) => Math.max(0, Math.min(24, hour));
const clampWeather = (weather) => Math.max(0, Math.min(100, weather));
const precipFor = (weather) => (weather >= PRECIP_WEATHER_THRESHOLD ? "rain" : null);

/**
 * @typedef {object} StreetUi  React-side callbacks the engine reports through.
 * @property {(text: string) => void} setStage
 * @property {(pct: number | ((p: number) => number)) => void} setReadyPct
 * @property {(on: boolean) => void} setCityStreaming
 * @property {(summary: object | null) => void} setWorldSummary
 * @property {(hud: object | ((prev: object) => object)) => void} setLiveHud
 * @property {(locked: boolean) => void} setHudLocked
 * @property {(place: string) => void} setPlace
 * @property {(temp: number) => void} setLiveTemp
 * @property {(error: Error) => void} setBootError
 * @property {Function} setUiMode
 * @property {Function} setDebugSel
 * @property {Function} setEditorMsg
 * @property {Function} setMutedUi
 */

/**
 * @typedef {object} StreetStore  Persisted game state the engine reads/writes.
 * @property {() => object} getSettings
 * @property {(patch: object) => void} changeSetting
 * @property {(meters: number, city: string, country: string | null) => void} recordWalk
 * @property {(meters: number) => void} recordElevClimb
 * @property {(trail: Array) => void} setTrail
 * @property {() => boolean} isWhereAmIActive
 */

/** City and country names from the reverse-geocoded place label. */
function placeNames(place) {
  const city = (typeof place === "string" && place) || place?.text || "Unknown";
  const country = typeof place === "string" && place.includes(",") ? place.split(",").pop()?.trim() : null;
  return { city, country };
}

/**
 * Boots the street-level world at (lat0, lon0) inside `mount` and runs it
 * until `dispose()`. Framework-free: React talks to it through `ui`, `store`
 * and the returned `api` object.
 *
 * @param {object} options
 * @param {HTMLElement} options.mount
 * @param {number} options.lat0
 * @param {number} options.lon0
 * @param {boolean} [options.resumedPosition]
 * @param {object | null} [options.demoPreset]
 * @param {"osm" | "satellite"} options.groundSource
 * @param {Readonly<import("@/lib/bench").BenchConfig>} options.bench
 * @param {StreetUi} options.ui
 * @param {StreetStore} options.store
 * @param {{ current: object | null }} options.posRef   live position for the HUD/minimap
 * @param {{ current: object | null }} options.trailRef walk trail buffer
 * @param {() => any} options.getPlace                 current place label
 */
export function createStreetRuntime({
  mount, lat0, lon0, resumedPosition = false, demoPreset = null, groundSource,
  bench, ui, store, posRef, trailRef, getPlace,
}) {
  let disposed = false;
  // Shared mutable state handed to the assembly/streaming/editor modules,
  // which read and append to it (buildingMats, roadPaths, propMarkers, …).
  // Its methods are also the API React calls.
  const runtime = { current: {} };
  const api = runtime.current;
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  const readOnlyCityData = bench.readOnlyCityData;
  const cityBuilder = createCityBuilderPool(bench.geometryWorkers ? { size: bench.geometryWorkers } : undefined);
  const buildOptions = {
    profileQueries: bench.profileCityQueries,
    roadQueryMode: bench.roadQueryMode,
    collectShadowTargets: bench.collectShadowTargets,
  };
  setEngineReady(false);
  setStreetTriangles(0);

  // ---- network requests that do not depend on the scene start at t=0 ----
  // The asset-library list used to start ~9.4 s in (after the city build) and
  // cost another 1.5 s serially.
  const assetListPromise = fetch("/api/assets", { signal })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  api.assetListPromise = assetListPromise;
  const editsKey = cityCacheKey(lat0, lon0);
  const editsPromise = fetch(`/api/edits/${editsKey}`, { signal })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const fetchRawCityData = () => fetchCityData(lat0, lon0, { signal, readonly: readOnlyCityData }).catch((e) => {
    console.warn("[street] city data:", e?.message);
    return null;
  });
  // A prebuilt cell is only usable when the terrain it was baked against
  // matches ours. Validation starts as soon as the prebuilt entry arrives.
  let prebuiltTerrainValidationPromise = null;
  const startPrebuiltValidation = (entry) => {
    prebuiltTerrainValidationPromise = measurePerfAsync("city.prebuilt-terrain-revision", () => validatePrebuiltTerrain(entry));
    return prebuiltTerrainValidationPromise;
  };
  const cityDataPromise = measurePerfAsync("city.initial-data-consumer", async () => {
    const edits = await editsPromise;
    if (!bench.enabled && edits && !hasGeometryEdits(edits)) {
      const prebuilt = await fetchPrebuiltCell(editsKey, { signal, validateEntry: startPrebuiltValidation });
      if (prebuilt) return prebuilt;
    }
    return fetchRawCityData();
  }).catch((e) => {
    console.warn("[street] city data:", e?.message);
    return null;
  });

  const { toLocal, toGeo } = makeLocalFrame(lat0, lon0);

  // ---- renderer, scene, camera ----
  const { renderer, gpu, gpuTimer, shadows, useMsaa } = createStreetRenderer(mount, { benchEnabled: bench.enabled });
  const scene = new THREE.Scene();
  const sky = createSky(scene, renderer);
  const { sun } = sky;
  // near 0.35 (not 0.1): with far=6000 the depth-buffer ratio drops 3.5x,
  // which stops distant facades z-shimmering (long straight terraces).
  const camera = new THREE.PerspectiveCamera(70, mount.clientWidth / mount.clientHeight, 0.35, 6000);
  camera.rotation.order = "YXZ";

  let qualityTier = "medium";
  let postFx = null;
  let postFxOverride = null;
  let nightAmount = 0;
  let runtimeHour = 12;
  let weatherAmount = 0;
  const getPostFx = () => postFx;
  const getQualityTier = () => qualityTier;

  // ---- render scale: the tier sets a base pixel ratio; the governor scales
  // it between 0.6x and 1x. Disabled in benchmark mode. ----
  let basePixelRatio = Math.min(window.devicePixelRatio || 1, useMsaa ? 1.5 : 1.25);
  const defaultRenderScaleFor = (quality) => {
    if (bench.renderScale !== null) return bench.renderScale;
    // Auto mode starts integrated Intel GPUs below native scale so the first
    // frames stay inside the governor target. Manual presets keep full scale.
    return gpu.isIntelIntegrated && quality !== "low" && store.getSettings()?.qualityMode !== "manual" ? 0.85 : 1;
  };
  const governor = createQualityGovernor({
    initialScale: defaultRenderScaleFor(store.getSettings()?.quality || "medium"),
    governorEnabled: !bench.enabled,
    now: performance.now(),
  });
  renderer.setPixelRatio(basePixelRatio * governor.scale);
  const applyRenderScale = () => {
    renderer.setPixelRatio(basePixelRatio * governor.scale);
    if (!postFx) return;
    postFx.setSize(mount.clientWidth, mount.clientHeight);
    postFx.setFxaa(!useMsaa && governor.scale < 1);
  };

  const ktx2Installer = createKtx2Installer(renderer);
  const ktx2TextureLoader = createKtx2BuildingTextureLoader(renderer, {
    signal,
    onSharedReady: ktx2Installer.install,
    onHighReady: ktx2Installer.install,
    onHighDispose: clearBuildingNearTextureMaps,
    onError: (error, tier) => console.warn(
      `[street] ${tier === "high" ? "high-tier KTX2 maps unavailable" : "KTX2 facade maps unavailable"}; current facade maps remain active:`,
      error?.message || error,
    ),
  });

  // Auto-pick quality on first boot (skipped if the visitor locked a preset).
  const bootQuality = applyAutoQuality(store.getSettings, store.changeSetting, renderer);

  const renderFrame = createFrameRenderer({ renderer, scene, camera, gpuTimer, shadows, getPostFx, getQualityTier });
  const warmup = createShaderWarmup({ renderer, scene, camera, getPostFx, getQualityTier, requestShadowRefresh: shadows.request });
  postFx = createPostFx(renderer, scene, camera);
  postFx.setSize(mount.clientWidth, mount.clientHeight);

  // ---- player, terrain, collision, vehicle ----
  const player = { x: 0, z: 0, heading: 0, pitch: 0, third: false, moving: false };
  const keys = {};
  const terrain = createTerrainSystem({
    scene, lat0, lon0, toLocal, signal, groundSource,
    onStage: ui.setStage, onProgress: ui.setReadyPct,
  });
  const { terrainTiles, tileCanvases } = terrain;
  const groundHeight = terrain.height;
  const patchTerrain = terrain.patch;
  const { addFootprint, insideBuilding, footprintAt, footprintsNear, removeFootprintsByCell } = createCollision(GRID);
  const vehicle = createVehicleController({ insideBuilding, groundHeight: (x, z) => groundHeight(x, z) });
  const headlights = createHeadlights(scene);
  let population = null;
  const ambience = createAmbience();
  ambience.set({ music: store.getSettings()?.music !== false });
  const precipitation = createPrecipitation(scene);

  // ---- high-tier street lights: a fixed pool of four spotlights ----
  // The light count is part of every lit shader's key, so the pool is
  // reserved before the first frame and kept at zero intensity below high.
  let streetLights = null;
  let streetLightWorldReady = false;
  let streetLampSource = null;
  let streetLampMarkers = [];
  let streetLightEnabledTier = null;
  const ensureStreetLightPool = () => {
    const markers = runtime.current.propMarkers || [];
    if (markers !== streetLampSource) {
      streetLampSource = markers;
      streetLampMarkers = markers.filter((marker) => marker.kind === "lamp");
      streetLights?.setLamps(streetLampMarkers, groundHeight);
    }
    if (qualityTier === "high" && !streetLights) {
      streetLights = createStreetLights(scene, { maxLights: 4, keepInactiveVisible: !bench.hideInactiveStreetLights });
      runtime.current.streetLights = streetLights;
      streetLightEnabledTier = null;
      streetLights.setLamps(streetLampMarkers, groundHeight);
    }
    return streetLights;
  };
  const syncStreetLightQuality = () => {
    if (!streetLightWorldReady) return;
    ensureStreetLightPool();
    if (!streetLights) return;
    const enabled = qualityTier === "high";
    if (streetLightEnabledTier !== enabled) {
      streetLights.setNight(enabled ? nightAmount : 0);
      streetLightEnabledTier = enabled;
    }
    streetLights.update(player);
  };

  // ---- quality presets ----
  // `auto` marks a runtime step from the fps guard. It must not touch anything
  // in a shader's program key (shadowMap.enabled, castShadow): flipping those
  // recompiles every lit material at once, a multi-second freeze on weak GPUs
  // exactly when the frame rate is already struggling. Shadows stay on (with
  // the low tier's small map) until the visitor picks "low" themselves.
  const applyQuality = (q, { auto = false } = {}) => {
    const quality = q || "medium";
    const previousShadow = [renderer.shadowMap.enabled, sun.castShadow, sun.shadow.mapSize.x];
    basePixelRatio = basePixelRatioFor(quality, window.devicePixelRatio);
    governor.reset(defaultRenderScaleFor(quality));
    renderer.setPixelRatio(basePixelRatio * governor.scale);
    if (!auto) {
      renderer.shadowMap.enabled = quality !== "low";
      sun.castShadow = quality !== "low";
    }
    const mapSize = shadowMapSizeFor(quality);
    sun.shadow.mapSize.set(mapSize, mapSize);
    if (previousShadow[0] !== renderer.shadowMap.enabled ||
        previousShadow[1] !== sun.castShadow ||
        previousShadow[2] !== sun.shadow.mapSize.x) {
      shadows.request("quality-change");
    }
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    postFx.setSize(mount.clientWidth, mount.clientHeight);
    postFx.setFxaa(!useMsaa && governor.scale < 1);
    // Remember the tier; applyEnvironment re-evaluates so night can turn bloom on.
    qualityTier = quality;
    warmup.warmPostFx();
    const nearTextures = ktx2TextureLoader.setQuality(quality);
    setBuildingTextureQuality(nearTextures ? "high" : quality);
    if (!nearTextures) ktx2Installer.releaseHigh();
    const passes = postFxOverride || getPostFxPassState(quality, nightAmount);
    // An auto step keeps the composer as it is (see getPostFxPassState).
    postFx.setEnabled(passes.active, passes.ssao, auto ? postFx.composerActive : passes.composer, passes.bloom);
    setPerfMetadata({
      qualityTier: quality,
      pixelRatio: renderer.getPixelRatio(),
      renderScale: governor.scale,
      integratedGpu: gpu.isIntelIntegrated,
      shadowMapEnabled: renderer.shadowMap.enabled,
      postFxActive: postFx.active,
      ssaoActive: postFx.ssaoActive,
      bloomActive: postFx.bloomActive,
    });
    syncStreetLightQuality();
  };
  applyQuality(bootQuality || store.getSettings()?.quality || "medium");
  // Reserve the high-tier lights before the first terrain-only frame. Lit
  // terrain materials bake the visible spotlight count into their shader key.
  if (qualityTier === "high") ensureStreetLightPool();

  // ---- time of day and weather ----
  const applyEnvironment = (hour) => {
    const { glow, night } = sky.apply(hour, weatherAmount);
    for (const material of runtime.current.buildingMats || []) material.emissiveIntensity = glow;
    nightAmount = glow;
    streetLights?.setNight(qualityTier === "high" ? glow : 0);
    // Slight "bloom" via brighter additive lamp pools at night.
    for (const pool of runtime.current.lampPoolMaterials || []) pool.opacity = glow * (1.05 + glow * 0.35);
    postFx?.setNightBloom(glow);
    shadows.updateSunBucket(hour);
    // Night grade: bloom on at night for medium+. Time of day only toggles
    // effects; the composer stays as the tier set it.
    const passes = postFxOverride || getPostFxPassState(qualityTier, glow);
    postFx.setEnabled(passes.active, passes.ssao, postFx.composerActive, passes.bloom);
    setPerfMetadata({
      hour,
      weather: weatherAmount * 100,
      postFxActive: postFx.active,
      ssaoActive: postFx.ssaoActive,
      bloomActive: postFx.bloomActive,
    });
    // HDR lamp colours (> 1) so bloom catches the bulbs; a clamped colour
    // sits under the threshold and never blooms.
    for (const material of runtime.current.lampGlows || []) {
      if (night) material.color.setRGB(1.8, 1.45, 0.95);
      else material.color.setHex(0x1a1c20);
    }
  };
  api.setTime = (hour) => {
    runtimeHour = hour;
    applyEnvironment(hour);
  };
  api.setWeather = (weather) => {
    weatherAmount = weather / 100;
    // Rain makes asphalt reflective: mirror streaks under lamps.
    setRoadWetness(weatherAmount);
    applyEnvironment(runtimeHour);
  };
  api.refreshEnvironment = () => {
    applyEnvironment(runtimeHour);
    shadows.request("scene-geometry-ready");
  };
  api.setPrecip = (mode) => precipitation.set(mode);
  api.setQuality = (q) => applyQuality(q);
  api.setMusic = (on) => ambience.set({ music: on !== false });

  // ---- editor ----
  const editorTools = createStreetEditor({
    scene, renderer, camera, player, engineRef: runtime, ambience, editsKey,
    toLocal, toGeo, groundHeight, patchTerrain, footprintAt, signal,
    setUiMode: ui.setUiMode, setDebugSel: ui.setDebugSel, setEditorMsg: ui.setEditorMsg, setMutedUi: ui.setMutedUi,
  });
  const { editor, fly, debugPick, editorClick, setMode, pickPoint, resolveOsmAt, loadGLB, placeAsset } = editorTools;
  const editorInput = createEditorInput({
    editorTools, scene, engineRef: runtime, toGeo, toLocal, groundHeight, patchTerrain, setEditorMsg: ui.setEditorMsg,
  });

  api.captureScreenshot = (placeLabel) => {
    renderFrame();
    const cur = posRef.current || { lat: lat0, lon: lon0 };
    return downloadCanvasPng(renderer.domElement, photoFilename(placeLabel, cur.lat, cur.lon));
  };

  const spinners = [];
  const lampGlows = [];
  let avatar = null;
  let running = true;

  // ---- spawn city: worker geometry + main-thread assembly ----
  const validatePrebuiltTerrain = async (candidate) => {
    try {
      const metadata = candidate?.metadata || candidate;
      if (metadata?.terrainZoom !== Z || !Array.isArray(metadata.terrainTileKeys) || !metadata.terrainTileKeys.length) return false;
      const tileCount = metadata.terrainTileKeys.length;
      const ready = await measurePerfAsync("city.prebuilt-terrain-tiles",
        () => terrain.ensureHeightTiles(metadata.terrainTileKeys), { tileCount });
      if (!ready) return false;
      const revision = await measurePerfAsync("city.prebuilt-terrain-hash",
        () => computeTerrainRevision(terrainTiles, metadata.terrainTileKeys, globalThis.crypto, (phase, durationMs, details) => {
          recordPerfTiming(`city.prebuilt-terrain-hash-${phase}`, durationMs, details);
        }), { tileCount });
      return revision === metadata.terrainRevision;
    } catch {
      return false;
    }
  };
  const cityDataWithValidation = cityDataPromise.then((data) => {
    if (data?.kind === "prebuilt" && !disposed && !prebuiltTerrainValidationPromise) startPrebuiltValidation(data);
    return data;
  });

  const resetCityRuntimeLists = () => {
    for (const key of ["buildingMats", "roadPaths", "propMarkers", "pois", "bridgeDecks", "spinners", "lampGlows", "lampPoolMaterials"]) {
      runtime.current[key] = [];
    }
  };

  let spawnCellUsedPrebuilt = false;
  const loadCity = async (data) => {
    spawnCellUsedPrebuilt = false;
    const prebuilt = data?.kind === "prebuilt";
    if (!prebuilt && (!data?.elements?.length || data.partial)) return false;
    let prebuiltResult = null;
    let elements = [];
    let elementCount = data?.elements?.length || 0;
    if (prebuilt) {
      const metadata = data.metadata;
      const revisionsMatch = metadata.terrainZoom === Z &&
        metadata.editorRevision === "unmodified" && !hasGeometryEdits(runtime.current.edits);
      const terrainMatches = revisionsMatch && await (prebuiltTerrainValidationPromise || startPrebuiltValidation(data));
      if (!terrainMatches) {
        markPerf("city-prebuilt-fallback", {
          key: metadata.key,
          reason: !revisionsMatch ? "edits-or-terrain-version" : "terrain-unavailable-or-revision-mismatch",
        });
        const raw = await fetchRawCityData();
        if (!raw?.elements?.length || raw.partial) return false;
        ui.setWorldSummary(summarizeCityElements(raw.elements));
        const edited = hasGeometryEdits(runtime.current.edits)
          ? { ...raw, elements: applyCityFeatureEdits(raw.elements, runtime.current.edits) }
          : raw;
        return loadCity(edited);
      }
      spawnCellUsedPrebuilt = true;
      elementCount = metadata.clippedElementCount;
      prebuiltResult = measurePerf("city.prebuilt-frame-rebase",
        () => rebasePrebuiltCityResult(data.result, metadata.origin, { lat: lat0, lon: lon0 }),
        { key: metadata.key, clippedElements: metadata.clippedElementCount });
      if (data.result.meta?.stations?.length) primeStationLabelMetrics();
    } else {
      // Ownership clip: keep every corridor from the fetch; buildings/props
      // only inside the spawn tile so neighbours can own the rest.
      elements = measurePerf("city.spawn-clip", () => clipElementsToCell(data.elements, lat0, lon0), {
        inputElements: data.elements.length,
      });
      if (!elements.length) return true;
    }
    ui.setStage(prebuilt ? "Loading prebuilt city…" : `Building city (${elements.length} features)…`);
    ui.setReadyPct((p) => Math.max(p, 60));
    const cityRoot = new THREE.Group();
    // Hidden until its shaders are compiled (see shader-warmup.js).
    cityRoot.visible = false;
    scene.add(cityRoot);
    try {
      if (disposed) return false;
      const geometryPromise = prebuilt
        ? Promise.resolve(prebuiltResult)
        : measurePerfAsync("city.spawn-geometry-total", () => cityBuilder.build({
            signal,
            elements,
            lat0,
            lon0,
            terrainTiles,
            ...buildOptions,
            onProgress: (done, total) => {
              ui.setStage(`Building city (${done}/${total})…`);
              ui.setReadyPct((p) => Math.max(p, 60 + Math.floor((done / Math.max(1, total)) * 25)));
            },
          }), { elements: elements.length });
      if (elements.some((element) => element.type === "node" && element.tags?.railway === "station")) primeStationLabelMetrics();
      const built = await geometryPromise;
      if (disposed) return;
      ui.setStage("Assembling city…");
      await measurePerfAsync("city.spawn-assembly-total", () => assembleCityFromBuild(built, {
        root: cityRoot,
        signal,
        scene,
        groundHeight,
        toLocal,
        addFootprint,
        insideBuilding,
        tileCanvases,
        engineRef: runtime,
        player,
        lat0,
        lon0,
        spinners,
        lampGlows,
        cellKey: editsKey,
        resumedPosition,
        skipOverture: bench.enabled,
      }), { elements: elementCount, prebuilt });
      // Keep the scene's light count stable across shader warm-up and first
      // render; later streamed cells may add lamp markers.
      if (qualityTier === "high") ensureStreetLightPool();
      await warmup.warmCell(cityRoot, prebuilt ? "city.prebuilt-shader-warmup" : "city.spawn-shader-warmup");
      if (disposed) return false;
      await warmup.warmShadowDepth(cityRoot, "city.spawn-shadow-depth-warmup");
      if (disposed) return false;
      cityRoot.visible = true;
      shadows.request("city-root-visible");
      return true;
    } catch (e) {
      disposeSceneGroup(cityRoot, scene, sharedMaterialTextures());
      removeFootprintsByCell(editsKey);
      resetCityRuntimeLists();
      if (!disposed) console.warn("[street] city build failed:", e?.message || e);
      return false;
    }
  };

  /** Streams Terrarium + ground imagery as the player leaves the spawn 3x3. */
  const ensureTerrainAround = (lat, lon) => {
    const ctx = Math.floor(lon2tx(lon, Z));
    const cty = Math.floor(lat2ty(lat, Z));
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (terrainTiles.has(`${ctx + dx}/${cty + dy}`)) continue;
        terrain.loadTile(ctx + dx, cty + dy, false).catch(() => {});
      }
    }
    terrain.evictFar(ctx, cty, 2); // unload tiles more than 2 rings away
  };

  // ---- input ----
  const canvas = renderer.domElement;
  const exitVehicle = () => {
    const pose = vehicle.exit();
    population?.releaseCar?.(pose.carIndex, pose);
    player.x = pose.x;
    player.z = pose.z;
    player.heading = pose.heading;
    player.third = false;
    if (avatar) avatar.visible = false;
    headlights.off();
    ambience.set?.({ engine: 0 });
  };
  const enterNearestVehicle = () => {
    if (!population?.getNearestCar) return;
    const near = population.getNearestCar(player.x, player.z, 6.5);
    if (near && population.takeCar(near.index)) {
      vehicle.enter(near, near.index);
      player.third = true;
      if (avatar) avatar.visible = false;
    }
  };
  const onClick = (e) => {
    ambience.start();
    if (editorInput.onClick(e)) return;
    if (editor.mode === "debug") { debugPick(e); return; }
    if (editor.mode === "editor") { editorClick(e); return; }
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
  };
  const onKey = (e) => {
    keys[e.code] = e.type === "keydown";
    if ((editor.mode || fly.photo) && (e.code === "Space" || e.code === "KeyC")) e.preventDefault();
    if (e.type !== "keydown" || e.repeat) return;
    if (e.code === "KeyV" && !vehicle.active) {
      player.third = !player.third;
      if (avatar) avatar.visible = player.third;
    }
    if (e.code === "KeyC" && !editor.mode && !fly.photo) {
      e.preventDefault();
      if (vehicle.active) exitVehicle();
      else enterNearestVehicle();
    }
    if (e.code === "KeyE") setMode("editor");
    if (e.code === "KeyB") setMode("debug");
    editorInput.onKeyDown(e);
  };
  const onMouse = (e) => {
    if (editorInput.onMouseMove(e)) return;
    if (document.pointerLockElement !== canvas) return;
    if (fly.photo) {
      fly.heading += e.movementX * 0.0022;
      fly.pitch = clampPitch(fly.pitch - e.movementY * 0.0022);
      return;
    }
    // Driving: WASD only; the camera follows the car.
    if (vehicle.active) return;
    player.heading += e.movementX * 0.0022;
    player.pitch = clampPitch(player.pitch - e.movementY * 0.0022);
  };
  const onLock = () => ui.setHudLocked(document.pointerLockElement === canvas);
  const onResize = () => {
    camera.aspect = mount.clientWidth / mount.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    postFx?.setSize(mount.clientWidth, mount.clientHeight);
  };
  const listeners = [
    [canvas, "click", onClick],
    [canvas, "mousedown", editorInput.onMouseDown],
    [window, "mouseup", editorInput.onMouseUp],
    [canvas, "wheel", editorInput.onWheel, { passive: false }],
    [canvas, "contextmenu", editorInput.onContextMenu],
    [window, "keydown", onKey],
    [window, "keyup", onKey],
    [document, "mousemove", onMouse],
    [document, "pointerlockchange", onLock],
    [window, "resize", onResize],
  ];
  for (const [target, type, handler, options] of listeners) target.addEventListener(type, handler, options);

  // ---- walk statistics (passport) ----
  let walkMetersAccum = 0;
  let elevClimbAccum = 0;
  const flushWalk = () => {
    if (walkMetersAccum <= 0 && elevClimbAccum <= 0) return;
    if (walkMetersAccum > 0) {
      const { city, country } = placeNames(getPlace());
      store.recordWalk(walkMetersAccum, city, country);
      walkMetersAccum = 0;
    }
    if (elevClimbAccum > 0) {
      store.recordElevClimb(elevClimbAccum);
      elevClimbAccum = 0;
    }
  };
  const addWalked = (meters) => {
    walkMetersAccum += meters;
    if (walkMetersAccum >= 8) flushWalk();
  };

  // ---- main loop ----
  let lastShadowX = 1e9, lastShadowZ = 1e9; // force a first bake
  const clock = new THREE.Clock();
  let fpsCount = 0, fpsTime = performance.now(), fpsVal = 0, hudTick = 0, ambTick = 0, trailTick = 0;
  let lastFrameAt = null;
  let lastPerfResourceSampleAt = 0;
  let populationAccum = 0;
  let liveHudAt = 0; // setLiveHud throttle (<= 2 Hz)
  let lastElev = null;
  // per-frame scratch (no allocation in the hot loop)
  const nearRoadOpts = { nearRoad: true };
  let nearRoadAcc = 1, nearRoadCached = true; // nearDrivable throttled to ~4 Hz
  const posObj = { lat: 0, lon: 0, heading: 0, height: 0 };

  const sampleFrameTiming = (frameAt) => {
    if (frameAt - lastPerfResourceSampleAt >= 1000) {
      setPerfResourceCounts({
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? null,
      });
      lastPerfResourceSampleAt = frameAt;
    }
    const visible = document.visibilityState === "visible";
    if (visible && lastFrameAt !== null) {
      recordFrameInterval(frameAt - lastFrameAt);
      governor.addFrame(frameAt - lastFrameAt);
    }
    lastFrameAt = visible ? frameAt : null;
  };

  /** Drives the car one step; returns true while driving. */
  const stepVehicle = (dt, f, r) => {
    nearRoadAcc += dt;
    if (nearRoadAcc >= 0.25) {
      nearRoadAcc = 0;
      nearRoadCached = population?.nearDrivable?.(vehicle.state.x, vehicle.state.z) !== false;
    }
    nearRoadOpts.nearRoad = nearRoadCached;
    const pose = vehicle.update(dt, { f, r }, nearRoadOpts);
    if (!pose) return;
    player.x = pose.x;
    player.z = pose.z;
    // Walk heading stays for HUD/minimap; the car mesh uses pose.heading (+Z).
    // The conversion is a MIRROR (walk 0 = -Z, car 0 = +Z), not a pi offset.
    player.heading = Math.PI - pose.heading;
    player.pitch = 0;
    population?.setDrivenPose?.(pose.carIndex, pose);
    headlights.update(pose, runtimeHour < 6.5 || runtimeHour >= 19);
    ambience.set?.({ engine: Math.min(1, Math.abs(pose.speed) / 22) });
    player.moving = Math.abs(pose.speed) > 0.3;
    if (player.moving) addWalked(Math.abs(pose.speed) * dt);
  };

  const placeCamera = (gy) => {
    if (editor.mode || fly.photo) return;
    if (vehicle.active) {
      // Chase cam locked behind the car: lookAt, so WASD turns the car, not the view.
      const sin = Math.sin(vehicle.state.heading), cos = Math.cos(vehicle.state.heading);
      const back = chaseBoom(player.x, player.z, sin, cos, 11, insideBuilding);
      const cx = player.x - sin * back, cz = player.z - cos * back;
      camera.position.set(cx, Math.max(gy + 4.2, groundHeight(cx, cz) + 0.6), cz);
      camera.lookAt(player.x, gy + 1.2, player.z);
    } else if (player.third) {
      if (avatar) {
        avatar.position.set(player.x, gy, player.z);
        avatar.rotation.y = -player.heading + Math.PI;
      }
      // Chase camera: shorten the boom out of buildings, never below terrain.
      const sin = Math.sin(player.heading), cos = Math.cos(player.heading);
      const back = chaseBoom(player.x, player.z, sin, -cos, 7, insideBuilding);
      const cx = player.x - sin * back, cz = player.z + cos * back;
      camera.position.set(cx, Math.max(gy + 3, groundHeight(cx, cz) + 0.6), cz);
      camera.rotation.y = -player.heading;
      camera.rotation.x = -0.22 + player.pitch * 0.4;
    } else {
      camera.position.set(player.x, gy + EYE, player.z);
      camera.rotation.y = -player.heading;
      camera.rotation.x = player.pitch;
    }
  };

  const evaluateQualityOncePerSecond = (now) => {
    fpsVal = Math.round((fpsCount * 1000) / (now - fpsTime));
    fpsCount = 0;
    fpsTime = now;
    // Auto benchmarks keep the GPU-detected boot tier; live sessions keep
    // adapting presets after the render-scale governor bottoms out.
    const autoPresets = store.getSettings().qualityMode !== "manual" && !bench.enabled;
    const { scaleChanged, nextTier } = governor.evaluate({ fps: fpsVal, tier: qualityTier, autoPresets, now });
    if (scaleChanged) applyRenderScale();
    if (nextTier) {
      qualityTier = nextTier;
      applyQuality(nextTier, { auto: true });
      store.changeSetting({ quality: nextTier, qualityMode: "auto" });
    }
  };

  const loop = (rafTimestamp) => {
    if (!running) return;
    requestAnimationFrame(loop);
    sampleFrameTiming(Number.isFinite(rafTimestamp) ? rafTimestamp : performance.now());
    const dt = Math.min(clock.getDelta(), 0.1);

    const touch = touchInputRef.current;
    const axes = readMoveAxes(keys, touch ? readTouchMovement(touch) : null);
    if (touch) applyTouchLook(touch, player, 1, { driving: vehicle.active });
    let { f, r } = axes;
    const freeFly = !!(editor.mode || fly.photo);
    if (freeFly) {
      const speed = (keys.ShiftLeft || keys.ShiftRight ? 75 : 28) * dt;
      stepFly(fly, f, r, (keys.Space ? 1 : 0) - (keys.KeyC ? 1 : 0), speed);
      const minY = groundHeight(fly.x, fly.z) + 1.2;
      if (fly.y < minY) fly.y = minY;
      camera.position.set(fly.x, fly.y, fly.z);
      camera.rotation.y = -fly.heading;
      camera.rotation.x = fly.pitch;
      f = 0;
      r = 0;
    }
    player.moving = freeFly ? false : !!(f || r);
    if (vehicle.active && !freeFly) {
      stepVehicle(dt, f, r);
    } else if (player.moving) {
      nearRoadAcc = 1; // re-sample immediately when the next drive starts
      const run = keys.ShiftLeft || keys.ShiftRight || touch?.sprint ? RUN_MULT : 1;
      const moved = stepWalk(player, f, r, WALK_SPEED * run * dt, insideBuilding);
      if (moved > 0) addWalked(moved);
    }
    syncStreetLightQuality();
    const gy = standingHeight(runtime.current.bridgeDecks, player.x, player.z, groundHeight(player.x, player.z));
    placeCamera(gy);

    for (const spinner of runtime.current.spinners || []) spinner.rotation.z += dt * 1.4;
    // Population motion does not need the display refresh rate: a 30 Hz
    // simulation still reads as smooth because transforms are held between
    // updates, and it saves terrain samples and matrix writes on mobile.
    if (bench.freezePopulation) {
      populationAccum = 0;
    } else {
      populationAccum += dt;
      const step = populationStep(qualityTier);
      if (population && (step === 0 || populationAccum >= step)) {
        population.update(populationAccum, player, runtimeHour, precipitation.active);
        populationAccum = 0;
      }
    }
    if (++ambTick % 120 === 0) ambience.set({ hour: runtimeHour, raining: precipitation.active });
    precipitation.update(dt, player.x, gy, player.z);
    sky.followPlayer(player.x, gy, player.z);
    // Re-bake shadows only after meaningful movement (the frustum is +/-180 m).
    if (Math.abs(player.x - lastShadowX) > 25 || Math.abs(player.z - lastShadowZ) > 25) {
      lastShadowX = player.x;
      lastShadowZ = player.z;
      shadows.request("player-moved");
    }

    const g = toGeo(player.x, player.z);
    posObj.lat = g.lat;
    posObj.lon = g.lon;
    posObj.heading = player.heading;
    posObj.height = gy + 2;
    posRef.current = posObj;
    // Stream neighbour city cells + terrain as the player walks (~every 0.5 s).
    if (hudTick % 30 === 0) {
      runtime.current.cellStreamer?.tick(g.lat, g.lon);
      ensureTerrainAround(g.lat, g.lon);
    }
    // Trail + elevation climbed go to a live buffer, not React state.
    if (++trailTick % 8 === 0 && player.moving) {
      trailRef.current?.push(g.lat, g.lon);
      if (trailTick % 96 === 0) {
        const snap = trailRef.current?.takeDirty();
        if (snap) store.setTrail(snap);
      }
    }
    if (lastElev != null && gy > lastElev + 0.15) elevClimbAccum += gy - lastElev;
    lastElev = gy;

    renderFrame();

    fpsCount++;
    const now = performance.now();
    if (now - fpsTime >= 1000) evaluateQualityOncePerSecond(now);
    if (++hudTick % 20 === 0) {
      recordFpsSample(fpsVal);
      // Each setLiveHud re-renders the React tree, and elevation changes every
      // metre on slopes, so cap it at ~2 Hz.
      if (now - liveHudAt >= 500) {
        liveHudAt = now;
        const elev = Math.round(gy);
        ui.setLiveHud((prev) => (prev.fps === fpsVal && prev.elev === elev ? prev : { fps: fpsVal, elev }));
      }
    }
  };

  // ---- boot ----
  const applyBootEnvironment = () => {
    const settings = store.getSettings() || {};
    // Demo arrival (?demo=1) applies the city's preset once instead of the
    // saved time/weather; the visitor can still change both afterwards.
    const demoApplied = !!demoPreset && !bench.enabled;
    const hour = demoApplied && Number.isFinite(demoPreset.hour) ? clampHour(demoPreset.hour)
      : Number.isFinite(settings.hour) ? clampHour(settings.hour) : 12;
    const weather = demoApplied && Number.isFinite(demoPreset.weather) ? clampWeather(demoPreset.weather)
      : Number.isFinite(settings.weather) ? clampWeather(settings.weather) : 0;
    if (demoApplied) store.changeSetting({ hour, weather });
    api.setTime(hour);
    api.setWeather(weather);
    api.setPrecip(precipFor(weather));
    setPerfMetadata({ hour, weather, precipitationMode: precipFor(weather) });
    return { demoApplied, demoHeading: demoApplied ? demoHeadingRadians(demoPreset) : null };
  };

  /** Hidden features and tag overrides, without mutating the cached payload. */
  const applyElementEdits = (cityData, edits) => {
    if (!cityData || cityData.kind === "prebuilt") return cityData;
    const hasElementEdits = edits.hidden?.length || (edits.tagOverrides && Object.keys(edits.tagOverrides).length);
    return hasElementEdits ? { ...cityData, elements: applyCityFeatureEdits(cityData.elements || [], edits) } : cityData;
  };

  const startCellStreaming = (cityBuilt, cityData) => {
    const cellStreamer = createCellStreamer({
      scene,
      // Shadows are baked manually; refresh once streamed cells finish rising.
      onRiseEnd: () => shadows.request("streamed-cell-rise"),
      lat0,
      lon0,
      toLocal,
      groundHeight,
      addFootprint,
      insideBuilding,
      removeFootprintsByCell,
      tileCanvases,
      engineRef: runtime,
      player,
      terrainTiles,
      ensureTerrainTiles: terrain.ensureTiles,
      validatePrebuiltCell: validatePrebuiltTerrain,
      applyTerrainEdits: (cellEdits) => applyTerrainPatches(cellEdits?.terrain),
      warmCellShaders: warmup.warmCell,
      isDisposed: () => disposed,
      onLoading: (n) => {
        if (disposed) return;
        if (n > 0) {
          ui.setCityStreaming(true);
          ui.setStage("Streaming nearby streets · keep exploring");
        } else {
          ui.setCityStreaming(!isEngineReady());
          ui.setStage(isEngineReady() ? "Ready" : "City unavailable · retrying shortly");
        }
      },
      onCellLoaded: () => { if (!disposed) setEngineReady(true); },
      maxCells: 10,
      buildCity: (args) => cityBuilder.build({ ...args, ...buildOptions }),
    });
    if (cityBuilt) {
      cellStreamer.markLoaded(editsKey, lat0, lon0);
      if (spawnCellUsedPrebuilt) cellStreamer.noteSpawnIds?.(cityData?.metadata?.featureIds);
      else cellStreamer.noteSpawnElements?.(cityData?.elements);
    }
    runtime.current.cellStreamer = cellStreamer;
    // Kick off the ring of neighbours immediately.
    cellStreamer.tick(lat0, lon0);
  };

  const applyTerrainPatches = (patches) => {
    for (const tp of patches || []) {
      const c = toLocal(tp.lat, tp.lon);
      patchTerrain(c.x, c.z, tp.radius || 10, tp.height);
    }
  };

  const startPopulation = async (cityData) => {
    try {
      const models = await loadPopulationModels(assetListPromise, loadGLB);
      if (disposed) {
        disposePopulationModels(models);
        return;
      }
      population = createPopulation({
        scene,
        groundHeight,
        roadPaths: runtime.current.roadPaths || [],
        pois: runtime.current.pois || [],
        models,
        signals: (runtime.current.propMarkers || []).filter((p) => p.kind === "signals"),
        insideBuilding,
        footprintsNear,
        ...populationBudget(qualityTier),
        initiallyVisible: false,
        random: bench.enabled ? createSeededRandom(bench.seed) : Math.random,
      });
      await warmup.warmPopulation(population.group, population.pedestrianMesh);
      if (disposed) return;
      console.log("[population]", population.counts);
      // The high-tier pool was reserved during setup. Now that spawn markers
      // are known, assign nearby lamps; below high it stays at zero intensity.
      streetLightWorldReady = true;
      syncStreetLightQuality();
      const enrichedDensity = Number(cityData?.enrichment?.density?.urban) || 0;
      ambience.set({ density: Math.min(1, Math.max(population.counts.peds / 140, enrichedDensity * 0.65)) });
      runtime.current.population = population;
    } catch (err) {
      console.warn("[population]", err?.message);
    }
  };

  const syncPlaceName = () => {
    // Skipped during Where-am-I so the answer never leaks.
    if (store.isWhereAmIActive()) return;
    fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat0}&longitude=${lon0}&localityLanguage=en`, { signal })
      .then((r) => r.json())
      .then((d) => {
        if (disposed || store.isWhereAmIActive()) return;
        const line = [d.locality || d.city, d.countryName].filter(Boolean).join(", ");
        if (line) ui.setPlace(line);
      })
      .catch((e) => console.warn("[street] reverse geocode:", e?.message));
  };

  api.applyRealWeather = async () => {
    try {
      const live = await fetchLiveWeather(lat0, lon0, { signal });
      if (disposed) return null;
      api.setTime(live.hour);
      api.setWeather(live.weather);
      api.setPrecip(live.precip);
      return { hour: Math.round(live.hour * 2) / 2, weather: Math.round(live.weather), temp: live.temp, rain: live.rain };
    } catch {
      return null;
    }
  };

  const boot = async () => {
    await measurePerfAsync("terrain.initial-load", () => terrain.load());
    if (disposed) return;
    markPerf("terrain-ready", { loadedTiles: terrainTiles.size, flatFallback: terrainTiles.size === 0 });
    const { demoApplied, demoHeading } = applyBootEnvironment();
    avatar = createMannequin();
    scene.add(avatar);
    loop();

    // Progressive first paint: the world is walkable on terrain alone (the
    // ground texture already shows roads and blocks), so the loading screen
    // drops now and the city streams in behind a small toast.
    ui.setReadyPct(100);
    ui.setCityStreaming(true);
    ui.setStage("Streaming city…");
    markPerf("input-ready", { terrainTiles: terrainTiles.size });
    ktx2TextureLoader.setWalkingReady();
    const cityData = await cityDataWithValidation;
    markPerf("city-data-ready", {
      elements: cityData?.metadata?.elementCount ?? cityData?.elements?.length ?? 0,
      partial: !!cityData?.partial,
      prebuilt: cityData?.kind === "prebuilt",
    });
    if (!disposed) {
      ui.setWorldSummary(cityData?.kind === "prebuilt"
        ? cityData.metadata.summary
        : summarizeCityElements(cityData?.elements || []));
    }
    const edits = (await editsPromise) || {};
    runtime.current.edits = edits;
    runtime.current.editsKey = editsKey;
    if (disposed) return;

    // Terrain patches flatten circles into the heightmap BEFORE the city build.
    applyTerrainPatches(edits.terrain);
    const cityBuilt = await loadCity(applyElementEdits(cityData, edits));
    if (disposed) return;
    if (bench.startPose) {
      const { x, z, heading } = bench.startPose;
      if (![x, z, heading].every(Number.isFinite) || insideBuilding(x, z)) {
        throw new Error("Benchmark start pose must be finite and outside buildings");
      }
      Object.assign(player, { x, z, heading, pitch: 0, moving: false });
      bench.markPoseApplied();
    } else if (cityBuilt && demoHeading !== null) {
      player.heading = demoHeading;
      player.pitch = 0;
      runtime.current.spawnFraming = {
        ...(runtime.current.spawnFraming || {}),
        headingSource: "demo-preset",
        headingDeg: ((demoPreset.headingDeg % 360) + 360) % 360,
      };
    }
    markPerf("streaming-complete", { scope: "spawn-cell", cityBuilt });
    for (const entry of edits.assets || []) placeAsset(entry, false);

    // The street is navigable once terrain and static geometry exist; GLB
    // downloads and population setup stream into the scene afterwards.
    ui.setCityStreaming(false);
    if (!disposed) setEngineReady(cityBuilt);
    ui.setStage(cityBuilt ? "Ready" : "City unavailable · retrying nearby streets");

    // Walk-time streaming assembles neighbour cells as the player crosses
    // ~650 m boundaries (R2 warm hits ~1-2 s; cold Overpass slower).
    startCellStreaming(cityBuilt, cityData);
    await startPopulation(cityData);
    if (disposed) return;

    // Safe spawn: never inside a building.
    const open = nearestOpenSpot(player.x, player.z, insideBuilding);
    if (open) {
      player.x = open.x;
      player.z = open.z;
    }
    if (!bench.enabled && !demoApplied) {
      api.applyRealWeather().then((r) => {
        if (!r || disposed) return;
        store.changeSetting({ hour: r.hour, weather: r.weather });
        ui.setLiveTemp(r.temp);
      });
    }
    window.__streetDebug = createStreetDebugApi({
      bench, scene, renderer, shadows, player, fly, vehicle, runtime: runtime.current, cityBuilder,
      envCtrl: sky.envCtrl,
      getPostFx,
      setPostFxOverride: (override) => { postFxOverride = override; },
      getPopulation: () => population,
      getQualityTier,
      getNightAmount: () => nightAmount,
      getRenderScale: () => governor.scale,
      getHour: () => runtimeHour,
      insideBuilding,
      groundHeight,
      pickPoint,
      resolveOsmAt,
      setQuality: (quality) => api.setQuality(quality),
      setTime: (h) => api.setTime(h),
      setWeather: (w) => api.setWeather(w),
      readOnlyCityData,
    });
    syncPlaceName();
  };

  boot().catch((error) => {
    if (!disposed) {
      ui.setStage(error.message || "Unable to load world");
      ui.setBootError(error);
    }
  });

  const dispose = () => {
    disposed = true;
    lifetime.abort();
    cityBuilder.dispose();
    running = false;
    setEngineReady(false);
    if (window.__streetDebug?.player === player) delete window.__streetDebug;
    flushWalk();
    const snap = trailRef.current?.snapshot();
    if (snap?.length) store.setTrail(snap);
    for (const [target, type, handler] of listeners) target.removeEventListener(type, handler);
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    population?.dispose();
    streetLights?.dispose();
    warmup.dispose();
    postFx?.dispose();
    editorTools.dispose();
    ambience.dispose();
    sky.dispose();
    runtime.current.cellStreamer?.dispose?.();
    ktx2TextureLoader.dispose();
    disposeSceneGroup(scene, scene, sharedMaterialTextures());
    disposeMaterialCache();
    terrain.dispose();
    gpuTimer.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    mount.removeChild(renderer.domElement);
  };

  return { api, dispose };
}
