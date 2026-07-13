"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { LoadingScreen } from "@/components/hud/Panels";
import { lon2tx, lat2ty, tx2lon, ty2lat, makeLocalFrame } from "@/lib/engine/geo";
import { fetchCityData, cityCacheKey } from "@/lib/engine/cityData";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createPopulation } from "@/lib/engine/population";
import { createAmbience } from "@/lib/engine/ambience";
import { groundTileUrl } from "@/lib/engine/ground-tiles";
import { whereAmIRound } from "@/lib/daily";
import { createEnvController } from "@/lib/engine/env-map";
import { runCityBuilder } from "@/lib/engine/city-builder";
import { assembleCityFromBuild } from "@/lib/engine/street/assemble-city";
import { createCellStreamer } from "@/lib/engine/street/cell-stream";
import { clipElementsToCell } from "@/lib/engine/cell-clip";
import { getSimpleStandard } from "@/lib/engine/materials";
import { createVehicleController } from "@/lib/engine/street/vehicle";
import { createPostFx } from "@/lib/engine/post-fx";
import { applyAutoQuality } from "@/lib/engine/gpu-tier";
import { createTrailBuffer } from "@/lib/engine/trail-buffer";

const toolBtn = "rounded bg-white/10 px-2 py-1 hover:bg-white/20";
const toolBtnPrimary = "rounded bg-emerald-500/80 px-2 py-1 font-semibold text-black hover:bg-emerald-400";
import { trackRender, recordFpsSample } from "@/lib/perf";
import { STREET } from "@/lib/engine/street/constants";
import { createCollision } from "@/lib/engine/street/collision";
import { createGroundHeight, createTerrainPatcher } from "@/lib/engine/street/ground-height";
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






export default function StreetEngine({ lat0, lon0 }) {
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
    const mount = mountRef.current;
    if (!mount) return;

    if (typeof window !== 'undefined') {
      window.__engineReady = false;
      window.__streetTriangles = 0;
    }

    const cityDataPromise = fetchCityData(lat0, lon0).catch((e) => {
      console.warn("[street] city data:", e?.message);
      return null;
    });
    const editsKey = cityCacheKey(lat0, lon0);
    const editsPromise = fetch(`/api/edits/${editsKey}`)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));

    // ---- local ENU conversion (lib/engine/geo) ----
    const { toLocal, toGeo } = makeLocalFrame(lat0, lon0);

    // ---- three basics ----
    const renderer = new THREE.WebGLRenderer({
      antialias: true, // MSAA — the merged low-poly scene can afford it
      powerPreference: "high-performance",
    });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    // filmic tone mapping: richer sky gradients, softer highlights, deeper
    // shadow color — the single cheapest whole-scene visual upgrade
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
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
    // 16.2: SSAO + bloom only on high (wired after lights exist)
    let postFx = null;
    let applyQuality = () => {};

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
            : Math.min(window.devicePixelRatio, 2)
      );
      renderer.shadowMap.enabled = quality !== "low";
      sun.castShadow = quality !== "low";
      if (quality === "low") sun.shadow.mapSize.set(512, 512);
      else if (quality === "medium") sun.shadow.mapSize.set(1024, 1024);
      else sun.shadow.mapSize.set(2048, 2048);
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      postFx.setSize(mount.clientWidth, mount.clientHeight);
      postFx.setEnabled(quality === "high");
    };
    applyQuality(bootQuality || useGameStore.getState().settings?.quality || "medium");

    // ---- settings hooks (time of day / weather / quality) ----
    const daySky = new THREE.Color(0x9cc4e8);
    const duskSky = new THREE.Color(0xd8926a);
    const nightSky = new THREE.Color(0x0c1428);
    let weatherAmt = 0;
    const sunDir = new THREE.Vector3(300, 500, -200);
    const applySky = (hour) => {
      // sun elevation from local solar hour
      const t = ((hour - 6) / 12) * Math.PI; // 6h→sunrise, 18h→sunset
      const elev = Math.sin(t);
      sunDir.set(Math.cos(t) * 500, Math.max(elev, 0.08) * 500, -200);
      sun.position.set(sunDir.x, sunDir.y, sunDir.z);
      sun.intensity = Math.max(0, elev) * 1.6 + 0.05;
      // keep hemi low — PMREM env map carries most of the ambient/reflections
      hemi.intensity = 0.12 + Math.max(0, elev) * 0.28;
      envCtrl.apply(scene, hour, weatherAmt);
      // windows light up as the sun sets (elev < ~0.08 → fully lit)
      const winGlow = Math.max(0, Math.min(1, (0.08 - elev) * 9)) * 0.85;
      for (const bm of engineRef.current.buildingMats || []) bm.emissiveIntensity = winGlow;
      if (engineRef.current.lampPools) {
        // slight "bloom" via brighter additive pools at night
        engineRef.current.lampPools.opacity = winGlow * (1.05 + winGlow * 0.35);
      }
      const sky = new THREE.Color();
      if (elev > 0.25) sky.copy(daySky);
      else if (elev > -0.05) sky.lerpColors(duskSky, daySky, (elev + 0.05) / 0.3);
      else sky.copy(nightSky);
      sky.lerp(new THREE.Color(0x8a8f96), weatherAmt * 0.7); // overcast grey
      scene.background = sky;
      scene.fog.color.copy(sky);
      // denser fog in weather + height-ish mood: dawn/dusk thicker, noon clearer
      const duskMood = 1 - Math.abs(elev); // 0 at noon, 1 at horizon
      const baseDens = 0.00038 + duskMood * 0.00035 + weatherAmt * 0.0011;
      scene.fog.density = baseDens;
      // exposure: warmer/brighter dusk, cooler night
      renderer.toneMappingExposure =
        elev > 0.2 ? 1.15 : elev > 0 ? 1.28 : 0.92 + winGlow * 0.25;
      postFx?.setNightBloom(winGlow);
      // sun + moon ride opposite ends of the same arc
      sunSprite.position.set(Math.cos(t) * 4200, elev * 4200, -1600);
      moonSprite.position.set(-Math.cos(t) * 4200, -elev * 4200, -1600);
      sunSprite.material.opacity = Math.max(0, Math.min(1, (elev + 0.08) * 5)) * (1 - weatherAmt * 0.8);
      moonSprite.material.opacity = Math.max(0, Math.min(1, (-elev + 0.08) * 5)) * (1 - weatherAmt * 0.8);
      // street lamps switch on after dusk
      const night = elev < 0.12;
      const glows = engineRef.current.lampGlows || [];
      for (const m of glows) m.color.setHex(night ? 0xffe9a8 : 0x1a1c20);
    };
    engineRef.current.setTime = (hour) => applySky(hour);
    engineRef.current.setWeather = (w) => {
      weatherAmt = w / 100;
      applySky(engineRefHour);
    };
    let engineRefHour = 12;
    const origSetTime = engineRef.current.setTime;
    engineRef.current.setTime = (h) => {
      engineRefHour = h;
      origSetTime(h);
    };
    // ---- precipitation particles (rain/snow) ----
    let precip = null;
    engineRef.current.setPrecip = (mode) => {
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

    engineRef.current.setQuality = (q) => {
      applyQuality(q);
    };

    // ---- state ----
    const player = { x: 0, z: 0, heading: 0, pitch: 0, third: false, moving: false };
    const keys = {};
    const terrainTiles = new Map();
    const tileMeshes = []; // {key, mesh} — for live terrain patching
    const tileCanvases = [];
    const { addFootprint, insideBuilding, footprintAt, removeFootprintsByCell } = createCollision(GRID);
    const ghRef = { fn: () => 0 };
    const vehicle = createVehicleController({
      insideBuilding,
      groundHeight: (x, z) => ghRef.fn(x, z),
    });
    // headlights for night driving
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
    engineRef.current.setMusic = (on) => ambience.set({ music: on !== false });
    // hydrate music preference
    ambience.set({ music: useGameStore.getState().settings?.music !== false });

    // ---- editor / debug ----
    engineRef.current.edits = engineRef.current.edits || {};
    const editor = { mode: null, tool: null, placed: [], selected: null, undo: [] };
    // free-fly camera rig for editor/debug — Blender-style:
    // scroll zoom, MMB orbit, Shift+MMB pan, RMB (or MMB) freelook fallback
    const fly = {
      x: 0, y: 0, z: 0, heading: 0, pitch: 0,
      rmb: false, orbit: null, pan: false, grab: null, photo: false,
    };
    const flyForward = () => {
      const cp = Math.cos(fly.pitch);
      return new THREE.Vector3(Math.sin(fly.heading) * cp, Math.sin(fly.pitch), -Math.cos(fly.heading) * cp);
    };
    const lookAtPivot = () => {
      const o = fly.orbit;
      const d = flyForward();
      fly.x = o.px - d.x * o.dist;
      fly.y = o.py - d.y * o.dist;
      fly.z = o.pz - d.z * o.dist;
    };
    const raycaster = new THREE.Raycaster();

    // hover visuals: brush ring for terrain tools, outline for pickable features,
    // box helper for placed-asset select/hover
    const brushRing = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide })
    );
    brushRing.renderOrder = 999;
    brushRing.visible = false;
    scene.add(brushRing);
    const outlineLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x4ae3ff, depthTest: false, linewidth: 2 })
    );
    outlineLine.renderOrder = 999;
    outlineLine.visible = false;
    scene.add(outlineLine);
    let selBox = null;
    const clearSelBox = () => { if (selBox) { scene.remove(selBox); selBox = null; } };
    const showSelBox = (obj, color = 0x4ae3ff) => {
      clearSelBox();
      selBox = new THREE.BoxHelper(obj, color);
      selBox.material.depthTest = false;
      selBox.renderOrder = 999;
      scene.add(selBox);
    };
    const showOutline = (pts, closed) => {
      if (!pts || pts.length < 2) { outlineLine.visible = false; return; }
      const arr = closed ? [...pts, pts[0]] : pts;
      const v = [];
      for (const q of arr) {
        const qx = q[0], qz = q[1];
        v.push(qx, groundHeight(qx, qz) + 0.5, qz);
      }
      outlineLine.geometry.dispose();
      outlineLine.geometry = new THREE.BufferGeometry();
      outlineLine.geometry.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
      outlineLine.visible = true;
    };
    const hideHover = () => { brushRing.visible = false; outlineLine.visible = false; };
    let hoverT = 0;
    const updateHover = (e) => {
      if (!editor.mode) { hideHover(); return; }
      const now = performance.now();
      if (now - hoverT < 60) return;
      hoverT = now;
      const hit = pickPoint(e);
      if (!hit) { hideHover(); return; }
      const t = editor.tool;
      const terrainTool = t && ["flatten", "raise", "lower"].includes(t.type);
      if (editor.mode === "editor" && terrainTool) {
        outlineLine.visible = false;
        brushRing.visible = true;
        brushRing.position.set(hit.point.x, groundHeight(hit.point.x, hit.point.z) + 0.4, hit.point.z);
        brushRing.scale.setScalar(t.radius || 12);
      } else if (editor.mode === "editor" && t?.type === "asset") {
        outlineLine.visible = false;
        brushRing.visible = true;
        brushRing.position.set(hit.point.x, groundHeight(hit.point.x, hit.point.z) + 0.4, hit.point.z);
        brushRing.scale.setScalar(1.5);
      } else {
        brushRing.visible = false;
        const sel = resolveOsmAt(hit);
        if (sel?.outline) showOutline(sel.outline, sel.closed);
        else outlineLine.visible = false;
      }
    };
    // GLBs with external resources (e.g. Kenney's Textures/colormap.png)
    // resolve relative to the model URL — flatten every relative request to
    // the asset library so textures load from /api/assets/<basename>
    const gltfManager = new THREE.LoadingManager();
    gltfManager.setURLModifier((url) => {
      if (/^(https?:|data:|blob:)/.test(url)) return url;
      if (url.startsWith("/") && !url.startsWith("/api/assets/")) return url;
      const base = url.split(/[/?#]/).filter(Boolean).pop();
      return `/api/assets/${base}`;
    });
    const gltfLoader = new GLTFLoader(gltfManager);
    const loadGLB = (url) =>
      new Promise((res, rej) => gltfLoader.load(url, (g) => res(g.scene), undefined, rej));
    const placeAsset = async (entry, record) => {
      try {
        const obj = await loadGLB(entry.url);
        obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        const p = toLocal(entry.lat, entry.lon);
        obj.position.set(p.x, groundHeight(p.x, p.z) + (entry.yOffset || 0), p.z);
        obj.rotation.y = entry.rotY || 0;
        obj.scale.setScalar(entry.scale || 1);
        scene.add(obj);
        editor.placed.push({ group: obj, entry });
        if (record) ((engineRef.current.edits.assets ||= [])).push(entry);
      } catch (err) {
        console.warn("[editor] asset load failed:", err?.message);
        setEditorMsg(`failed to load ${entry.name}`);
      }
    };
    const saveEdits = async () => {
      try {
        const res = await fetch(`/api/edits/${editsKey}`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "x-editor-key": localStorage.getItem("wtw_editor_key") || "",
          },
          body: JSON.stringify(engineRef.current.edits || {}),
        });
        return res.ok;
      } catch { return false; }
    };
    const pickPoint = (e) => {
      const el = renderer.domElement;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      return hits.find((h) => h.object.isMesh) || null;
    };
    const distToSeg = (x, z, a, b) => {
      const dx = b.x - a.x, dz = b.z - a.z;
      const L2 = dx * dx + dz * dz;
      const t = L2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)) : 0;
      return Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz));
    };
    // Resolve the OSM feature at a raycast hit: building footprint first
    // (nudged along the ray — wall hits land exactly ON the edge), then the
    // nearest road centerline. Shared by debug mode and the hide tool.
    const resolveOsmAt = (hit) => {
      const { x, z } = hit.point;
      // per-mesh identity (anything that sets userData.osm)
      for (let o = hit.object; o; o = o.parent) {
        if (o.userData?.osm) {
          const u = o.userData.osm;
          return { kind: u.kind || "feature", id: u.id, tags: { ...u.tags }, outline: u.outline };
        }
      }
      // props (gates, trees, lamps… baked into merged meshes — match by position)
      let bp = null;
      for (const pr of engineRef.current.propMarkers || []) {
        if (!pr.id) continue;
        const d = Math.hypot(x - pr.x, z - pr.z);
        if (d <= 3 && (!bp || d < bp.d)) bp = { d, pr };
      }
      if (bp) {
        const { pr } = bp;
        const R = 1.6, ring = [];
        for (let i = 0; i < 12; i++)
          ring.push([pr.x + Math.cos((i / 12) * Math.PI * 2) * R, pr.z + Math.sin((i / 12) * Math.PI * 2) * R]);
        return { kind: `prop (${pr.kind})`, id: pr.id, tags: { ...pr.tags }, outline: ring, closed: true };
      }
      const dir = raycaster.ray.direction;
      const fp = footprintAt(x, z) || footprintAt(x + dir.x * 0.4, z + dir.z * 0.4);
      if (fp?.meta?.id)
        return { kind: "building", id: fp.meta.id, tags: { ...fp.meta.tags }, outline: fp.poly, closed: true };
      let best = null;
      for (const rp of engineRef.current.roadPaths || []) {
        if (!rp.id) continue;
        for (let i = 0; i < rp.pts.length - 1; i++) {
          // road pts are THREE.Vector2 in the XZ plane: .y holds z
          const a = rp.pts[i], b2 = rp.pts[i + 1];
          const d = distToSeg(x, z, { x: a.x, z: a.y }, { x: b2.x, z: b2.y });
          if (d <= Math.max((rp.width || 6) * 0.75, 5) && (!best || d < best.d)) best = { d, rp };
        }
      }
      return best
        ? { kind: "road", id: best.rp.id, tags: { ...best.rp.tags }, outline: best.rp.pts.map((v) => [v.x, v.y]) }
        : null;
    };
    const debugPick = (e) => {
      const hit = pickPoint(e);
      if (!hit) { setDebugSel(null); return; }
      let sel = resolveOsmAt(hit);
      if (sel) {
        const ov = engineRef.current.edits?.tagOverrides?.[sel.id];
        if (ov) sel.tags = { ...sel.tags, ...ov };
      }
      setDebugSel(sel || { kind: "none" });
    };
    const editorClick = async (e) => {
      const hit = pickPoint(e);
      if (!hit) return;
      const { x, z } = hit.point;
      const t = editor.tool;
      if (!t) {
        let idx = null;
        outer: for (let i = 0; i < editor.placed.length; i++) {
          for (let o = hit.object; o; o = o.parent)
            if (o === editor.placed[i].group) { idx = i; break outer; }
        }
        if (idx === null) {
          // small assets are easy to miss — select the nearest within 3m
          let bd = 3;
          for (let i = 0; i < editor.placed.length; i++) {
            const gp = editor.placed[i].group.position;
            const d = Math.hypot(x - gp.x, z - gp.z);
            if (d < bd) { bd = d; idx = i; }
          }
        }
        editor.selected = idx;
        if (idx !== null) showSelBox(editor.placed[idx].group);
        else clearSelBox();
        setEditorMsg(
          idx !== null
            ? `selected ${editor.placed[idx].entry.name} — G move · R rotate · [ ] scale · X delete`
            : "nothing selected — click a placed asset, or pick a tool"
        );
        return;
      }
      if (t.type === "asset") {
        const g = toGeo(x, z);
        await placeAsset({ name: t.name, url: t.url, lat: g.lat, lon: g.lon, rotY: 0, scale: 1 }, true);
        editor.undo.push({ type: "asset" });
        setEditorMsg(`placed ${t.name} — 💾 Save to persist`);
      } else if (t.type === "flatten" || t.type === "raise" || t.type === "lower") {
        const r = t.radius || 12;
        // flatten targets the clicked height; raise/lower shift it (repeat
        // clicks stack) — enough to close terrain gaps or bury seams by hand
        const h =
          groundHeight(x, z) + (t.type === "raise" ? 1.5 : t.type === "lower" ? -1.5 : 0);
        patchTerrain(x, z, r, h);
        const g = toGeo(x, z);
        ((engineRef.current.edits.terrain ||= [])).push({ lat: g.lat, lon: g.lon, radius: r, height: h });
        editor.undo.push({ type: "terrain", prevH: groundHeight(x, z), x, z, r });
        setEditorMsg(`terrain ${t.type} applied (${r}m) — 💾 Save to persist`);
      } else if (t.type === "hide") {
        const sel = resolveOsmAt(hit);
        if (!sel) { setEditorMsg("nothing with OSM data there"); return; }
        const hidden = (engineRef.current.edits.hidden ||= []);
        if (!hidden.includes(sel.id)) { hidden.push(sel.id); editor.undo.push({ type: "hide", id: sel.id }); }
        setEditorMsg(`${sel.id} hidden on next load — 💾 Save to persist (${hidden.length} hidden)`);
      }
    };
    const setMode = (m) => {
      const was = editor.mode;
      editor.mode = editor.mode === m ? null : m;
      if (editor.mode && document.pointerLockElement) document.exitPointerLock();
      if (editor.mode && !was) {
        // enter fly where the player camera is, looking the same way
        fly.x = camera.position.x;
        fly.y = camera.position.y + 4;
        fly.z = camera.position.z;
        fly.heading = player.heading;
        fly.pitch = Math.max(-1.2, player.pitch - 0.3);
      }
      if (!editor.mode) { hideHover(); clearSelBox(); }
      setUiMode(editor.mode);
      if (editor.mode !== "debug") setDebugSel(null);
      if (editor.mode !== "editor") { editor.tool = null; editor.selected = null; setEditorMsg(null); }
    };
    engineRef.current.setMode = setMode;
    engineRef.current.toggleMute = () => setMutedUi(ambience.toggleMute());
    setMutedUi(ambience.muted);
    engineRef.current.setPhotoFly = (on) => {
      if (on) {
        if (document.pointerLockElement) document.exitPointerLock();
        fly.x = camera.position.x;
        fly.y = camera.position.y + 2;
        fly.z = camera.position.z;
        fly.heading = player.heading;
        fly.pitch = Math.max(-1.2, player.pitch - 0.15);
        fly.photo = true;
      } else {
        fly.photo = false;
      }
    };
    engineRef.current.captureScreenshot = (placeLabel) => {
      if (postFx) postFx.render();
      else renderer.render(scene, camera);
      const cur = posRef.current || { lat: lat0, lon: lon0 };
      return downloadCanvasPng(
        renderer.domElement,
        photoFilename(placeLabel, cur.lat, cur.lon)
      );
    };
    engineRef.current.editorApi = {
      setTool: (t) => {
        editor.tool = t;
        editor.selected = null;
        setEditorMsg(
          !t ? "select mode — click a placed asset"
          : t.type === "hide" ? "hide armed — click a building/road to remove it"
          : ["flatten", "raise", "lower"].includes(t.type) ? `${t.type} armed (${t.radius}m) — click ground`
          : `${t.name} armed — click ground to place`
        );
      },
      save: async () => {
        const ok = await saveEdits();
        setEditorMsg(ok ? "saved to R2 ✓" : "save failed — check editor key");
        return ok;
      },
      setTagOverride: async (id, tags) => {
        ((engineRef.current.edits.tagOverrides ||= {}))[id] = tags;
        return saveEdits();
      },
      setEditorKey: (k) => localStorage.setItem("wtw_editor_key", k),
      clearHidden: () => {
        engineRef.current.edits.hidden = [];
        setEditorMsg("hidden list cleared — 💾 Save, then reload to restore");
      },
      clearTerrain: () => {
        engineRef.current.edits.terrain = [];
        setEditorMsg("terrain edits cleared — 💾 Save, then reload to restore");
      },
    };
    let groundHeight = () => 0;
    let patchTerrain = () => {};
    const spinners = [];
    const lampGlows = [];
    let avatar = null;
    let running = true;
    let hudDom = null;
    const terrainLoading = new Set();
    const loadTerrain = async () => {
      setStage("Streaming terrain…"); setReadyPct(15);
      const ctx = Math.floor(lon2tx(lon0, Z));
      const cty = Math.floor(lat2ty(lat0, Z));
      await loadTerrainTile(ctx, cty, true);
      setReadyPct(40);
      const jobs = [];
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          if (dx !== 0 || dy !== 0)
            jobs.push(loadTerrainTile(ctx + dx, cty + dy, false));
      await Promise.all(jobs);
      groundHeight = createGroundHeight(terrainTiles);
      ghRef.fn = groundHeight;
      patchTerrain = createTerrainPatcher(terrainTiles, tileMeshes);
      setReadyPct(55);
    };

    const loadImage = (url) =>
      new Promise((res, rej) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = url;
      });

    const loadTerrainTile = async (tx, ty, isCenter) => {
      const tKey = `${tx}/${ty}`;
      if (terrainTiles.has(tKey) || terrainLoading.has(tKey)) return;
      terrainLoading.add(tKey);
      try {
        const img = await loadImage(
          `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`
        );
        if (disposed) return;
        const c = document.createElement("canvas");
        c.width = c.height = 256;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, 256, 256).data;
        // downsample to 65x65 grid
        const N = 65;
        const heights = new Float32Array(N * N);
        for (let j = 0; j < N; j++)
          for (let i = 0; i < N; i++) {
            const px = Math.min(255, Math.round((i / (N - 1)) * 255));
            const py = Math.min(255, Math.round((j / (N - 1)) * 255));
            const o = (py * 256 + px) * 4;
            heights[j * N + i] = d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
          }
        const latT = ty2lat(ty, Z), latB = ty2lat(ty + 1, Z);
        const lonL = tx2lon(tx, Z), lonR = tx2lon(tx + 1, Z);
        const tl = toLocal(latT, lonL), br = toLocal(latB, lonR);
        const sizeX = br.x - tl.x, sizeZ = br.z - tl.z;
        terrainTiles.set(tKey, { heights, n: N, x0: tl.x, z0: tl.z, sizeX, sizeZ });

        // geometry
        const geo = new THREE.PlaneGeometry(sizeX, sizeZ, N - 1, N - 1);
        geo.rotateX(-Math.PI / 2);
        const pos = geo.attributes.position;
        for (let j = 0; j < N; j++)
          for (let i = 0; i < N; i++) {
            const v = j * N + i;
            pos.setY(v, heights[j * N + i]);
          }
        geo.computeVertexNormals();

        // Skirt: drop the perimeter down so seams between neighbouring
        // tiles (each samples its own heightmap) never show as gaps.
        {
          const sp = geo.attributes.position;
          const suv = geo.attributes.uv;
          const per = [];
          for (let i = 0; i < N; i++) per.push(i); // top row
          for (let j = 1; j < N; j++) per.push(j * N + (N - 1)); // right col
          for (let i = N - 2; i >= 0; i--) per.push((N - 1) * N + i); // bottom
          for (let j = N - 2; j >= 1; j--) per.push(j * N); // left col
          per.push(per[0]);
          const v = [];
          const uv = [];
          const idx2 = [];
          for (let k = 0; k < per.length; k++) {
            const a = per[k];
            v.push(sp.getX(a), sp.getY(a), sp.getZ(a));
            v.push(sp.getX(a), sp.getY(a) - 30, sp.getZ(a));
            uv.push(suv.getX(a), suv.getY(a), suv.getX(a), suv.getY(a));
          }
          for (let k = 0; k < per.length - 1; k++) {
            const t = k * 2;
            idx2.push(t, t + 1, t + 2, t + 1, t + 3, t + 2);
          }
          const skirt = new THREE.BufferGeometry();
          skirt.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
          skirt.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
          skirt.setIndex(idx2);
          skirt.computeVertexNormals();
          geo.userData.skirt = skirt;
        }

        // Ground imagery (OSM map or Esri satellite) — 2x2 z15 subtiles
        const W = isCenter ? 2048 : 1024; // sharp where the player walks
        const half = W / 2;
        const tex = document.createElement("canvas");
        tex.width = tex.height = W;
        const tg = tex.getContext("2d");
        tg.fillStyle = groundSource === "satellite" ? "#3a4a3a" : "#b5c9a3";
        tg.fillRect(0, 0, W, W);
        const paintImagery = async (src) => {
          const subs = [];
          for (let sy = 0; sy < 2; sy++)
            for (let sx = 0; sx < 2; sx++)
              subs.push(
                loadImage(groundTileUrl(src, Z + 1, tx * 2 + sx, ty * 2 + sy))
                  .then((im) => tg.drawImage(im, sx * half, sy * half, half, half))
                  .catch(() => {})
              );
          await Promise.all(subs);
          texture.needsUpdate = true;
        };
        const texture = new THREE.CanvasTexture(tex);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = isCenter ? 4 : 1;
        const entry = {
          g: tg,
          texture,
          x0: tl.x,
          z0: tl.z,
          sizeX,
          sizeZ,
          w: W,
        };
        tileCanvases.push(entry);
        if (isCenter) {
          await paintImagery(groundSource);
        } else {
          paintImagery(groundSource).catch(() => {});
        }
        const terrMat = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.95,
          metalness: 0,
          envMapIntensity: 0.3,
        });
        const mesh = new THREE.Mesh(geo, terrMat);
        mesh.receiveShadow = true;
        tileMeshes.push({ key: tKey, mesh });
        mesh.position.set(tl.x + sizeX / 2, 0, tl.z + sizeZ / 2);
        scene.add(mesh);
        if (geo.userData.skirt) {
          // unlit + double-sided: seam walls can never shade to black
          const skirtMesh = new THREE.Mesh(
            geo.userData.skirt,
            new THREE.MeshBasicMaterial({ color: 0x97927f, side: THREE.DoubleSide })
          );
          skirtMesh.position.copy(mesh.position);
          scene.add(skirtMesh);
        }
      } catch {
        /* tile failed; hole in the far terrain, fine */
      } finally {
        terrainLoading.delete(tKey);
      }
    };

    // ---- buildings + roads (Worker geometry + main-thread assemble) ----
    const loadCity = async (data) => {
      if (!data?.elements?.length) return;
      // Ownership clip: keep all corridors from the fetch; buildings/props
      // only inside the spawn tile so neighbors can own the rest.
      const elements = clipElementsToCell(data.elements, lat0, lon0);
      if (!elements.length) return;
      setStage(`Building city (${elements.length} features)…`);
      setReadyPct((p) => Math.max(p, 60));
      try {
        if (disposed) return;
        const built = await runCityBuilder({
          elements,
          lat0,
          lon0,
          terrainTiles,
          onProgress: (done, total) => {
            setStage(`Building city (${done}/${total})…`);
            setReadyPct((p) => Math.max(p, 60 + Math.floor((done / Math.max(1, total)) * 25)));
          },
        });
        if (disposed) return;
        setStage("Assembling city…");
        await assembleCityFromBuild(built, {
          scene,
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
          cellKey: cityCacheKey(lat0, lon0),
        });
      } catch (e) {
        console.warn("[street] city build failed:", e?.message || e);
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
          const api = engineRef.current.editorApi;
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
            selBox?.update();
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
                const arr = engineRef.current.edits.assets || [];
                const ai = arr.indexOf(rec.entry);
                if (ai >= 0) arr.splice(ai, 1);
              }
              editor.selected = null;
              clearSelBox();
              setEditorMsg("undid asset placement");
            } else if (u.type === "hide") {
              const hidden = engineRef.current.edits.hidden || [];
              const hi = hidden.indexOf(u.id);
              if (hi >= 0) hidden.splice(hi, 1);
              setEditorMsg(`undid hide of ${u.id}`);
            } else if (u.type === "move") {
              const pl = toLocal(u.orig.lat, u.orig.lon);
              u.rec.entry.lat = u.orig.lat;
              u.rec.entry.lon = u.orig.lon;
              u.rec.group.position.set(pl.x, groundHeight(pl.x, pl.z) + (u.rec.entry.yOffset || 0), pl.z);
              selBox?.update();
              setEditorMsg("undid move");
            } else if (u.type === "terrain") {
              (engineRef.current.edits.terrain || []).pop();
              patchTerrain(u.x, u.z, u.r, u.prevH);
              setEditorMsg("undid terrain edit");
            }
          }
        }
        if (editor.mode === "editor" && editor.selected !== null) {
          const rec = editor.placed[editor.selected];
          if (rec) {
            if (e.code === "KeyR") { rec.entry.rotY = rec.group.rotation.y += Math.PI / 12; selBox?.update(); }
            if (e.code === "BracketLeft") { rec.group.scale.setScalar((rec.entry.scale = Math.max(0.1, (rec.entry.scale || 1) * 0.9))); selBox?.update(); }
            if (e.code === "BracketRight") { rec.group.scale.setScalar((rec.entry.scale = Math.min(50, (rec.entry.scale || 1) * 1.1))); selBox?.update(); }
            if (e.code === "KeyX") {
              scene.remove(rec.group);
              editor.placed.splice(editor.selected, 1);
              const arr = engineRef.current.edits.assets || [];
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
            selBox?.update();
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
    const clock = new THREE.Clock();
    let fpsCount = 0, fpsTime = performance.now(), fpsVal = 0, hudTick = 0, precipTick = 0, ambTick = 0;
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
    const loop = () => {
      if (!running) return;
      requestAnimationFrame(loop);
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
        const pose = vehicle.update(
          dt,
          { f, r },
          { nearRoad: population?.nearDrivable?.(vehicle.state.x, vehicle.state.z) !== false }
        );
        if (pose) {
          player.x = pose.x;
          player.z = pose.z;
          // Keep walk heading for HUD/minimap; car mesh uses pose.heading (+Z).
          // Conversion is a MIRROR (walk 0 = −Z, car 0 = +Z), not a π offset.
          player.heading = Math.PI - pose.heading;
          player.pitch = 0;
          population?.setDrivenPose?.(pose.carIndex, pose);
          const night = (engineRefHour ?? 12) < 6.5 || (engineRefHour ?? 12) >= 19;
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
        const run =
          keys.ShiftLeft || keys.ShiftRight || touch?.sprint ? RUN_MULT : 1;
        const d = WALK_SPEED * run * dt;
        const sin = Math.sin(player.heading), cos = Math.cos(player.heading);
        const dx = (f * sin + r * cos) * d;
        const dz = (-f * cos + r * sin) * d;
        // pad the test point 0.45 m along the motion so the near plane
        // never pokes through a wall before collision triggers
        const len = Math.hypot(dx, dz) || 1;
        const padX = (dx / len) * 0.45, padZ = (dz / len) * 0.45;
        const nx = player.x + dx, nz = player.z + dz;
        const blocked = (x, z) => insideBuilding(x + padX, z + padZ) || insideBuilding(x, z);
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
      let gy = groundHeight(player.x, player.z);
      // stand on bridge decks when above them
      const decks = engineRef.current.bridgeDecks;
      if (decks) {
        for (const dk of decks) {
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
        const boomX = () => player.x - Math.sin(vh) * back;
        const boomZ = () => player.z - Math.cos(vh) * back;
        for (let tries = 0; tries < 3 && insideBuilding(boomX(), boomZ()); tries++) back *= 0.55;
        const cx = boomX();
        const cz = boomZ();
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
        const boomX = () => player.x - Math.sin(player.heading) * back;
        const boomZ = () => player.z + Math.cos(player.heading) * back;
        for (let tries = 0; tries < 3 && insideBuilding(boomX(), boomZ()); tries++) back *= 0.55;
        const cx = boomX(), cz = boomZ();
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
      for (const r of engineRef.current.spinners || []) r.rotation.z += dt * 1.4;
      population?.update(dt, player, engineRefHour, !!precip);
      if (++ambTick % 120 === 0) ambience.set({ hour: engineRefHour, raining: !!precip });
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
      {
        const g = toGeo(player.x, player.z);
        posRef.current = { lat: g.lat, lon: g.lon, heading: player.heading, height: gy + 2 };
        // Stream neighbor city cells + terrain as the player walks (~every 0.5s).
        if (hudTick % 30 === 0) {
          engineRef.current.cellStreamer?.tick(g.lat, g.lon);
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
      if (postFx) postFx.render();
      else renderer.render(scene, camera);

      fpsCount++;
      const now = performance.now();
      if (now - fpsTime >= 1000) {
        fpsVal = Math.round((fpsCount * 1000) / (now - fpsTime));
        fpsCount = 0; fpsTime = now;
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
        setLiveHud((prev) =>
          prev.fps === fpsVal && prev.elev === Math.round(gy)
            ? prev
            : { fps: fpsVal, elev: Math.round(gy) }
        );
      }
    };

    // ---- boot ----
    (async () => {
      await loadTerrain();
      if (disposed) return;

      applySky(12);
      loadAvatar();
      loop();

      // ---- PROGRESSIVE FIRST PAINT: the world is walkable on terrain alone
      // (the OSM ground texture already shows roads/blocks). Drop the loading
      // screen NOW and stream the city in behind a small toast — cold Overpass
      // cells used to block first paint for 2-3 minutes here. ----
      setReadyPct(100);
      setCityStreaming(true);
      setStage("Streaming city…");
      const cityData = await cityDataPromise;
      if (!disposed) setWorldSummary(summarizeCityElements(cityData?.elements || []));
      const edits = (await editsPromise) || {};
      engineRef.current.edits = edits;
      engineRef.current.editsKey = editsKey;
      if (disposed) return;

      // terrain patches: flatten circles into the heightmap BEFORE city build
      for (const tp of edits.terrain || []) {
        const c = toLocal(tp.lat, tp.lon);
        patchTerrain(c.x, c.z, tp.radius || 10, tp.height);
      }
      // hidden features: stray/broken OSM elements removed by the editor
      if (cityData && edits.hidden?.length) {
        const hiddenSet = new Set(edits.hidden);
        cityData.elements = (cityData.elements || []).filter(
          (el) => !hiddenSet.has(`${el.type}/${el.id}`)
        );
      }
      // tag overrides: local corrections over OSM data ("way/123": {k: v})
      if (cityData && edits.tagOverrides) {
        for (const el of cityData.elements || []) {
          const ov = edits.tagOverrides[`${el.type}/${el.id}`];
          if (ov) el.tags = { ...(el.tags || {}), ...ov };
        }
      }

      await loadCity(cityData);
      if (disposed) return;
      for (const entry of edits.assets || []) placeAsset(entry, false);

      // ---- populated world: pedestrians, traffic, birds, POI signs ----
      // Special asset names replace the built-in shapes: upload car.glb,
      // bird.glb or pedestrian.glb to the library and traffic/birds/people
      // render with those models (instanced, so still one draw call each).
      const loadPopModels = async () => {
        const out = {};
        try {
          const list = await fetch("/api/assets").then((r) => (r.ok ? r.json() : []));
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
        population = createPopulation({
          scene,
          groundHeight,
          roadPaths: engineRef.current.roadPaths || [],
          pois: engineRef.current.pois || [],
          models: popModels,
          signals: (engineRef.current.propMarkers || []).filter((p) => p.kind === "signals"),
          insideBuilding,
        });
        console.log("[population]", population.counts);
        ambience.set({ density: Math.min(1, population.counts.peds / 140) });
        engineRef.current.population = population;
      } catch (err) {
        console.warn("[population]", err?.message);
      }

      setCityStreaming(false);
      if (!disposed) window.__engineReady = true;
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
      setStage(cityData ? "Ready" : "Ready (terrain only)");

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
        engineRef,
        player,
        terrainTiles,
        isDisposed: () => disposed,
        onLoading: (n) => {
          if (disposed) return;
          if (n > 0) {
            setCityStreaming(true);
            setStage("Streaming nearby streets · keep exploring");
          } else {
            setCityStreaming(false);
            setStage("Ready");
          }
        },
        maxCells: 9,
      });
      cellStreamer.markLoaded(cityCacheKey(lat0, lon0), lat0, lon0);
      cellStreamer.noteSpawnElements?.(cityData?.elements);
      engineRef.current.cellStreamer = cellStreamer;
      // Kick off the ring of neighbors immediately (don't wait 10s).
      cellStreamer.tick(lat0, lon0);

      // ---- live weather & time (Open-Meteo, keyless) ----
      engineRef.current.applyRealWeather = async () => {
        try {
          const r = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat0}&longitude=${lon0}&current=temperature_2m,precipitation,cloud_cover,is_day,weather_code&timezone=auto`
          );
          const d = await r.json();
          const c = d.current;
          const localHour = new Date(Date.now() + (d.utc_offset_seconds || 0) * 1000).getUTCHours() +
            new Date(Date.now() + (d.utc_offset_seconds || 0) * 1000).getUTCMinutes() / 60;
          const w = Math.min(100, (c.cloud_cover || 0) * 0.8 + (c.precipitation > 0 ? 30 : 0));
          engineRef.current.setTime(localHour);
          engineRef.current.setWeather(w);
          engineRef.current.setPrecip(
            c.precipitation > 0.05 ? (c.temperature_2m <= 0.5 ? "snow" : "rain") : null
          );
          return { hour: Math.round(localHour * 2) / 2, weather: Math.round(w), temp: c.temperature_2m, rain: c.precipitation };
        } catch { return null; }
      };
      // soft-sync HUD status strip once (non-blocking)
      engineRef.current.applyRealWeather?.().then((r) => {
        if (!r || disposed) return;
        changeSettingStore({ hour: r.hour, weather: r.weather });
        setLiveTemp(r.temp);
      });

      window.__streetDebug = {
        player,
        insideBuilding,
        groundHeight,
        propMarkers: () => engineRef.current.propMarkers || [],
        nameplates: () => population?.getNameplateStats?.(player) || [],
        vehicle,
        population: () => population,
        tickPopulation: () => population?.update?.(1 / 60, player, engineRefHour, false),
        fly,
        setTime: (h) => engineRef.current.setTime?.(h),
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
      };
      // location title — skip during Where-am-I so the answer never leaks
      if (!useGameStore.getState().whereAmI) {
        fetch(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat0}&longitude=${lon0}&localityLanguage=en`
        )
          .then((r) => r.json())
          .then((d) => {
            if (useGameStore.getState().whereAmI) return;
            const line = [d.locality || d.city, d.countryName].filter(Boolean).join(", ");
            if (line) setPlace(line);
          })
          .catch(() => {});
      }
    })();

    return () => {
      disposed = true;
      running = false;
      if (typeof window !== 'undefined') {
        window.__engineReady = false;
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
      postFx?.dispose();
      ambience.dispose();
      envCtrl.dispose();
      engineRef.current.cellStreamer?.dispose?.();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat0, lon0, settings.groundSource]);

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
