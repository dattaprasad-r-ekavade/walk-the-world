"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { LoadingScreen } from "@/components/hud/Panels";
import { lon2tx, lat2ty, tx2lon, ty2lat, makeLocalFrame } from "@/lib/engine/geo";
import { fetchCityData, cityCacheKey } from "@/lib/engine/cityData";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createStreetEditor } from "@/lib/engine/street/editor";
import { createPopulation } from "@/lib/engine/population";
import { createAmbience } from "@/lib/engine/ambience";
import { createStreetLights } from "@/lib/engine/street-lights";
import { drawGroundTileImage, groundTileUrl } from "@/lib/engine/ground-tiles";
import { whereAmIRound } from "@/lib/daily";
import { createEnvController } from "@/lib/engine/env-map";
import { createCityBuilderPool } from "@/lib/engine/city-builder";
import { assembleCityFromBuild, primeStationLabelMetrics } from "@/lib/engine/street/assemble-city";
import { createCellStreamer } from "@/lib/engine/street/cell-stream";
import { clipElementsToCell } from "@/lib/engine/cell-clip";
import { getSimpleStandard, installBuildingTextureMaps, installBuildingNearTextureMaps, clearBuildingNearTextureMaps, setBuildingTextureQuality, setRoadWetness, setRoadEnvironment, setWetRoadMapCandidate, wetRoadMapStats, sharedMaterialTextures, materialFactoryInventory, disposeMaterialCache } from "@/lib/engine/materials";
import { createKtx2BuildingTextureLoader } from "@/lib/engine/ktx2-textures";
import { createVehicleController } from "@/lib/engine/street/vehicle";
import { createPostFx, getPostFxPassState } from "@/lib/engine/post-fx";
import { applyAutoQuality } from "@/lib/engine/gpu-tier";
import { createTrailBuffer } from "@/lib/engine/trail-buffer";
import { createGpuFrameTimer } from "@/lib/engine/gpu-frame-timer";
import { createSeededRandom } from "@/lib/engine/seeded-random";

const toolBtn = "rounded bg-white/10 px-2 py-1 hover:bg-white/20";
const toolBtnPrimary = "rounded bg-emerald-500/80 px-2 py-1 font-semibold text-black hover:bg-emerald-400";
import { appendGpuFrameTime, appendRendererFrame, getPerfCounters, markPerf, markPerfMeasurementUnavailable, measurePerf, measurePerfAsync, recordPerfTiming, recordFrameInterval, recordFpsSample, setPerfEnvironment, setPerfMetadata, setPerfResourceCounts, trackRender } from "@/lib/perf";
import { STREET } from "@/lib/engine/street/constants";
import { createCollision } from "@/lib/engine/street/collision";
import { createTerrainSystem } from "@/lib/engine/street/terrain";
import { disposeSceneGroup } from "@/lib/engine/street/resources";
import { createHudRef } from "@/lib/engine/street/hud-ref";
import { GameShell } from "@/components/game-shell/GameShell";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/stores/game-store";
import { useGameKeyboard } from "@/hooks/use-game-keyboard";
import { touchInputRef, readTouchMovement, applyTouchLook } from "@/lib/touch-input";
import { menuBtnPrimary } from "@/lib/ui";
import { copyText, streetShareUrl, downloadCanvasPng, photoFilename } from "@/lib/share";
import { summarizeCityElements } from "@/lib/world-repair";

// ============================================================
// Street Engine — custom Three.js renderer for street-level
// walking. Streams free, keyless open data:
//   terrain  → AWS Terrarium elevation tiles (S3 open data)
//   ground   → OpenStreetMap raster tiles (texture)
//   buildings→ Overpass API (extruded, merged into few draw calls)
//   roads    → Overpass API (ribbon meshes by road class)
// Local ENU coordinates in meters, origin at spawn.
// ============================================================

const { EYE, WALK_SPEED, RUN_MULT, TERRAIN_Z: Z, COLLISION_GRID: GRID } = STREET;






export default function StreetEngine({ lat0, lon0, resumedPosition = false }) {
  trackRender();
  const router = useRouter();
  const hudDomRef = useRef(null);
  const panel = useGameStore((s) => s.panel);
  const setPanel = useGameStore((s) => s.setPanel);
  const togglePanel = useGameStore((s) => s.togglePanel);
  const settings = useGameStore((s) => s.settings);
  const changeSettingStore = useGameStore((s) => s.changeSetting);
  const savedPlaces = useGameStore((s) => s.savedPlaces);
  const addPlace = useGameStore((s) => s.addPlace);
  const removePlace = useGameStore((s) => s.removePlace);
  const passport = useGameStore((s) => s.passport);
  const photoMode = useGameStore((s) => s.photoMode);
  const setPhotoMode = useGameStore((s) => s.setPhotoMode);
  const togglePhotoMode = useGameStore((s) => s.togglePhotoMode);
  const recordWalk = useGameStore((s) => s.recordWalk);
  const setTrail = useGameStore((s) => s.setTrail);
  const recordElevClimb = useGameStore((s) => s.recordElevClimb);
  const whereAmI = useGameStore((s) => s.whereAmI);
  const startWhereAmI = useGameStore((s) => s.startWhereAmI);
  const guessWhereAmI = useGameStore((s) => s.guessWhereAmI);
  const clearWhereAmI = useGameStore((s) => s.clearWhereAmI);

  const mountRef = useRef(null);
  const [bootError, setBootError] = useState(null);
  const [stage, setStage] = useState("Preparing engine…");
  const [readyPct, setReadyPct] = useState(5);
  const [hudLocked, setHudLocked] = useState(false);
  const [place, setPlace] = useState(null);
  const [bigMap, setBigMap] = useState(false);
  const [liveWx, setLiveWx] = useState(null);
  const [liveTemp, setLiveTemp] = useState(null);
  const [cityStreaming, setCityStreaming] = useState(false);
  const [mutedUi, setMutedUi] = useState(false);
  const [liveHud, setLiveHud] = useState({ fps: 0, elev: null });
  const [uiMode, setUiMode] = useState(null); // 'editor' | 'debug' | null
  const [debugSel, setDebugSel] = useState(null);
  const [tagDraft, setTagDraft] = useState("");
  const [assetList, setAssetList] = useState([]);
  const [editorMsg, setEditorMsg] = useState(null);
  const [brushRadius, setBrushRadius] = useState(12);
  const [shareToast, setShareToast] = useState(null);
  const [worldSummary, setWorldSummary] = useState(null);
  const placeRef = useRef(null);

  useEffect(() => {
    placeRef.current = place;
  }, [place]);

  useEffect(() => {
    if (uiMode !== "editor") return;
    fetch("/api/assets")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setAssetList(Array.isArray(d) ? d : d.assets || []))
      .catch(() => setAssetList([]));
  }, [uiMode]);

  useEffect(() => {
    if (debugSel?.tags)
      setTagDraft(Object.entries(debugSel.tags).map(([k, v]) => `${k}=${v}`).join("\n"));
    else setTagDraft("");
  }, [debugSel]);

  const saveTagDraft = async () => {
    if (!debugSel?.id) return;
    const tags = {};
    for (const line of tagDraft.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) tags[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    const ok = await engineRef.current.editorApi?.setTagOverride(debugSel.id, tags);
    setDebugSel({ ...debugSel, tags, saved: ok ? "override saved to R2 ✓ (applied on reload)" : "save failed — set editor key in E panel" });
  };

  const useRealWeather = async () => {
    setLiveWx("loading");
    const r = await engineRef.current.applyRealWeather?.();
    if (r) {
      changeSettingStore({ hour: r.hour, weather: r.weather });
      setLiveTemp(r.temp);
      setLiveWx(`${r.temp}°C · ${r.rain > 0.05 ? "raining" : "dry"} — synced`);
    } else setLiveWx("unavailable");
  };
  const posRef = useRef(null);
  const trailRef = useRef(null);
  if (!trailRef.current) {
    trailRef.current = createTrailBuffer(useGameStore.getState().passport?.trail);
  }
  const engineRef = useRef({});

  useEffect(() => {
    engineRef.current.setPhotoFly?.(photoMode);
  }, [photoMode]);

  const changeSetting = (patch) => {
    changeSettingStore(patch);
    if (patch.hour !== undefined) engineRef.current.setTime?.(patch.hour);
    if (patch.weather !== undefined) {
      engineRef.current.setWeather?.(patch.weather);
      engineRef.current.setPrecip?.(patch.weather >= 85 ? "rain" : null);
    }
    if (patch.quality) engineRef.current.setQuality?.(patch.quality);
    if (patch.music !== undefined) engineRef.current.setMusic?.(patch.music);
    // groundSource: effect re-runs via deps below (full terrain rebuild)
  };

  const flashToast = (msg) => {
    setShareToast(msg);
    setTimeout(() => setShareToast(null), 2200);
  };

  const shareSpot = async () => {
    const cur = posRef.current || { lat: lat0, lon: lon0 };
    const url = streetShareUrl(cur.lat, cur.lon);
    if (!url) {
      flashToast("No position yet");
      return;
    }
    const ok = await copyText(url);
    flashToast(ok ? "Link copied" : "Could not copy link");
  };

  const capturePhoto = () => {
    const ok = engineRef.current.captureScreenshot?.(placeRef.current);
    flashToast(ok ? "Screenshot saved" : "Screenshot failed");
  };

  useGameKeyboard(
    (e) => {
      // Where-am-I: keep HUD hidden until guess; Esc closes the round
      if (whereAmI && !whereAmI.revealed) {
        if (e.code === "Escape") {
          clearWhereAmI();
          return;
        }
        if (e.code === "KeyH" || e.code === "KeyP" || e.code === "KeyM") return;
      }
      if (e.code === "Escape" && photoMode) {
        setPhotoMode(false);
        return;
      }
      if (photoMode && e.code !== "KeyH") return;
      if (e.code === "KeyH") {
        e.preventDefault();
        togglePhotoMode();
        setPanel(null);
        return;
      }
      if (e.code === "KeyM") togglePanel("travel");
      if (e.code === "KeyP") togglePanel("pause");
      if (e.code === "Tab") {
        e.preventDefault();
        setBigMap((b) => !b);
      }
      if (e.code === "KeyN" && place && !whereAmI) setPlace((pl) => pl && String(pl));
    },
    [place, togglePanel, photoMode, setPhotoMode, togglePhotoMode, setPanel, whereAmI, clearWhereAmI]
  );

  useEffect(() => {
    let disposed = false;
    const runtime = { current: {} };
    engineRef.current = runtime.current;
    const lifetime = new AbortController();
    const signal = lifetime.signal;
    const readOnlyCityData = window.__BENCH_MODE !== true || window.__BENCH_CITY_DATA_COPY_MODE !== "clone";
    const profileCityQueries = window.__BENCH_MODE === true && window.__BENCH_PROFILE_CITY_QUERIES === true;
    const benchmarkRoadQueryMode = window.__BENCH_MODE === true && window.__BENCH_ROAD_QUERY_MODE === "scan" ? "scan" : "indexed";
    const benchmarkWorkerCount = window.__BENCH_MODE === true && Number.isInteger(window.__BENCH_GEOMETRY_WORKERS)
      ? window.__BENCH_GEOMETRY_WORKERS
      : null;
    const cityBuilder = createCityBuilderPool(benchmarkWorkerCount ? { size: benchmarkWorkerCount } : undefined);
    const mount = mountRef.current;
    if (!mount) return;

    if (typeof window !== 'undefined') {
      window.__engineReady = false;
      window.__streetTriangles = 0;
    }

    // Kick the asset-library list off at t=0. Measured on prod: it used to
    // start ~9.4s in (after the city build) and cost another 1.5s serially.
    const assetListPromise = fetch("/api/assets", { signal })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    const cityDataPromise = measurePerfAsync("city.initial-data-consumer", () => fetchCityData(lat0, lon0, {
      signal,
      readonly: readOnlyCityData,
    })).catch((e) => {
      console.warn("[street] city data:", e?.message);
      return null;
    });
    const editsKey = cityCacheKey(lat0, lon0);
    const editsPromise = fetch(`/api/edits/${editsKey}`, { signal })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));

    // ---- local ENU conversion (lib/engine/geo) ----
    const { toLocal, toGeo } = makeLocalFrame(lat0, lon0);

    // ---- three basics ----
    // MSAA is disproportionately expensive on mobile/high-DPR canvases. The
    // post stack and facade geometry already provide a clean silhouette, so
    // keep antialiasing for ordinary desktop displays only.
    const isMobileViewport = window.matchMedia?.("(pointer: coarse)")?.matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || "");
    const useMsaa = !isMobileViewport && (window.devicePixelRatio || 1) <= 1.25;
    const renderer = new THREE.WebGLRenderer({
      antialias: useMsaa,
      powerPreference: "high-performance",
    });
    // Keep renderer counters cumulative across the app's complete logical
    // frame, including composer passes. The counters are reset after each draw.
    renderer.info.autoReset = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const gl = renderer.getContext();
    const gpuTimer = createGpuFrameTimer(gl, {
      onSample: (durationMs) => appendGpuFrameTime(getPerfCounters(), durationMs),
    });
    const rendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
    setPerfEnvironment({
      webgl: {
        version: gl.getParameter(gl.VERSION),
        vendor: rendererInfo ? gl.getParameter(rendererInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: rendererInfo ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        webgl2: renderer.capabilities.isWebGL2,
        debugRendererInfoAvailable: !!rendererInfo,
      },
    });
    const initialGpuTimerState = gpuTimer.snapshot();
    const initialPerfCounters = getPerfCounters();
    if (initialPerfCounters) initialPerfCounters.gpuTimer = initialGpuTimerState;
    if (!gpuTimer.supported) markPerfMeasurementUnavailable("gpuFrameTimeMs", initialGpuTimerState.reason || "GPU timer queries are unavailable.");
    markPerfMeasurementUnavailable("estimatedGpuMemoryBytes", "WebGL does not expose reliable allocated VRAM bytes; geometry and texture object counts are reported instead.");
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, useMsaa ? 1.5 : 1.25));
    // filmic tone mapping: richer sky gradients, softer highlights, deeper
    // shadow color — the single cheapest whole-scene visual upgrade
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // cheaper than PCFSoft (fewer taps per fragment)
    // PERF: three.js re-renders the whole shadow map EVERY frame by default.
    // With a 2048 map over ~2000 buildings that is a second full scene pass
    // per frame — the single biggest FPS cost. Drive it manually instead:
    // refresh only when the sun moves (applySky) or the player leaves the
    // area the current map covers.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    mount.appendChild(renderer.domElement);
    markPerfMeasurementUnavailable(
      "ktx2GpuUploadCompletionMs",
      "WebGL exposes synchronous upload submission but not a portable completion timestamp; GPU residency is estimated from transcoded compressed mip payloads.",
    );
    let sharedKtx2GpuBytes = 0;
    let highKtx2GpuBytes = 0;
    const installKtx2TextureSet = (maps) => {
      const textures = Object.values(maps.textures);
      const textureCountBefore = renderer.info.memory.textures;
      const uploadStartedAt = performance.now();
      try {
        for (const texture of textures) renderer.initTexture(texture);
      } catch (error) {
        for (const texture of textures) texture.dispose();
        throw error;
      }
      const uploadSubmitMs = performance.now() - uploadStartedAt;
      const installed = maps.tier === "high"
        ? installBuildingNearTextureMaps({
            basecolor: maps.textures["facade-near-basecolor"],
            normal: maps.textures["facade-near-normal"],
            roughness: maps.textures["facade-near-roughness"],
            emissive: maps.textures["facade-near-emissive"],
            materialRects: maps.materialRects,
          })
        : installBuildingTextureMaps({
            facade: maps.textures["facade-basecolor"],
            emissive: maps.textures["facade-emissive"],
          });
      if (!installed) {
        for (const texture of textures) texture.dispose();
        return false;
      }

      if (maps.tier === "high") highKtx2GpuBytes = maps.estimatedGpuBytes;
      else sharedKtx2GpuBytes = maps.estimatedGpuBytes;
      const estimatedTotalGpuBytes = sharedKtx2GpuBytes + highKtx2GpuBytes;
      const textureCountDelta = renderer.info.memory.textures - textureCountBefore;
      const timingPrefix = maps.tier === "high" ? "ktx2.high" : "ktx2";
      recordPerfTiming(timingPrefix + ".texture-upload-submit", uploadSubmitMs, {
        bytes: maps.estimatedGpuBytes,
        textureCountDelta,
      });
      setPerfResourceCounts({
        textures: renderer.info.memory.textures,
        ktx2EstimatedGpuBytes: estimatedTotalGpuBytes,
        ktx2SharedEstimatedGpuBytes: sharedKtx2GpuBytes,
        ktx2HighEstimatedGpuBytes: highKtx2GpuBytes,
      });
      const details = {
        transcodeFormats: maps.transcodeFormats,
        transferBytes: maps.transferBytes,
        transferMs: maps.transferMs,
        decoderBytes: maps.decoderBytes,
        mipLevels: maps.mipLevels,
        workerLimit: 2,
        estimatedGpuBytes: maps.estimatedGpuBytes,
        estimatedTotalGpuBytes,
        textureCountDelta,
      };
      setPerfMetadata(maps.tier === "high" ? { ktx2High: details } : { ktx2: details });
      markPerf(maps.tier === "high" ? "ktx2-high-textures-ready" : "ktx2-textures-ready", {
        ...details,
        compileAndTranscodeMs: maps.decodeMs,
        uploadSubmitMs,
      });
      return true;
    };
    const ktx2TextureLoader = createKtx2BuildingTextureLoader(renderer, {
      signal,
      onSharedReady: installKtx2TextureSet,
      onHighReady: installKtx2TextureSet,
      onHighDispose: clearBuildingNearTextureMaps,
      onError: (error, tier) => console.warn(
        "[street] " + (tier === "high" ? "high-tier KTX2 maps unavailable" : "KTX2 facade maps unavailable") +
          "; current facade maps remain active:",
        error?.message || error,
      ),
    });
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9cc4e8);
    // Exp2 fog reads more natural at distance; near/far tuned in applySky
    scene.fog = new THREE.FogExp2(0x9cc4e8, 0.00055);
    // near 0.35 (not 0.1): with far=6000 the depth-buffer ratio drops 3.5×,
    // which stops distant facades z-shimmering (London's long straight rows)
    const camera = new THREE.PerspectiveCamera(
      70, mount.clientWidth / mount.clientHeight, 0.35, 6000
    );
    camera.rotation.order = "YXZ";

    // 16.3: auto-pick quality on first boot (skipped if user locked a preset)
    const bootQuality = applyAutoQuality(
      () => useGameStore.getState().settings,
      (patch) => useGameStore.getState().changeSetting(patch),
      renderer
    );
    // 16.2: SSAO high-only; bloom also at night on medium (21.0)
    let qualityTier = "medium";
    let postFx = null;
    let postFxOverride = null;
    let applyQuality = () => {};
    let streetLights = null;
    let streetLightWorldReady = false;
    let streetLampSource = null;
    let streetLampMarkers = [];
    let streetLightEnabledTier = null;
    let currentStreetLightNight = 0;
    let syncStreetLightQuality = () => {};

    const renderMeasuredFrame = () => {
      const diagnosticsEnabled = window.__perfCounters?.diagnosticsEnabled === true;
      if (diagnosticsEnabled && renderer.info.autoReset) renderer.info.autoReset = false;
      const timerStarted = diagnosticsEnabled && gpuTimer.beginFrame();
      try {
        const name = postFx ? "renderer.postfx-cpu-submit" : "renderer.direct-cpu-submit";
        measurePerf(name, () => {
          if (postFx) postFx.render();
          else renderer.render(scene, camera);
        }, { qualityTier });
      } finally {
        if (timerStarted) gpuTimer.endFrame();
        if (diagnosticsEnabled) {
          const counters = getPerfCounters();
          const render = renderer.info.render;
          appendRendererFrame(counters, {
            calls: render.calls,
            triangles: render.triangles,
            lines: render.lines,
            points: render.points,
          });
          const timerState = gpuTimer.snapshot();
          if (counters) counters.gpuTimer = timerState;
          if (!timerState.supported) {
            markPerfMeasurementUnavailable("gpuFrameTimeMs", timerState.reason || "GPU timer queries became unavailable.");
          }
        }
        renderer.info.reset();
      }
    };

    const makeGlow = (inner, outer, size) => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g2 = c.getContext("2d");
      const grad = g2.createRadialGradient(64, 64, 8, 64, 64, 64);
      grad.addColorStop(0, inner);
      grad.addColorStop(0.35, outer);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g2.fillStyle = grad;
      g2.fillRect(0, 0, 128, 128);
      const tx = new THREE.CanvasTexture(c);
      tx.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tx, transparent: true, depthWrite: false, fog: false })
      );
      sp.scale.set(size, size, 1);
      return sp;
    };
    const sunSprite = makeGlow("rgba(255,250,230,1)", "rgba(255,215,130,0.85)", 420);
    const moonSprite = makeGlow("rgba(235,240,250,1)", "rgba(190,205,230,0.5)", 260);
    scene.add(sunSprite);
    scene.add(moonSprite);

    // Hemisphere is a soft fill; IBL (scene.environment) does most ambient work
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x8c8474, 0.35);
    scene.add(hemi);
    const envCtrl = createEnvController(renderer);
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(300, 500, -200);
    // one tight shadow map around the player — big depth win for ~1-2 ms
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 50;
    sun.shadow.camera.far = 1200;
    sun.shadow.camera.left = -180;
    sun.shadow.camera.right = 180;
    sun.shadow.camera.top = 180;
    sun.shadow.camera.bottom = -180;
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    scene.add(sun.target);

    postFx = createPostFx(renderer, scene, camera);
    postFx.setSize(mount.clientWidth, mount.clientHeight);
    applyQuality = (q) => {
      const quality = q || "medium";
      renderer.setPixelRatio(
        quality === "low"
          ? 0.75
          : quality === "medium"
            ? Math.min(window.devicePixelRatio, 1.25)
            : Math.min(window.devicePixelRatio || 1, 1.5)
      );
      renderer.shadowMap.enabled = quality !== "low";
      sun.castShadow = quality !== "low";
      if (quality === "low") sun.shadow.mapSize.set(512, 512);
      else if (quality === "medium") sun.shadow.mapSize.set(1024, 1024);
      else sun.shadow.mapSize.set(2048, 2048);
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      postFx.setSize(mount.clientWidth, mount.clientHeight);
      // remember the tier; applySky re-evaluates so night can turn bloom on
      qualityTier = quality;
      setBuildingTextureQuality(quality);
      ktx2TextureLoader.setQuality(quality);
      if (quality !== "high" && highKtx2GpuBytes > 0) {
        highKtx2GpuBytes = 0;
        setPerfResourceCounts({
          textures: renderer.info.memory.textures,
          ktx2EstimatedGpuBytes: sharedKtx2GpuBytes,
          ktx2SharedEstimatedGpuBytes: sharedKtx2GpuBytes,
          ktx2HighEstimatedGpuBytes: 0,
        });
        markPerf("ktx2-high-textures-released", { estimatedGpuBytes: sharedKtx2GpuBytes });
      }
      const postFxState = postFxOverride || getPostFxPassState(quality, currentStreetLightNight);
      postFx.setEnabled(postFxState.active, postFxState.ssao);
      setPerfMetadata({
        qualityTier: quality,
        pixelRatio: renderer.getPixelRatio(),
        shadowMapEnabled: renderer.shadowMap.enabled,
        postFxActive: postFx.active,
        ssaoActive: postFx.ssaoActive,
        bloomActive: postFx.bloomActive,
      });
      syncStreetLightQuality();
    };
    applyQuality(bootQuality || useGameStore.getState().settings?.quality || "medium");

    // ---- settings hooks (time of day / weather / quality) ----
    const daySky = new THREE.Color(0x9cc4e8);
    const duskSky = new THREE.Color(0xd8926a);
    const nightSky = new THREE.Color(0x121b2d); // deep blue: keep the horizon readable
    let weatherAmt = 0;
    const sunDir = new THREE.Vector3(300, 500, -200);
    const applySky = (hour) => {
      // sun elevation from local solar hour
      const t = ((hour - 6) / 12) * Math.PI; // 6h→sunrise, 18h→sunset
      const elev = Math.sin(t);
      sunDir.set(Math.cos(t) * 500, Math.max(elev, 0.08) * 500, -200);
      sun.position.set(sunDir.x, sunDir.y, sunDir.z);
      sun.intensity = Math.max(0, elev) * 1.6 + 0.05;
      // Soft fill follows the sun; the PMREM environment carries reflections.
      // The higher night floor keeps unlit street surfaces from collapsing to black.
      hemi.intensity = 0.38 + Math.max(0, elev) * 0.08;
      envCtrl.apply(scene, hour, weatherAmt);
      setRoadEnvironment(scene.environment);
      // windows light up as the sun sets (elev < ~0.08 → fully lit)
      const winGlow = Math.max(0, Math.min(1, (0.08 - elev) * 9)) * 0.85;
      for (const bm of runtime.current.buildingMats || []) bm.emissiveIntensity = winGlow;
      currentStreetLightNight = winGlow;
      streetLights?.setNight(qualityTier === "high" ? winGlow : 0);
      for (const pool of runtime.current.lampPoolMaterials || []) {
        // slight "bloom" via brighter additive pools at night
        pool.opacity = winGlow * (1.05 + winGlow * 0.35);
      }
      const sky = new THREE.Color();
      if (elev > 0.25) sky.copy(daySky);
      else if (elev > -0.05) sky.lerpColors(duskSky, daySky, (elev + 0.05) / 0.3);
      else sky.copy(nightSky);
      const overcastSky = elev > 0.25 ? 0x8a8f96 : elev > -0.05 ? 0x766d74 : 0x37414f;
      const weatherBlend = weatherAmt * (elev > 0.25 ? 0.7 : elev > -0.05 ? 0.55 : 0.5);
      sky.lerp(new THREE.Color(overcastSky), weatherBlend);
      scene.background = sky;
      scene.fog.color.copy(sky);
      // denser fog in weather + height-ish mood: dawn/dusk thicker, noon clearer
      const duskMood = 1 - Math.abs(elev); // 0 at noon, 1 at horizon
      // Keep distant streets atmospheric without letting night/rain erase the route.
      const nightDens = winGlow * 0.00018;
      const weatherDens = weatherAmt * (elev > 0.25 ? 0.00065 : elev > -0.05 ? 0.00048 : 0.00028);
      const baseDens = 0.00032 + duskMood * 0.00018 + weatherDens + nightDens;
      scene.fog.density = baseDens;
      // exposure: warmer/brighter dusk, cooler night
      renderer.toneMappingExposure =
        elev > 0.2 ? 1.08 : elev > 0 ? 1.2 : 0.92 + winGlow * 0.25;
      postFx?.setNightBloom(winGlow);
      renderer.shadowMap.needsUpdate = true; // sun moved → re-bake shadows
      // 21.0 night grade: commit to darkness. Bloom on at night for medium+,
      // sky/fog go deep blue-black, non-emissive fill drops so lamps read.
      const postFxState = postFxOverride || getPostFxPassState(qualityTier, winGlow);
      postFx.setEnabled(postFxState.active, postFxState.ssao);
      setPerfMetadata({
        hour,
        weather: weatherAmt * 100,
        postFxActive: postFx.active,
        ssaoActive: postFx.ssaoActive,
        bloomActive: postFx.bloomActive,
      });
      // sun + moon ride opposite ends of the same arc
      sunSprite.position.set(Math.cos(t) * 4200, elev * 4200, -1600);
      moonSprite.position.set(-Math.cos(t) * 4200, -elev * 4200, -1600);
      sunSprite.material.opacity = Math.max(0, Math.min(1, (elev + 0.08) * 5)) * (1 - weatherAmt * 0.8);
      moonSprite.material.opacity = Math.max(0, Math.min(1, (-elev + 0.08) * 5)) * (1 - weatherAmt * 0.8);
      // street lamps switch on after dusk
      const night = elev < 0.12;
      const glows = runtime.current.lampGlows || [];
      // HDR values (>1) so UnrealBloom actually catches the bulbs at night —
      // a clamped 0xffe9a8 sits under the threshold and never blooms (21.0)
      for (const m of glows) {
        if (night) m.color.setRGB(1.8, 1.45, 0.95);
        else m.color.setHex(0x1a1c20);
      }
    };
    runtime.current.setTime = (hour) => applySky(hour);
    runtime.current.setWeather = (w) => {
      weatherAmt = w / 100;
      // M1/M7: rain makes asphalt reflective — mirror streaks under lamps
      setRoadWetness(weatherAmt);
      applySky(runtimeHour);
    };
    let runtimeHour = 12;
    const origSetTime = runtime.current.setTime;
    runtime.current.setTime = (h) => {
      runtimeHour = h;
      origSetTime(h);
    };
    runtime.current.refreshEnvironment = () => applySky(runtimeHour);
    // ---- precipitation particles (rain/snow) ----
    let precip = null;
    runtime.current.setPrecip = (mode) => {
      // mode: null | "rain" | "snow"
      if (precip) { scene.remove(precip.points); precip = null; }
      if (!mode) return;
      const N2 = mode === "rain" ? 1600 : 900;
      const pos2 = new Float32Array(N2 * 3);
      for (let i = 0; i < N2; i++) {
        pos2[i * 3] = (Math.random() - 0.5) * 80;
        pos2[i * 3 + 1] = Math.random() * 40;
        pos2[i * 3 + 2] = (Math.random() - 0.5) * 80;
      }
      const g4 = new THREE.BufferGeometry();
      g4.setAttribute("position", new THREE.BufferAttribute(pos2, 3));
      const points = new THREE.Points(
        g4,
        new THREE.PointsMaterial({
          color: mode === "rain" ? 0x9fb8d8 : 0xffffff,
          size: mode === "rain" ? 0.14 : 0.32,
          transparent: true,
          opacity: 0.75,
        })
      );
      scene.add(points);
      precip = { points, speed: mode === "rain" ? 28 : 4, geo: g4 };
    };

    runtime.current.setQuality = (q) => {
      applyQuality(q);
    };

    // ---- state ----
    const player = { x: 0, z: 0, heading: 0, pitch: 0, third: false, moving: false };
    const keys = {};
    const terrain = createTerrainSystem({
      scene, lat0, lon0, toLocal, signal,
      groundSource: settings.groundSource === "satellite" ? "satellite" : "osm",
      onStage: setStage, onProgress: setReadyPct,
    });
    const { terrainTiles, tileCanvases } = terrain;
    const { addFootprint, insideBuilding, footprintAt, removeFootprintsByCell } = createCollision(GRID);
    const ghRef = { fn: () => 0 };
    const vehicle = createVehicleController({
      insideBuilding,
      groundHeight: (x, z) => ghRef.fn(x, z),
    });
    // headlights for night driving. They stay in the scene permanently at
    // intensity 0: three.js bakes the light COUNT into every lit material's
    // shader, so adding/removing/hiding them when a drive starts would
    // recompile the whole city mid-demo. Compile once, drive intensity only.
    const headL = new THREE.SpotLight(0xfff2dd, 0, 48, 0.42, 0.45, 1.2);
    const headR = new THREE.SpotLight(0xfff2dd, 0, 48, 0.42, 0.45, 1.2);
    scene.add(headL);
    scene.add(headR);
    scene.add(headL.target);
    scene.add(headR.target);
    let population = null;
    const ambience = createAmbience();
    const groundSource =
      useGameStore.getState().settings?.groundSource === "satellite" ? "satellite" : "osm";
    runtime.current.setMusic = (on) => ambience.set({ music: on !== false });
    // hydrate music preference
    ambience.set({ music: useGameStore.getState().settings?.music !== false });

    const groundHeight = terrain.height;
    const patchTerrain = terrain.patch;
    ghRef.fn = groundHeight;
    syncStreetLightQuality = () => {
      if (!streetLightWorldReady) return;
      const markers = runtime.current.propMarkers || [];
      if (markers !== streetLampSource) {
        streetLampSource = markers;
        streetLampMarkers = markers.filter((marker) => marker.kind === "lamp");
        streetLights?.setLamps(streetLampMarkers, groundHeight);
      }
      if (qualityTier === "high" && !streetLights && streetLampMarkers.length) {
        const benchHideInactiveLights =
          typeof window !== "undefined" && window.__BENCH_HIDE_INACTIVE_STREET_LIGHTS === true;
        streetLights = createStreetLights(scene, {
          maxLights: 4,
          keepInactiveVisible: !benchHideInactiveLights,
        });
        runtime.current.streetLights = streetLights;
        streetLightEnabledTier = null;
        streetLights.setLamps(streetLampMarkers, groundHeight);
      }
      if (!streetLights) return;
      const enabled = qualityTier === "high";
      if (streetLightEnabledTier !== enabled) {
        streetLights.setNight(enabled ? currentStreetLightNight : 0);
        streetLightEnabledTier = enabled;
      }
      streetLights.update(player);
    };
    const editorTools = createStreetEditor({
      scene, renderer, camera, player, engineRef: runtime, ambience, editsKey,
      toLocal, toGeo, groundHeight, patchTerrain, footprintAt, signal,
      setUiMode, setDebugSel, setEditorMsg, setMutedUi,
    });
    const { editor, fly, flyForward, lookAtPivot, pickPoint, resolveOsmAt,
      debugPick, editorClick, setMode, showSelBox, clearSelBox, hideHover,
      updateHover, loadGLB, placeAsset } = editorTools;
    runtime.current.captureScreenshot = (placeLabel) => {
      renderMeasuredFrame();
      const cur = posRef.current || { lat: lat0, lon: lon0 };
      return downloadCanvasPng(
        renderer.domElement,
        photoFilename(placeLabel, cur.lat, cur.lon)
      );
    };
    const spinners = [];
    const lampGlows = [];
    let avatar = null;
    let running = true;
    let hudDom = null;
    const loadTerrain = terrain.load;
    const loadTerrainTile = terrain.loadTile;
    // ---- buildings + roads (Worker geometry + main-thread assemble) ----
    const loadCity = async (data) => {
      if (!data?.elements?.length || data.partial) return false;
      // Ownership clip: keep all corridors from the fetch; buildings/props
      // only inside the spawn tile so neighbors can own the rest.
      const elements = measurePerf("city.spawn-clip", () => clipElementsToCell(data.elements, lat0, lon0), {
        inputElements: data.elements.length,
      });
      if (!elements.length) return true;
      setStage(`Building city (${elements.length} features)…`);
      setReadyPct((p) => Math.max(p, 60));
      const cityRoot = new THREE.Group();
      scene.add(cityRoot);
      try {
        if (disposed) return false;
        const geometryPromise = measurePerfAsync("city.spawn-geometry-total", () => cityBuilder.build({
          signal,
          elements,
          lat0,
          lon0,
          terrainTiles,
          profileQueries: profileCityQueries,
          roadQueryMode: benchmarkRoadQueryMode,
          onProgress: (done, total) => {
            setStage(`Building city (${done}/${total})…`);
            setReadyPct((p) => Math.max(p, 60 + Math.floor((done / Math.max(1, total)) * 25)));
          },
        }), { elements: elements.length });
        if (elements.some((element) =>
          element.type === "node" && element.tags?.railway === "station"
        )) primeStationLabelMetrics();
        const built = await geometryPromise;
        if (disposed) return;
        setStage("Assembling city…");
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
          cellKey: cityCacheKey(lat0, lon0),
          resumedPosition,
          skipOverture: window.__BENCH_MODE === true,
        }), { elements: elements.length });
        return true;
      } catch (e) {
        disposeSceneGroup(cityRoot, scene, sharedMaterialTextures());
        removeFootprintsByCell(cityCacheKey(lat0, lon0));
        for (const key of ['buildingMats','roadPaths','propMarkers','pois','bridgeDecks','spinners','lampGlows','lampPoolMaterials']) runtime.current[key] = [];
        if (!disposed) console.warn("[street] city build failed:", e?.message || e);
        return false;
      }
    };

    /** Stream Terrarium + ground imagery as the player leaves the spawn 3×3. */
    const ensureTerrainAround = (lat, lon) => {
      const ctx = Math.floor(lon2tx(lon, Z));
      const cty = Math.floor(lat2ty(lat, Z));
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const tx = ctx + dx;
          const ty = cty + dy;
          if (terrainTiles.has(`${tx}/${ty}`)) continue;
          loadTerrainTile(tx, ty, false).catch(() => {});
        }
      }
      terrain.evictFar(ctx, cty, 2); // unload tiles >2 rings away (canvas/texture/geometry)
    };

    // ---- avatar: simple static mannequin (no rig, no animation — clean) ----
    const loadAvatar = () => {
      const g = new THREE.Group();
      const bodyMat = getSimpleStandard(0x6d84a8, { roughness: 0.75 });
      const legMat = getSimpleStandard(0x3f4a5c, { roughness: 0.8 });
      const skinMat = getSimpleStandard(0xd9c2a8, { roughness: 0.65 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.62, 4, 10), bodyMat);
      body.position.y = 1.0;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 10), skinMat);
      head.position.y = 1.62;
      for (const sx of [-0.12, 0.12]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.6, 8), legMat);
        leg.position.set(sx, 0.3, 0);
        g.add(leg);
      }
      for (const sx of [-0.34, 0.34]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.5, 3, 8), bodyMat);
        arm.position.set(sx, 1.05, 0);
        g.add(arm);
      }
      g.add(body, head);
      g.visible = false;
      avatar = g;
      scene.add(avatar);
    };

    // ---- input ----
    const canvas = renderer.domElement;
    const onClick = (e) => {
      ambience.start();
      if (editor.mode === "editor" && fly.grab) {
        // commit the move (Blender G → click confirms)
        const { rec, orig } = fly.grab;
        const g = toGeo(rec.group.position.x, rec.group.position.z);
        rec.entry.lat = g.lat;
        rec.entry.lon = g.lon;
        editor.undo.push({ type: "move", rec, orig });
        fly.grab = null;
        setEditorMsg(`moved ${rec.entry.name} — 💾 Save to persist`);
        return;
      }
      if (editor.mode === "debug") { debugPick(e); return; }
      if (editor.mode === "editor") { editorClick(e); return; }
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    };
    const onKey = (e) => {
      keys[e.code] = e.type === "keydown";
      if (editor.mode && (e.code === "Space" || e.code === "KeyC")) e.preventDefault();
      if (fly.photo && (e.code === "Space" || e.code === "KeyC")) e.preventDefault();
      if (e.type === "keydown" && e.code === "KeyV" && !e.repeat) {
        if (!vehicle.active) {
          player.third = !player.third;
          if (avatar) avatar.visible = player.third;
        }
      }
      if (e.type === "keydown" && e.code === "KeyC" && !e.repeat && !editor.mode && !fly.photo) {
        e.preventDefault();
        if (vehicle.active) {
          const pose = vehicle.exit();
          population?.releaseCar?.(pose.carIndex, pose);
          player.x = pose.x;
          player.z = pose.z;
          player.heading = pose.heading;
          player.third = false;
          if (avatar) avatar.visible = false;
          headL.intensity = 0;
          headR.intensity = 0;
          ambience.set?.({ engine: 0 });
        } else if (population?.getNearestCar) {
          const near = population.getNearestCar(player.x, player.z, 6.5);
          if (near && population.takeCar(near.index)) {
            vehicle.enter(near, near.index);
            player.third = true;
            if (avatar) avatar.visible = false;
          }
        }
      }
      if (e.type === "keydown" && !e.repeat) {
        if (e.code === "KeyE") setMode("editor");
        if (e.code === "KeyB") setMode("debug");
        if (editor.mode === "editor") {
          // tool hotkeys, Blender/Minecraft style
          const api = runtime.current.editorApi;
          if (e.code === "Digit1") api.setTool(null);
          if (e.code === "Digit2") api.setTool({ type: "flatten", radius: editor.tool?.radius || 12 });
          if (e.code === "Digit3") api.setTool({ type: "raise", radius: editor.tool?.radius || 12 });
          if (e.code === "Digit4") api.setTool({ type: "lower", radius: editor.tool?.radius || 12 });
          if (e.code === "Digit5") api.setTool({ type: "hide" });
          if (e.code === "KeyG" && editor.selected !== null && !fly.grab) {
            const rec = editor.placed[editor.selected];
            if (rec) {
              fly.grab = { rec, orig: { lat: rec.entry.lat, lon: rec.entry.lon } };
              setEditorMsg(`moving ${rec.entry.name} — move mouse, click to confirm, Esc to cancel`);
            }
          } else if (e.code === "Escape" && fly.grab) {
            const { rec, orig } = fly.grab;
            const pl = toLocal(orig.lat, orig.lon);
            rec.group.position.set(pl.x, groundHeight(pl.x, pl.z) + (rec.entry.yOffset || 0), pl.z);
            editorTools.selectionBox?.update();
            fly.grab = null;
            setEditorMsg("move cancelled");
          } else if (e.code === "Escape") { api.setTool(null); clearSelBox(); editor.selected = null; }
          if (e.code === "KeyZ" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            const u = editor.undo.pop();
            if (!u) setEditorMsg("nothing to undo");
            else if (u.type === "asset") {
              const rec = editor.placed.pop();
              if (rec) {
                scene.remove(rec.group);
                const arr = runtime.current.edits.assets || [];
                const ai = arr.indexOf(rec.entry);
                if (ai >= 0) arr.splice(ai, 1);
              }
              editor.selected = null;
              clearSelBox();
              setEditorMsg("undid asset placement");
            } else if (u.type === "hide") {
              const hidden = runtime.current.edits.hidden || [];
              const hi = hidden.indexOf(u.id);
              if (hi >= 0) hidden.splice(hi, 1);
              setEditorMsg(`undid hide of ${u.id}`);
            } else if (u.type === "move") {
              const pl = toLocal(u.orig.lat, u.orig.lon);
              u.rec.entry.lat = u.orig.lat;
              u.rec.entry.lon = u.orig.lon;
              u.rec.group.position.set(pl.x, groundHeight(pl.x, pl.z) + (u.rec.entry.yOffset || 0), pl.z);
              editorTools.selectionBox?.update();
              setEditorMsg("undid move");
            } else if (u.type === "terrain") {
              (runtime.current.edits.terrain || []).pop();
              patchTerrain(u.x, u.z, u.r, u.prevH);
              setEditorMsg("undid terrain edit");
            }
          }
        }
        if (editor.mode === "editor" && editor.selected !== null) {
          const rec = editor.placed[editor.selected];
          if (rec) {
            if (e.code === "KeyR") { rec.entry.rotY = rec.group.rotation.y += Math.PI / 12; editorTools.selectionBox?.update(); }
            if (e.code === "BracketLeft") { rec.group.scale.setScalar((rec.entry.scale = Math.max(0.1, (rec.entry.scale || 1) * 0.9))); editorTools.selectionBox?.update(); }
            if (e.code === "BracketRight") { rec.group.scale.setScalar((rec.entry.scale = Math.min(50, (rec.entry.scale || 1) * 1.1))); editorTools.selectionBox?.update(); }
            if (e.code === "KeyX") {
              scene.remove(rec.group);
              editor.placed.splice(editor.selected, 1);
              const arr = runtime.current.edits.assets || [];
              const ai = arr.indexOf(rec.entry);
              if (ai >= 0) arr.splice(ai, 1);
              editor.selected = null;
              clearSelBox();
              setEditorMsg("asset deleted — 💾 Save to persist");
            }
          }
        }
      }
    };
    const onMouse = (e) => {
      if (editor.mode) {
        if (fly.orbit) {
          fly.heading += e.movementX * 0.006;
          fly.pitch = Math.max(-1.45, Math.min(1.45, fly.pitch - e.movementY * 0.006));
          lookAtPivot();
        } else if (fly.pan) {
          const d = flyForward();
          const right = new THREE.Vector3(Math.cos(fly.heading), 0, Math.sin(fly.heading));
          const up = new THREE.Vector3().crossVectors(right, d).negate().normalize();
          const sp = Math.max(4, fly.y - groundHeight(fly.x, fly.z) + 6) * 0.0022;
          fly.x += (-e.movementX * right.x + e.movementY * up.x) * sp;
          fly.y += e.movementY * up.y * sp;
          fly.z += (-e.movementX * right.z + e.movementY * up.z) * sp;
        } else if (fly.rmb) {
          fly.heading += e.movementX * 0.0028;
          fly.pitch = Math.max(-1.45, Math.min(1.45, fly.pitch - e.movementY * 0.0028));
        } else if (fly.grab) {
          // grabbed asset follows the cursor across the ground (Blender G)
          const hit = pickPoint(e);
          if (hit) {
            const rec = fly.grab.rec;
            rec.group.position.set(hit.point.x, groundHeight(hit.point.x, hit.point.z) + (rec.entry.yOffset || 0), hit.point.z);
            editorTools.selectionBox?.update();
          }
        } else {
          updateHover(e);
        }
        return;
      }
      if (fly.photo) {
        if (document.pointerLockElement !== canvas) return;
        fly.heading += e.movementX * 0.0022;
        fly.pitch = Math.max(-1.45, Math.min(1.45, fly.pitch - e.movementY * 0.0022));
        return;
      }
      if (document.pointerLockElement !== canvas) return;
      // Driving: WASD only — mouse does not yaw (camera follows the car)
      if (vehicle.active) return;
      player.heading += e.movementX * 0.0022;
      player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - e.movementY * 0.0022));
    };
    const onMouseDown = (e) => {
      if (!editor.mode) return;
      if (e.button === 2) { fly.rmb = true; e.preventDefault(); }
      if (e.button === 1) {
        e.preventDefault();
        if (e.shiftKey) { fly.pan = true; return; }
        // orbit pivot: whatever is under the cursor, else 30m ahead
        const hit = pickPoint(e);
        const d = flyForward();
        const pv = hit ? hit.point : { x: fly.x + d.x * 30, y: fly.y + d.y * 30, z: fly.z + d.z * 30 };
        fly.orbit = {
          px: pv.x, py: pv.y, pz: pv.z,
          dist: Math.max(2, Math.hypot(fly.x - pv.x, fly.y - pv.y, fly.z - pv.z)),
        };
      }
    };
    const onMouseUp = (e) => {
      if (e.button === 2) fly.rmb = false;
      if (e.button === 1) { fly.orbit = null; fly.pan = false; }
    };
    const onWheel = (e) => {
      if (!editor.mode) return;
      e.preventDefault();
      // Blender-style dolly, speed scales with height above ground
      const d = flyForward();
      const scale = Math.max(4, fly.y - groundHeight(fly.x, fly.z) + 6);
      const step = -Math.sign(e.deltaY) * scale * 0.22;
      fly.x += d.x * step;
      fly.y += d.y * step;
      fly.z += d.z * step;
      const minY = groundHeight(fly.x, fly.z) + 1.2;
      if (fly.y < minY) fly.y = minY;
    };
    const onContextMenu = (e) => {
      if (editor.mode) e.preventDefault();
    };
    const onLock = () => {
      const locked = document.pointerLockElement === canvas;
      setHudLocked(locked);
      if (hudDomRef.current?.__hudApi) hudDomRef.current.__hudApi.setLocked(locked);
    };
    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      postFx?.setSize(mount.clientWidth, mount.clientHeight);
    };
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    document.addEventListener("mousemove", onMouse);
    document.addEventListener("pointerlockchange", onLock);
    window.addEventListener("resize", onResize);

    // ---- main loop ----
    let lastShadowX = 1e9, lastShadowZ = 1e9; // force a first bake
    const clock = new THREE.Clock();
    let fpsCount = 0, fpsTime = performance.now(), fpsVal = 0, hudTick = 0, precipTick = 0, ambTick = 0;
    let lastFrameAt = null;
    let lastPerfResourceSampleAt = 0;
    // Protect frame pacing on real devices: a complex cell can briefly exceed
    // the budget even after the boot GPU probe. Auto quality may step down once
    // sustained FPS is low; manual presets are never overridden.
    let qualityGuardLow = 0;
    let qualityGuardGood = 0;
    let lastQualityGuard = performance.now();
    let populationAccum = 0;
    // per-frame scratch (avoid allocating objects/closures in the hot loop)
    const nearRoadOpts = { nearRoad: true };
    let nearRoadAcc = 1, nearRoadCached = true; // nearDrivable throttled to ~4 Hz
    let padX = 0, padZ = 0;
    const blocked = (x, z) => insideBuilding(x + padX, z + padZ) || insideBuilding(x, z);
    const posObj = { lat: 0, lon: 0, heading: 0, height: 0 };
    let liveHudAt = 0; // setLiveHud throttle (<=2 Hz)
    let walkMetersAccum = 0;
    let lastElev = null;
    let elevClimbAccum = 0;
    let trailTick = 0;
    const flushWalk = () => {
      if (walkMetersAccum <= 0 && elevClimbAccum <= 0) return;
      const city =
        (typeof placeRef.current === "string" && placeRef.current) ||
        placeRef.current?.text ||
        "Unknown";
      const country =
        typeof placeRef.current === "string" && placeRef.current.includes(",")
          ? placeRef.current.split(",").pop()?.trim()
          : null;
      if (walkMetersAccum > 0) {
        recordWalk(walkMetersAccum, city, country);
        walkMetersAccum = 0;
      }
      if (elevClimbAccum > 0) {
        recordElevClimb(elevClimbAccum);
        elevClimbAccum = 0;
      }
    };
    const loop = (rafTimestamp) => {
      if (!running) return;
      requestAnimationFrame(loop);
      const frameAt = Number.isFinite(rafTimestamp) ? rafTimestamp : performance.now();
      if (frameAt - lastPerfResourceSampleAt >= 1000) {
        setPerfResourceCounts({
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          programs: renderer.info.programs?.length ?? null,
        });
        lastPerfResourceSampleAt = frameAt;
      }
      if (document.visibilityState === "visible" && lastFrameAt !== null) {
        recordFrameInterval(frameAt - lastFrameAt);
      }
      lastFrameAt = document.visibilityState === "visible" ? frameAt : null;
      const dt = Math.min(clock.getDelta(), 0.1);

      let f = 0, r = 0;
      const touch = touchInputRef.current;
      if (touch) {
        const tm = readTouchMovement(touch);
        f += tm.f;
        r += tm.r;
        applyTouchLook(touch, player, 1, { driving: vehicle.active });
      }
      if (keys.KeyW || keys.ArrowUp) f += 1;
      if (keys.KeyS || keys.ArrowDown) f -= 1;
      if (keys.KeyD || keys.ArrowRight) r += 1;
      if (keys.KeyA || keys.ArrowLeft) r -= 1;
      if (editor.mode || fly.photo) {
        // free-fly: WASD along the look direction, Space/C vertical, Shift fast
        const sp = (keys.ShiftLeft || keys.ShiftRight ? 75 : 28) * dt;
        const sinH = Math.sin(fly.heading), cosH = Math.cos(fly.heading);
        const cosP = Math.cos(fly.pitch), sinP = Math.sin(fly.pitch);
        fly.x += (f * sinH * cosP + r * cosH) * sp;
        fly.z += (-f * cosH * cosP + r * sinH) * sp;
        fly.y += f * sinP * sp + ((keys.Space ? 1 : 0) - (keys.KeyC ? 1 : 0)) * sp;
        const minY = groundHeight(fly.x, fly.z) + 1.2;
        if (fly.y < minY) fly.y = minY;
        camera.position.set(fly.x, fly.y, fly.z);
        camera.rotation.y = -fly.heading;
        camera.rotation.x = fly.pitch;
        player.moving = false;
        f = 0; r = 0;
      }
      player.moving = editor.mode || fly.photo ? false : !!(f || r);
      if (vehicle.active && !editor.mode && !fly.photo) {
        nearRoadAcc += dt;
        if (nearRoadAcc >= 0.25) {
          nearRoadAcc = 0;
          nearRoadCached = population?.nearDrivable?.(vehicle.state.x, vehicle.state.z) !== false;
        }
        nearRoadOpts.nearRoad = nearRoadCached;
        const pose = vehicle.update(dt, { f, r }, nearRoadOpts);
        if (pose) {
          player.x = pose.x;
          player.z = pose.z;
          // Keep walk heading for HUD/minimap; car mesh uses pose.heading (+Z).
          // Conversion is a MIRROR (walk 0 = −Z, car 0 = +Z), not a π offset.
          player.heading = Math.PI - pose.heading;
          player.pitch = 0;
          population?.setDrivenPose?.(pose.carIndex, pose);
          const night = (runtimeHour ?? 12) < 6.5 || (runtimeHour ?? 12) >= 19;
          const hl = night ? 2.4 : 0;
          headL.intensity = hl;
          headR.intensity = hl;
          // headlights along car nose (+Z at heading 0)
          const fx = pose.x + Math.sin(pose.heading) * 2.2;
          const fz = pose.z + Math.cos(pose.heading) * 2.2;
          headL.position.set(
            pose.x - Math.cos(pose.heading) * 0.6,
            pose.y + 0.9,
            pose.z + Math.sin(pose.heading) * 0.6
          );
          headR.position.set(
            pose.x + Math.cos(pose.heading) * 0.6,
            pose.y + 0.9,
            pose.z - Math.sin(pose.heading) * 0.6
          );
          headL.target.position.set(fx, pose.y + 0.4, fz);
          headR.target.position.set(fx, pose.y + 0.4, fz);
          ambience.set?.({ engine: Math.min(1, Math.abs(pose.speed) / 22) });
          player.moving = Math.abs(pose.speed) > 0.3;
          if (player.moving) {
            walkMetersAccum += Math.abs(pose.speed) * dt;
            if (walkMetersAccum >= 8) flushWalk();
          }
        }
        f = 0;
        r = 0;
      } else if (player.moving) {
        nearRoadAcc = 1; // re-sample immediately when the next drive starts
        const run =
          keys.ShiftLeft || keys.ShiftRight || touch?.sprint ? RUN_MULT : 1;
        const d = WALK_SPEED * run * dt;
        const sin = Math.sin(player.heading), cos = Math.cos(player.heading);
        const dx = (f * sin + r * cos) * d;
        const dz = (-f * cos + r * sin) * d;
        // pad the test point 0.45 m along the motion so the near plane
        // never pokes through a wall before collision triggers
        const len = Math.hypot(dx, dz) || 1;
        padX = (dx / len) * 0.45; padZ = (dz / len) * 0.45;
        const nx = player.x + dx, nz = player.z + dz;
        const ox = player.x, oz = player.z;
        if (!blocked(nx, nz)) { player.x = nx; player.z = nz; }
        else if (!blocked(player.x, nz)) player.z = nz;
        else if (!blocked(nx, player.z)) player.x = nx;
        const moved = Math.hypot(player.x - ox, player.z - oz);
        if (moved > 0) {
          walkMetersAccum += moved;
          if (walkMetersAccum >= 8) flushWalk();
        }
      }
      syncStreetLightQuality();
      let gy = groundHeight(player.x, player.z);
      // stand on bridge decks when above them
      const decks = runtime.current.bridgeDecks;
      if (decks) {
        for (const dk of decks) {
          // cheap reject: player outside the deck's padded bounding box
          if (!dk.bb) {
            let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
            for (const p of dk.pts) {
              if (p.x < x0) x0 = p.x;
              if (p.x > x1) x1 = p.x;
              if (p.y < z0) z0 = p.y;
              if (p.y > z1) z1 = p.y;
            }
            dk.bb = { x0: x0 - dk.halfW, x1: x1 + dk.halfW, z0: z0 - dk.halfW, z1: z1 + dk.halfW };
          }
          if (player.x < dk.bb.x0 || player.x > dk.bb.x1 || player.z < dk.bb.z0 || player.z > dk.bb.z1) continue;
          const P = dk.pts;
          for (let i = 1; i < P.length; i++) {
            const ax = P[i - 1].x, az = P[i - 1].y, bx = P[i].x, bz = P[i].y;
            const abx = bx - ax, abz = bz - az;
            const l2 = abx * abx + abz * abz || 1;
            let t = ((player.x - ax) * abx + (player.z - az) * abz) / l2;
            t = Math.max(0, Math.min(1, t));
            const qx = ax + abx * t, qz = az + abz * t;
            if (Math.hypot(player.x - qx, player.z - qz) < dk.halfW) {
              const tt = (dk.cum[i - 1] + Math.sqrt(l2) * t) / dk.len;
              const dy = dk.y0 + (dk.y1 - dk.y0) * tt;
              if (dy > gy - 3) gy = Math.max(gy, dy);
              break;
            }
          }
        }
      }

      if (!editor.mode && !fly.photo && vehicle.active) {
        // Chase cam locked behind the car — lookAt so WASD turns the car, not the view
        const vh = vehicle.state.heading;
        let back = 11;
        const bsx = Math.sin(vh), bcz = Math.cos(vh);
        for (let tries = 0; tries < 3 && insideBuilding(player.x - bsx * back, player.z - bcz * back); tries++) back *= 0.55;
        const cx = player.x - bsx * back;
        const cz = player.z - bcz * back;
        const camGround = groundHeight(cx, cz);
        const cy = Math.max(gy + 4.2, camGround + 0.6);
        camera.position.set(cx, cy, cz);
        camera.lookAt(player.x, gy + 1.2, player.z);
      } else if (!editor.mode && !fly.photo && player.third) {
        if (avatar) {
          avatar.position.set(player.x, gy, player.z);
          avatar.rotation.y = -player.heading + Math.PI;
        }
        // chase camera: shorten the boom if it would sit inside a building,
        // and never let it dip below the terrain
        let back = 7;
        const bsx = Math.sin(player.heading), bcz = Math.cos(player.heading);
        for (let tries = 0; tries < 3 && insideBuilding(player.x - bsx * back, player.z + bcz * back); tries++) back *= 0.55;
        const cx = player.x - bsx * back, cz = player.z + bcz * back;
        const camGround = groundHeight(cx, cz);
        const cy = Math.max(gy + 3, camGround + 0.6);
        camera.position.set(cx, cy, cz);
        camera.rotation.y = -player.heading;
        camera.rotation.x = -0.22 + player.pitch * 0.4;
      } else if (!editor.mode && !fly.photo) {
        camera.position.set(player.x, gy + EYE, player.z);
        camera.rotation.y = -player.heading;
        camera.rotation.x = player.pitch;
      }
      // animate wind turbines + precipitation
      for (const r of runtime.current.spinners || []) r.rotation.z += dt * 1.4;
      // Population motion does not need to run at display refresh rate. A
      // 30 Hz simulation still reads as smooth because transforms are held
      // between updates, while it removes dozens of terrain samples and
      // matrix writes per second on mobile/medium tiers.
      const benchmarkPopulationFrozen = window.__BENCH_MODE === true && window.__BENCH_FREEZE_POPULATION === true;
      if (benchmarkPopulationFrozen) {
        populationAccum = 0;
      } else {
        populationAccum += dt;
        const populationStep = qualityTier === "high" ? 0 : qualityTier === "medium" ? 1 / 30 : 1 / 20;
        if (population && (populationStep === 0 || populationAccum >= populationStep)) {
          population.update(populationAccum, player, runtimeHour, !!precip);
          populationAccum = 0;
        }
      }
      if (++ambTick % 120 === 0) ambience.set({ hour: runtimeHour, raining: !!precip });
      if (precip && ++precipTick % 2 === 0) {
        const a = precip.geo.attributes.position;
        for (let i = 0; i < a.count; i++) {
          let y = a.getY(i) - precip.speed * dt * 2;
          if (y < 0) y = 40;
          a.setY(i, y);
        }
        a.needsUpdate = true;
        precip.points.position.set(player.x, gy, player.z);
      }
      // keep the shadow frustum centred on the player, offset toward the sun
      sun.target.position.set(player.x, gy, player.z);
      sun.position.set(player.x + sunDir.x, gy + sunDir.y, player.z + sunDir.z);
      // re-bake shadows only after meaningful movement (frustum is +/-180 m)
      if (
        Math.abs(player.x - lastShadowX) > 25 ||
        Math.abs(player.z - lastShadowZ) > 25
      ) {
        lastShadowX = player.x;
        lastShadowZ = player.z;
        renderer.shadowMap.needsUpdate = true;
      }
      {
        const g = toGeo(player.x, player.z);
        posObj.lat = g.lat; posObj.lon = g.lon; posObj.heading = player.heading; posObj.height = gy + 2;
        posRef.current = posObj;
        // Stream neighbor city cells + terrain as the player walks (~every 0.5s).
        if (hudTick % 30 === 0) {
          runtime.current.cellStreamer?.tick(g.lat, g.lon);
          ensureTerrainAround(g.lat, g.lon);
        }
        // 10.5: trail + elevation climbed (live buffer — no React churn)
        if (++trailTick % 8 === 0 && player.moving) {
          trailRef.current?.push(g.lat, g.lon);
          if (trailTick % 96 === 0) {
            const snap = trailRef.current?.takeDirty();
            if (snap) setTrail(snap);
          }
        }
        if (lastElev != null && gy > lastElev + 0.15) elevClimbAccum += gy - lastElev;
        lastElev = gy;
      }
      renderMeasuredFrame();

      fpsCount++;
      const now = performance.now();
      if (now - fpsTime >= 1000) {
        fpsVal = Math.round((fpsCount * 1000) / (now - fpsTime));
        fpsCount = 0; fpsTime = now;
        // Require several consecutive samples before changing quality so a
        // one-off streamed cell does not cause visible preset thrashing.
        const currentSettings = useGameStore.getState().settings;
        if (currentSettings.qualityMode !== "manual") {
          if (fpsVal > 0 && fpsVal < 30) {
            qualityGuardLow += 1;
            qualityGuardGood = 0;
          } else if (fpsVal >= 52) {
            qualityGuardGood += 1;
            qualityGuardLow = 0;
          } else {
            qualityGuardLow = 0;
            qualityGuardGood = 0;
          }
          const nextQuality = qualityGuardLow >= 3
            ? ({ high: "medium", medium: "low" }[qualityTier] || qualityTier)
            : qualityGuardGood >= 12
              ? ({ low: "medium", medium: "high" }[qualityTier] || qualityTier)
              : qualityTier;
          if (nextQuality !== qualityTier && now - lastQualityGuard > 2500) {
            qualityGuardLow = 0;
            qualityGuardGood = 0;
            lastQualityGuard = now;
            qualityTier = nextQuality;
            applyQuality(nextQuality);
            changeSettingStore({ quality: nextQuality, qualityMode: "auto" });
          }
        }
      }
      if (++hudTick % 20 === 0) {
        if (!hudDom && hudDomRef.current) {
          hudDom = createHudRef(hudDomRef.current);
        }
        recordFpsSample(fpsVal);
        hudDom?.update({
          fps: fpsVal,
          elev: Math.round(gy),
          locked: document.pointerLockElement === canvas,
          third: player.third,
        });
        // GameShell reads React `status.fps` — keep it in sync (data-hud-fps is gone).
        // Each setLiveHud re-renders the React tree; elevation changes every
        // metre while walking slopes, so cap at ~2 Hz.
        if (now - liveHudAt >= 500) {
          liveHudAt = now;
          setLiveHud((prev) =>
            prev.fps === fpsVal && prev.elev === Math.round(gy)
              ? prev
              : { fps: fpsVal, elev: Math.round(gy) }
          );
        }
      }
    };

    // ---- boot ----
    (async () => {
      await measurePerfAsync("terrain.initial-load", () => loadTerrain());
      if (disposed) return;
      markPerf("terrain-ready", { loadedTiles: terrainTiles.size, flatFallback: terrainTiles.size === 0 });

      const initialSettings = useGameStore.getState().settings || settings || {};
      const initialHour = Number.isFinite(initialSettings.hour)
        ? Math.max(0, Math.min(24, initialSettings.hour))
        : 12;
      const initialWeather = Number.isFinite(initialSettings.weather)
        ? Math.max(0, Math.min(100, initialSettings.weather))
        : 0;
      runtime.current.setTime(initialHour);
      runtime.current.setWeather(initialWeather);
      runtime.current.setPrecip(initialWeather >= 85 ? "rain" : null);
      setPerfMetadata({
        hour: initialHour,
        weather: initialWeather,
        precipitationMode: initialWeather >= 85 ? "rain" : null,
      });
      loadAvatar();
      loop();

      // ---- PROGRESSIVE FIRST PAINT: the world is walkable on terrain alone
      // (the OSM ground texture already shows roads/blocks). Drop the loading
      // screen NOW and stream the city in behind a small toast — cold Overpass
      // cells used to block first paint for 2-3 minutes here. ----
      setReadyPct(100);
      setCityStreaming(true);
      setStage("Streaming city…");
      markPerf("input-ready", { terrainTiles: terrainTiles.size });
      ktx2TextureLoader.setWalkingReady();
      const cityData = await cityDataPromise;
      markPerf("city-data-ready", { elements: cityData?.elements?.length || 0, partial: !!cityData?.partial });
      if (!disposed) setWorldSummary(summarizeCityElements(cityData?.elements || []));
      const edits = (await editsPromise) || {};
      runtime.current.edits = edits;
      runtime.current.editsKey = editsKey;
      if (disposed) return;

      // terrain patches: flatten circles into the heightmap BEFORE city build
      for (const tp of edits.terrain || []) {
        const c = toLocal(tp.lat, tp.lon);
        patchTerrain(c.x, c.z, tp.radius || 10, tp.height);
      }
      let cityDataForBuild = cityData;
      if (cityData && readOnlyCityData) {
        let elements = cityData.elements || [];
        let changed = false;
        // hidden features: filter a new array without rewriting the shared cache entry
        if (edits.hidden?.length) {
          const hiddenSet = new Set(edits.hidden);
          elements = elements.filter((el) => !hiddenSet.has(`${el.type}/${el.id}`));
          changed = true;
        }
        // tag overrides: clone only the elements and tag objects that change
        const overrides = edits.tagOverrides;
        if (overrides) {
          let changedElements = null;
          for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            const override = overrides[`${el.type}/${el.id}`];
            if (!override) continue;
            changedElements ||= elements.slice();
            changedElements[i] = { ...el, tags: { ...(el.tags || {}), ...override } };
          }
          if (changedElements) {
            elements = changedElements;
            changed = true;
          }
        }
        if (changed) cityDataForBuild = { ...cityData, elements };
      } else if (cityData) {
        // Preserve the old mutation path for the benchmark's deep-clone baseline.
        if (edits.hidden?.length) {
          const hiddenSet = new Set(edits.hidden);
          cityData.elements = (cityData.elements || []).filter(
            (el) => !hiddenSet.has(`${el.type}/${el.id}`)
          );
        }
        if (edits.tagOverrides) {
          for (const el of cityData.elements || []) {
            const override = edits.tagOverrides[`${el.type}/${el.id}`];
            if (override) el.tags = { ...(el.tags || {}), ...override };
          }
        }
      }

      const cityBuilt = await loadCity(cityDataForBuild);
      if (disposed) return;
      const benchmarkStartPose = window.__BENCH_MODE === true ? window.__BENCH_START_POSE : null;
      if (benchmarkStartPose) {
        const { x, z, heading } = benchmarkStartPose;
        if (![x, z, heading].every(Number.isFinite) || insideBuilding(x, z)) {
          throw new Error("Benchmark start pose must be finite and outside buildings");
        }
        player.x = x;
        player.z = z;
        player.heading = heading;
        player.pitch = 0;
        player.moving = false;
        window.__BENCH_POSE_APPLIED = true;
      }
      markPerf("streaming-complete", { scope: "spawn-cell", cityBuilt });
      for (const entry of edits.assets || []) placeAsset(entry, false);

      // The street is already navigable once terrain and static city geometry
      // exist. Do not make first interaction wait for optional GLB downloads
      // and population setup; those are streamed into the scene below.
      setCityStreaming(false);
      if (!disposed) window.__engineReady = cityBuilt;
      setStage(cityBuilt ? "Ready" : "City unavailable · retrying nearby streets");

      // ---- Walk-time cell streaming: assemble neighbor cells as the player
      // crosses ~650 m boundaries (R2 warm hits are ~1–2s; cold Overpass slower).
      const cellStreamer = createCellStreamer({
        scene,
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
        isDisposed: () => disposed,
        onLoading: (n) => {
          if (disposed) return;
          if (n > 0) {
            setCityStreaming(true);
            setStage("Streaming nearby streets · keep exploring");
          } else {
            setCityStreaming(!window.__engineReady);
            setStage(window.__engineReady ? "Ready" : "City unavailable · retrying shortly");
          }
        },
        onCellLoaded: () => { if (!disposed) window.__engineReady = true; },
        maxCells: 10,
        buildCity: (args) => cityBuilder.build({ ...args, profileQueries: profileCityQueries, roadQueryMode: benchmarkRoadQueryMode }),
      });
      if (cityBuilt) {
        cellStreamer.markLoaded(cityCacheKey(lat0, lon0), lat0, lon0);
        cellStreamer.noteSpawnElements?.(cityData?.elements);
      }
      runtime.current.cellStreamer = cellStreamer;
      // Kick off the ring of neighbors immediately (don't wait 10s).
      cellStreamer.tick(lat0, lon0);

      // ---- populated world: pedestrians, traffic, birds, POI signs ----
      // Special asset names replace the built-in shapes: upload car.glb,
      // bird.glb or pedestrian.glb to the library and traffic/birds/people
      // render with those models (instanced, so still one draw call each).
      const loadPopModels = async () => {
        const out = {};
        try {
          const list = await assetListPromise;
          const names = new Set((Array.isArray(list) ? list : []).map((a) => a.name));
          const specs = [
            ["car", "car.glb", 4.4, "length"],
            ["bird", "bird.glb", 0.8, "length"],
            ["ped", "pedestrian.glb", 1.75, "height"],
          ];
          for (const [mkey, file, target, mode] of specs) {
            if (!names.has(file)) continue;
            try {
              const root = await loadGLB(`/api/assets/${file}`);
              root.updateMatrixWorld(true);
              const geos = [], mats = [];
              root.traverse((o) => {
                // skip skinned/rigged meshes — InstancedMesh can't drive them
                if (o.isMesh && !o.isSkinnedMesh && o.geometry) {
                  const g2 = o.geometry.clone().applyMatrix4(o.matrixWorld);
                  g2.morphAttributes = {};
                  g2.deleteAttribute("skinIndex");
                  g2.deleteAttribute("skinWeight");
                  geos.push(g2);
                  const m = Array.isArray(o.material) ? o.material[0] : o.material;
                  if (m) mats.push(m);
                }
              });
              if (!geos.length) continue;
              const merged = mergeGeometries(geos, false);
              if (!merged) continue;
              merged.computeBoundingBox();
              const size = new THREE.Vector3();
              merged.boundingBox.getSize(size);
              // vehicles/birds must point down +Z: if the model is wider than
              // long it was authored facing ±X — rotate it onto the Z axis
              if (mode === "length" && size.x > size.z * 1.15) {
                merged.rotateY(Math.PI / 2);
                merged.computeBoundingBox();
                merged.boundingBox.getSize(size);
              }
              const cur = mode === "height" ? size.y : Math.max(size.x, size.z);
              const sc = target / (cur || 1);
              merged.scale(sc, sc, sc);
              merged.computeBoundingBox();
              const bb = merged.boundingBox;
              merged.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
              // InstancedMesh needs one material — clone so we don't mutate the GLB
              const baseMat = mats[0];
              const material = baseMat?.isMaterial
                ? baseMat.clone()
                : getSimpleStandard(0x888888, { roughness: 0.8 });
              out[mkey] = { geometry: merged, material };
              console.log(`[population] using ${file} for ${mkey}`);
            } catch (err) {
              console.warn(`[population] ${file}:`, err?.message);
            }
          }
        } catch { /* library unreachable — built-ins */ }
        return out;
      };
      try {
        const popModels = await loadPopModels();
        if (disposed) {
          for (const model of Object.values(popModels)) { model.geometry?.dispose(); model.material?.dispose(); }
          return;
        }
        population = createPopulation({
          scene,
          groundHeight,
          roadPaths: runtime.current.roadPaths || [],
          pois: runtime.current.pois || [],
          models: popModels,
          signals: (runtime.current.propMarkers || []).filter((p) => p.kind === "signals"),
          insideBuilding,
          maxPeds: qualityTier === "low" ? 52 : qualityTier === "medium" ? 96 : 140,
          maxCars: qualityTier === "low" ? 24 : qualityTier === "medium" ? 48 : 70,
          maxBirds: qualityTier === "low" ? 12 : qualityTier === "medium" ? 24 : 36,
          random: window.__BENCH_MODE === true
            ? createSeededRandom(Number.isInteger(window.__BENCH_SEED) ? window.__BENCH_SEED : 1337)
            : Math.random,
        });
        console.log("[population]", population.counts);
        // The high-tier pool is created once eligible lamp markers are known.
        // It is reassigned as streamed cell metadata changes and held at zero
        // intensity below high so quality transitions keep a stable light count.
        streetLightWorldReady = true;
        syncStreetLightQuality();
        const enrichedDensity = Number(cityData?.enrichment?.density?.urban) || 0;
        ambience.set({
          density: Math.min(1, Math.max(population.counts.peds / 140, enrichedDensity * 0.65)),
        });
        runtime.current.population = population;
      } catch (err) {
        console.warn("[population]", err?.message);
      }

      if (disposed) return;
      // Safe spawn: never inside a building — spiral to nearest open spot.
      if (insideBuilding(player.x, player.z)) {
        outer: for (const rad of [12, 25, 45, 70, 100, 140]) {
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const sx = player.x + Math.sin(a) * rad;
            const sz = player.z + Math.cos(a) * rad;
            if (!insideBuilding(sx, sz)) {
              player.x = sx;
              player.z = sz;
              break outer;
            }
          }
        }
      }
      // ---- live weather & time (Open-Meteo, keyless) ----
      runtime.current.applyRealWeather = async () => {
        try {
          const r = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat0}&longitude=${lon0}&current=temperature_2m,precipitation,cloud_cover,is_day,weather_code&timezone=auto`, { signal }
          );
          const d = await r.json();
          if (disposed) return null;
          const c = d.current;
          const localHour = new Date(Date.now() + (d.utc_offset_seconds || 0) * 1000).getUTCHours() +
            new Date(Date.now() + (d.utc_offset_seconds || 0) * 1000).getUTCMinutes() / 60;
          const w = Math.min(100, (c.cloud_cover || 0) * 0.8 + (c.precipitation > 0 ? 30 : 0));
          runtime.current.setTime(localHour);
          runtime.current.setWeather(w);
          runtime.current.setPrecip(
            c.precipitation > 0.05 ? (c.temperature_2m <= 0.5 ? "snow" : "rain") : null
          );
          return { hour: Math.round(localHour * 2) / 2, weather: Math.round(w), temp: c.temperature_2m, rain: c.precipitation };
        } catch { return null; }
      };
      // soft-sync HUD status strip once (non-blocking)
      if (window.__BENCH_MODE !== true) {
        runtime.current.applyRealWeather?.().then((r) => {
          if (!r || disposed) return;
          changeSettingStore({ hour: r.hour, weather: r.weather });
          setLiveTemp(r.temp);
        });
      }

      window.__streetDebug = {
        player,
        setWetRoadMapCandidate: (enabled) => window.__BENCH_MODE === true ? setWetRoadMapCandidate(enabled) : null,
        wetRoadMapStats: () => window.__BENCH_MODE === true ? wetRoadMapStats() : null,
        cityDataCopyMode: readOnlyCityData ? "readonly" : "clone",
        insideBuilding,
        groundHeight,
        propMarkers: () => runtime.current.propMarkers || [],
        streetLightStats: () => {
          const sl = runtime.current.streetLights;
          const markers = runtime.current.propMarkers || [];
          const lampMarkers = markers.filter((marker) => marker.kind === "lamp");
          if (!sl) return {
            pool: 0,
            on: 0,
            assigned: 0,
            visible: 0,
            lampMarkers: lampMarkers.length,
            qualityTier,
            nightAmount: currentStreetLightNight,
            keepInactiveVisible: null,
          };
          const g = scene.getObjectByName("streetLights");
          const lights = g ? g.children.filter((c) => c.isSpotLight) : [];
          return {
            pool: lights.length,
            on: lights.filter((l) => l.visible && l.intensity > 0).length,
            assigned: lights.filter((l) => l.userData.assigned).length,
            visible: lights.filter((l) => l.visible).length,
            lampMarkers: lampMarkers.length,
            qualityTier,
            nightAmount: currentStreetLightNight,
            keepInactiveVisible: sl.keepInactiveVisible,
          };
        },
        shaderProgramCount: () => renderer.info.programs?.length ?? null,
        setInactiveStreetLightsVisible: (visible) => {
          const sl = runtime.current.streetLights;
          if (!sl) return null;
          sl.setKeepInactiveVisible(visible === true);
          const g = scene.getObjectByName("streetLights");
          const lights = g ? g.children.filter((c) => c.isSpotLight) : [];
          return {
            pool: lights.length,
            on: lights.filter((l) => l.visible && l.intensity > 0).length,
            visible: lights.filter((l) => l.visible).length,
            keepInactiveVisible: sl.keepInactiveVisible,
          };
        },
        nameplates: () => population?.getNameplateStats?.(player) || [],
        // How the opening shot was framed (lib/engine/street/spawn.js): mode,
        // metres moved from the requested point, and the view-cone score.
        spawnFraming: () => runtime.current.spawnFraming || null,
        cellStream: () => runtime.current.cellStreamer?.debugState?.() || null,
        cityBuilder: () => cityBuilder.debugState(),
        setPostFxState: ({ active, ssao }) => {
          if (!postFx) return null;
          postFxOverride = { active: active === true, ssao: ssao === true };
          postFx.setEnabled(active === true, ssao === true);
          const state = {
            postFxActive: postFx.active,
            ssaoActive: postFx.ssaoActive,
            bloomActive: postFx.bloomActive,
          };
          setPerfMetadata(state);
          return state;
        },
        vehicle,
        population: () => population,
        tickPopulation: () => population?.update?.(1 / 60, player, runtimeHour, false),
        fly,
        setTime: (h) => runtime.current.setTime?.(h),
        pickAt: (cx, cy) => {
          const h = pickPoint({ clientX: cx, clientY: cy });
          return h ? resolveOsmAt(h) : null;
        },
        meshes: () => {
          const out = [];
          scene.traverse((o) => {
            if (o.isMesh) {
              const b = new THREE.Box3().setFromObject(o);
              out.push({
                tris: (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3,
                min: b.min.toArray().map((v) => Math.round(v)),
                max: b.max.toArray().map((v) => Math.round(v)),
                color: o.material.color?.getHexString?.(),
                hasMap: !!o.material.map,
              });
            }
          });
          return out;
        },
        materialInventory: () => {
          const materials = new Map();
          const textures = new Map();
          const geometries = new Set();
          let meshCount = 0;
          let instancedMeshCount = 0;
          let instanceCount = 0;
          const textureRoles = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap"];
          scene.traverse((o) => {
            if (!o.isMesh) return;
            meshCount++;
            if (o.geometry?.uuid) geometries.add(o.geometry.uuid);
            if (o.isInstancedMesh) {
              instancedMeshCount++;
              instanceCount += o.count || 0;
            }
            for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
              if (!material) continue;
              let entry = materials.get(material.uuid);
              if (!entry) {
                entry = {
                  uuid: material.uuid,
                  name: material.name || "",
                  type: material.type,
                  color: material.color?.getHexString?.() || null,
                  vertexColors: !!material.vertexColors,
                  transparent: !!material.transparent,
                  side: material.side,
                  roughness: Number.isFinite(material.roughness) ? material.roughness : null,
                  metalness: Number.isFinite(material.metalness) ? material.metalness : null,
                  shared: !!material.userData?.shared,
                  roles: [],
                  meshUses: 0,
                };
                materials.set(material.uuid, entry);
              }
              entry.meshUses++;
              for (const role of textureRoles) {
                const texture = material[role];
                if (!texture) continue;
                if (!entry.roles.includes(role)) entry.roles.push(role);
                let tex = textures.get(texture.uuid);
                if (!tex) {
                  const image = texture.image || {};
                  tex = {
                    uuid: texture.uuid,
                    width: image.width || image.videoWidth || null,
                    height: image.height || image.videoHeight || null,
                    colorSpace: texture.colorSpace,
                    roles: [],
                  };
                  textures.set(texture.uuid, tex);
                }
                if (!tex.roles.includes(role)) tex.roles.push(role);
              }
            }
          });
          const materialFamilies = new Map();
          const textureRoleBindings = new Map();
          for (const material of materials.values()) {
            const family = [
              material.type,
              material.roles.join("+") || "unmapped",
              material.vertexColors ? "vertex-color" : "no-vertex-color",
              material.transparent ? "transparent" : "opaque",
              `side-${material.side}`,
            ].join("|");
            const entry = materialFamilies.get(family) || { family, materialCount: 0, meshUses: 0, colorVariants: new Set() };
            entry.materialCount++;
            entry.meshUses += material.meshUses;
            entry.colorVariants.add(material.color);
            materialFamilies.set(family, entry);
            for (const role of material.roles) {
              const roleEntry = textureRoleBindings.get(role) || { role, materialBindings: 0, meshBindings: 0, uniqueTextures: 0 };
              roleEntry.materialBindings++;
              roleEntry.meshBindings += material.meshUses;
              textureRoleBindings.set(role, roleEntry);
            }
          }
          for (const texture of textures.values()) {
            for (const role of texture.roles) {
              const roleEntry = textureRoleBindings.get(role);
              if (roleEntry) roleEntry.uniqueTextures++;
            }
          }
          return {
            meshCount,
            uniqueGeometryCount: geometries.size,
            instancedMeshCount,
            instanceCount,
            uniqueMaterialCount: materials.size,
            uniqueTextureCount: textures.size,
            textureRoleBindings: [...textureRoleBindings.values()].sort((a, b) => a.role.localeCompare(b.role)),
            materialFamilies: [...materialFamilies.values()]
              .map(({ colorVariants, ...entry }) => ({ ...entry, colorVariantCount: colorVariants.size }))
              .sort((a, b) => b.meshUses - a.meshUses),
            materials: [...materials.values()],
            textures: [...textures.values()],
            factoryCache: materialFactoryInventory(),
          };
        },
      };
      // location title — skip during Where-am-I so the answer never leaks
      if (!useGameStore.getState().whereAmI) {
        fetch(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat0}&longitude=${lon0}&localityLanguage=en`, { signal }
        )
          .then((r) => r.json())
          .then((d) => {
            if (disposed || useGameStore.getState().whereAmI) return;
            const line = [d.locality || d.city, d.countryName].filter(Boolean).join(", ");
            if (line) setPlace(line);
          })
          .catch(() => {});
      }
    })().catch(error => {
      if (!disposed) { setStage(error.message || "Unable to load world"); setBootError(error); }
    });

    return () => {
      disposed = true;
      lifetime.abort();
      cityBuilder.dispose();
      running = false;
      if (typeof window !== 'undefined') {
        window.__engineReady = false;
        if (window.__streetDebug?.player === player) delete window.__streetDebug;
      }
      flushWalk();
      {
        const snap = trailRef.current?.snapshot();
        if (snap?.length) setTrail(snap);
      }
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      document.removeEventListener("mousemove", onMouse);
      document.removeEventListener("pointerlockchange", onLock);
      window.removeEventListener("resize", onResize);
      population?.dispose();
      streetLights?.dispose();
      postFx?.dispose();
      editorTools.dispose();
      ambience.dispose();
      setRoadEnvironment(null);
      envCtrl.dispose();
      runtime.current.cellStreamer?.dispose?.();
      ktx2TextureLoader.dispose();
      disposeSceneGroup(scene, scene, sharedMaterialTextures());
      disposeMaterialCache();
      terrain.dispose();
      if (engineRef.current === runtime.current) engineRef.current = {};
      gpuTimer.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat0, lon0, settings.groundSource]);

  if (bootError) throw bootError;

  const streetStatus = {
    mode: "walk",
    lat: lat0,
    lon: lon0,
    heading: 0,
    height: 200,
    fps: liveHud.fps,
    locked: hudLocked,
    elevation: liveHud.elev,
  };

  return (
    <main>
      <div ref={mountRef} className="cesium-container" />
      {readyPct < 100 && (
        <LoadingScreen title="STREET ENGINE" pct={readyPct} stage={stage} />
      )}

      {readyPct >= 100 && (
        <GameShell
          engine="street"
          screen="play"
          status={streetStatus}
          posRef={posRef}
          trailRef={trailRef}
          panel={panel}
          setPanel={setPanel}
          bigMap={bigMap}
          setBigMap={setBigMap}
          place={whereAmI && !whereAmI.revealed ? null : place}
          settings={settings}
          onSettingChange={changeSetting}
          onTravel={(la, lo) => router.push(`/street?lat=${la}&lon=${lo}`)}
          savedPlaces={savedPlaces}
          onSavePlace={() => {
            const cur = posRef.current || { lat: lat0, lon: lon0 };
            const name = window.prompt("Name this place", place ?? "");
            if (name) addPlace(name.trim(), cur.lat, cur.lon);
          }}
          onRemovePlace={removePlace}
          onGoHome={() => router.push("/")}
          walking
          modeLabel="Street"
          liveTemp={liveTemp}
          worldSummary={worldSummary}
          hintText={
            photoMode
              ? "PHOTO · WASD fly · click to look · 📸 save · Esc/H exit"
              : uiMode === "editor"
              ? "EDITOR · scroll zoom · MMB orbit · RMB look · WASD fly · 1-5 tools"
              : uiMode === "debug"
              ? "TAG INSPECTOR · WASD fly · RMB look · click a building/road/prop"
              : hudLocked
              ? "WASD move · mouse look · Shift sprint · C enter/exit car · WASD drive · V view · M travel · H photo"
              : "Click to capture mouse · WASD walk · C enter car · M travel · H photo"
          }
          hudRef={hudDomRef}
          coordsFallback={{ lat: lat0, lon: lon0 }}
          photoMode={photoMode}
          passport={passport}
          shareToast={shareToast}
          whereAmI={whereAmI}
          onExportWalkCard={() => {
            import("@/lib/engine/walk-card").then(({ downloadWalkCard }) => {
              const p = useGameStore.getState().passport;
              const live = trailRef.current?.snapshot();
              const label =
                (typeof placeRef.current === "string" && placeRef.current) ||
                placeRef.current?.text ||
                "Walk card";
              downloadWalkCard(
                { ...p, trail: live?.length ? live : p.trail },
                { place: label }
              );
            });
          }}
          onWhereAmIGuess={guessWhereAmI}
          onWhereAmIClose={clearWhereAmI}
          onWhereAmIAgain={() => {
            const round = whereAmIRound();
            if (!round) return;
            startWhereAmI(round);
            router.push(`/street?lat=${round.lat.toFixed(5)}&lon=${round.lon.toFixed(5)}&guess=1`);
          }}
          onShare={shareSpot}
          onPhotoMode={() => {
            if (whereAmI && !whereAmI.revealed) return;
            togglePhotoMode();
            setPanel(null);
          }}
          onPhotoCapture={capturePhoto}
          settingsExtra={
            <div className="mb-4">
              <button type="button" className={`${menuBtnPrimary} w-full`} onClick={useRealWeather}>
                {liveWx === "loading" ? "⏳ Fetching real conditions…" : "🌍 Use real weather & time"}
              </button>
              {typeof liveWx === "string" && liveWx !== "loading" && (
                <p className="mt-2 text-xs text-slate-500">{liveWx}</p>
              )}
            </div>
          }
          pauseButtons={[
            { label: "▶ Resume", primary: true, onClick: () => setPanel(null) },
            { label: "🗺 Fast Travel", onClick: () => setPanel("travel") },
            { label: "🛂 Passport", onClick: () => setPanel("passport") },
            { label: "⚙ Settings", onClick: () => setPanel("settings") },
            { label: "🌐 Globe View", onClick: () => router.push("/") },
          ]}
        />
      )}

      {readyPct >= 100 && cityStreaming && !photoMode && (
        <div className="pointer-events-none absolute left-1/2 top-28 z-20 max-w-[70vw] -translate-x-1/2 whitespace-nowrap rounded-full border border-mint/20 bg-[rgba(6,15,25,0.9)] px-4 py-1.5 text-[11px] text-slate-300 shadow-[0_8px_28px_rgba(0,0,0,0.45)] backdrop-blur sm:bottom-24 sm:top-auto sm:text-xs">
          <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400 align-middle" />
          {stage}
        </div>
      )}

      {readyPct >= 100 && !photoMode && (
        <div className="absolute bottom-32 right-4 z-20 flex flex-col items-end gap-2">
          {settings.developerMode && (
            <button
              type="button"
              onClick={() => engineRef.current.setMode?.("editor")}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold backdrop-blur transition-colors ${
                uiMode === "editor"
                  ? "border-emerald-400 bg-emerald-500/80 text-black"
                  : "border-white/15 bg-slate-950/70 text-slate-200 hover:bg-slate-800/80"
              }`}
              title="Map editor (E): place assets, sculpt terrain, hide broken features"
            >
              Edit <kbd className="ml-1 opacity-60">E</kbd>
            </button>
          )}
          <button
            type="button"
            onClick={() => engineRef.current.toggleMute?.()}
            className="hidden rounded-xl border border-white/10 bg-slate-950/75 px-3 py-2 text-[11px] font-semibold text-slate-300 backdrop-blur hover:bg-slate-800/80 sm:block"
            title="Ambient sound on/off"
          >
            {mutedUi ? "Sound off" : "Sound on"}
          </button>
          {settings.developerMode && (
            <button
              type="button"
              onClick={() => engineRef.current.setMode?.("debug")}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold backdrop-blur transition-colors ${
                uiMode === "debug"
                  ? "border-sky-400 bg-sky-500/80 text-black"
                  : "border-white/15 bg-slate-950/70 text-slate-200 hover:bg-slate-800/80"
              }`}
              title="OSM tag inspector (B): click features to view/fix their tags"
            >
              Map data <kbd className="ml-1 opacity-60">B</kbd>
            </button>
          )}
        </div>
      )}

      {readyPct >= 100 && uiMode === "editor" && !photoMode && (
        <div className="absolute left-4 top-16 z-20 w-72 rounded-xl border border-white/10 bg-slate-950/90 p-4 text-xs text-slate-200 shadow-xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-bold tracking-wide">🛠 MAP EDITOR</span>
            <button type="button" className="text-slate-400 hover:text-white" onClick={() => engineRef.current.setMode?.("editor")}>✕</button>
          </div>
          <input
            type="password"
            placeholder="editor key (needed only to Save)"
            defaultValue={typeof window !== "undefined" ? localStorage.getItem("wtw_editor_key") || "" : ""}
            onChange={(ev) => engineRef.current.editorApi?.setEditorKey(ev.target.value)}
            className="mb-2 w-full rounded bg-black/40 px-2 py-1 outline-none ring-1 ring-white/10 focus:ring-accent"
          />
          {typeof window !== "undefined" && !localStorage.getItem("wtw_editor_key") && (
            <p className="mb-2 text-[11px] leading-snug text-amber-300/90">
              You can explore every tool without a key — it's only required to 💾 Save.
              The key is the EDITOR_SECRET env var of this deployment.
            </p>
          )}
          <div className="mb-2 grid grid-cols-3 gap-1">
            <button type="button" className={toolBtn} onClick={() => engineRef.current.editorApi?.setTool(null)}><kbd className="mr-1 opacity-50">1</kbd>Select</button>
            <button type="button" className={toolBtn} onClick={() => engineRef.current.editorApi?.setTool({ type: "flatten", radius: brushRadius })}><kbd className="mr-1 opacity-50">2</kbd>Flatten</button>
            <button type="button" className={toolBtn} onClick={() => engineRef.current.editorApi?.setTool({ type: "raise", radius: brushRadius })}><kbd className="mr-1 opacity-50">3</kbd>Raise</button>
            <button type="button" className={toolBtn} onClick={() => engineRef.current.editorApi?.setTool({ type: "lower", radius: brushRadius })}><kbd className="mr-1 opacity-50">4</kbd>Lower</button>
            <button type="button" className={toolBtn} onClick={() => engineRef.current.editorApi?.setTool({ type: "hide" })}><kbd className="mr-1 opacity-50">5</kbd>Hide</button>
            <button type="button" className={toolBtnPrimary} onClick={() => engineRef.current.editorApi?.save()}>💾 Save</button>
          </div>
          <label className="mb-2 flex items-center gap-2 text-slate-400">
            brush
            <input
              type="range"
              min={4}
              max={60}
              value={brushRadius}
              onChange={(ev) => setBrushRadius(Number(ev.target.value))}
              className="flex-1"
            />
            {brushRadius}m
          </label>
          <div className="mb-2 flex gap-1">
            <button type="button" className={toolBtn} onClick={() => engineRef.current.editorApi?.clearHidden()}>Unhide all</button>
            <button type="button" className={toolBtn} onClick={() => engineRef.current.editorApi?.clearTerrain()}>Reset terrain</button>
          </div>
          <div className="mb-1 text-slate-400">Assets — click to arm, then click the ground:</div>
          <div className="max-h-40 space-y-1 overflow-auto">
            {assetList.map((a) => (
              <button
                type="button"
                key={a.name}
                className="block w-full truncate rounded bg-white/5 px-2 py-1 text-left hover:bg-white/15"
                onClick={() => engineRef.current.editorApi?.setTool({ type: "asset", name: a.name, url: a.url })}
              >
                📦 {a.name}
              </button>
            ))}
            {assetList.length === 0 && (
              <div className="text-slate-500">no assets yet — upload .glb files at <span className="font-mono">/editor</span></div>
            )}
          </div>
          {editorMsg && <div className="mt-2 text-emerald-300">{editorMsg}</div>}
          <div className="mt-2 space-y-0.5 text-slate-500">
            <div>✈ Scroll zoom · MMB orbit · Shift+MMB pan · RMB look · WASD fly · Space/C up/down</div>
            <div>1-5 tools · click to apply · Ctrl+Z undo · Esc deselect · E exit</div>
            <div>Selected asset: G move · R rotate · [ ] scale · X delete</div>
            <div>Hover shows what you'd pick; Hide removes OSM features on reload.</div>
          </div>
        </div>
      )}

      {readyPct >= 100 && uiMode === "debug" && !photoMode && (
        <div className="absolute left-4 top-16 z-20 w-80 rounded-xl border border-white/10 bg-slate-950/90 p-4 text-xs text-slate-200 shadow-xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-bold tracking-wide">🔍 OSM DEBUG</span>
            <button type="button" className="text-slate-400 hover:text-white" onClick={() => engineRef.current.setMode?.("debug")}>✕</button>
          </div>
          {!debugSel && <div className="text-slate-400">Click a building or road to inspect its OSM tags.</div>}
          {debugSel?.kind === "none" && <div className="text-slate-400">Nothing with OSM data there.</div>}
          {debugSel?.id && (
            <>
              <div className="mb-1 font-mono text-amber-300">
                {debugSel.kind} · {debugSel.id}
              </div>
              <textarea
                rows={8}
                value={tagDraft}
                onChange={(ev) => setTagDraft(ev.target.value)}
                spellCheck={false}
                className="w-full rounded bg-black/40 p-2 font-mono outline-none ring-1 ring-white/10 focus:ring-accent"
              />
              <div className="mt-2 flex items-center gap-2">
                <button type="button" className={toolBtnPrimary} onClick={saveTagDraft}>💾 Save override</button>
                <a
                  className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
                  href={`https://www.openstreetmap.org/edit?${debugSel.id.replace("/", "=")}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Edit on OSM ↗
                </a>
              </div>
              {debugSel.saved && <div className="mt-2 text-emerald-300">{debugSel.saved}</div>}
              <div className="mt-2 text-slate-500">Overrides are local (stored in R2), merged over OSM data on reload.</div>
            </>
          )}
          <div className="mt-2 text-slate-500">✈ Scroll zoom · MMB orbit · Shift+MMB pan · RMB look · WASD fly · B exit</div>
        </div>
      )}
    </main>
  );
}
