// @ts-check
import { getCesiumIonToken } from "@/lib/env";
import { loadCesium } from "@/lib/loadCesium";
import { MONUMENTS } from "@/lib/monuments";
import { trackStatusUpdate } from "@/lib/perf";
import { readTouchMovement, touchInputRef } from "@/lib/touch-input";
import { applyAutoQuality } from "@/lib/engine/gpu-tier";
import { streetUrl } from "@/lib/places";
import { flySpeed, globeQualityProfile, nextResolutionScale, saneHeight, solarHourToDate, weatherAtmosphere } from "./globe-math";
import { BUILDINGS_LOAD_HEIGHT, createOsmBuildings } from "./osm-buildings";
import { createRoadOverlay } from "./road-overlay";
import { createGlobeWalker, EYE_HEIGHT } from "./walker";

// CesiumJS 3D globe: global travel, a cinematic fly-down that hands off to the
// street engine, and an optional walk mode inside Cesium.
//
// World layers (all free / non-commercial friendly):
//  - Natural Earth II (bundled) + OSM raster basemap: game-map ground
//  - Cesium World Terrain (ion, optional): real elevation
//  - Cesium OSM Buildings (ion, optional, high tier): styled extrusions

const FLY_KEYS = ["KeyW", "KeyS", "KeyA", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "KeyQ", "ShiftLeft", "KeyE"];

function configureScene(Cesium, viewer) {
  const { scene } = viewer;
  scene.globe.enableLighting = true;
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.dynamicAtmosphereLighting = true;
  scene.fog.enabled = true;
  scene.fog.density = 0.0004;
  // Trade a little detail for frame rate (60 FPS target).
  scene.fog.screenSpaceErrorFactor = 4; // fog culls more distant tiles
  scene.postProcessStages.fxaa.enabled = true;
  scene.globe.maximumScreenSpaceError = 2.5; // terrain LOD (default 2)
  scene.globe.tileCacheSize = 300;
  scene.msaaSamples = 1;
  scene.screenSpaceCameraController.enableCollisionDetection = false; // free flight
  viewer.cesiumWidget.creditContainer.style.display = "none";

  // OSM standard raster: water blue, forests green, roads yellow/white.
  try {
    viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      maximumLevel: 18, // z19 doubles the tile count for little gain
      credit: "© OpenStreetMap contributors",
    }));
  } catch (e) {
    console.warn("[cesium] OSM basemap unavailable:", e?.message);
  }
}

function addMonumentLabels(Cesium, viewer) {
  for (const m of MONUMENTS) {
    viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 120),
      label: {
        text: "★ " + (m.label || m.name),
        font: "600 14px sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#ffd75e"),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(500, 1.1, 60000, 0.0),
      },
    });
  }
}

/**
 * Boots the globe into `container`. Resolves to a controller once ready;
 * `dispose()` may be called at any time, including before it resolves.
 *
 * @param {HTMLElement} container
 * @param {object} options
 * @param {(progress: { pct: number, stage: string }) => void} [options.onProgress]
 * @param {(status: object) => void} options.onStatus
 * @param {(controller: object) => void} [options.onController]  receives the controller just before onReady
 * @param {(info: object) => void} [options.onReady]
 * @param {(lat: number, lon: number) => void} [options.onDepart]  street-bound flight started
 * @param {(lat: number, lon: number, opts: { demo: boolean }) => void} [options.onArrive]
 * @param {{ current: object | null }} [options.posRef]
 * @param {{ getSettings: () => object, changeSetting: (patch: object) => void }} options.store
 */
export function createGlobeRuntime(container, { onProgress, onStatus, onController, onReady, onDepart, onArrive, posRef, store }) {
  let destroyed = false;
  const cleanups = [];
  const isDestroyed = () => destroyed;
  const progress = (pct, stage) => { if (!destroyed) onProgress?.({ pct, stage }); };

  const boot = async () => {
    progress(5, "Loading engine…");
    const Cesium = await loadCesium();
    if (destroyed) return null;
    progress(35, "Creating world…");

    const ionToken = getCesiumIonToken();
    if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;
    // Base: bundled Natural Earth II (zero-config fallback, far view).
    const baseLayer = Cesium.ImageryLayer.fromProviderAsync(
      Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII")),
      {},
    );
    const viewer = new Cesium.Viewer(container, {
      baseLayer,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      requestRenderMode: false,
      contextOptions: { webgl: { powerPreference: "high-performance", antialias: false } },
    });
    cleanups.push(() => { if (!viewer.isDestroyed()) viewer.destroy(); });
    const { scene, camera } = viewer;
    const canvas = scene.canvas;
    configureScene(Cesium, viewer);

    let hasTerrain = false;
    progress(55, "Streaming terrain…");
    if (ionToken) {
      try {
        viewer.terrainProvider = await Cesium.createWorldTerrainAsync({
          requestWaterMask: true, // animated water on seas, rivers and lakes
          requestVertexNormals: true, // shaded mountains
        });
        scene.globe.showWaterEffect = true;
        hasTerrain = true;
      } catch (e) {
        console.warn("[cesium] world terrain unavailable:", e?.message);
      }
    }
    if (destroyed) return null;

    const buildings = createOsmBuildings(Cesium, scene, { enabled: !!ionToken, isDestroyed });
    const roads = createRoadOverlay(Cesium, viewer, { isDestroyed });
    addMonumentLabels(Cesium, viewer);
    progress(95, "Final touches…");

    const walker = createGlobeWalker({ Cesium, viewer, getBuildings: () => buildings.tileset, hasTerrain: () => hasTerrain });
    const w = walker.state;
    let fps = 0;

    const emitStatus = () => {
      let lat, lon, height, heading;
      if (w.active) {
        ({ lat, lon, heading } = w);
        height = w.ground + EYE_HEIGHT;
      } else {
        const cc = Cesium.Cartographic.fromCartesian(camera.position);
        lat = cc.latitude;
        lon = cc.longitude;
        height = cc.height;
        heading = camera.heading;
      }
      trackStatusUpdate();
      onStatus?.({
        fps,
        mode: w.active ? "walk" : "fly",
        view: w.thirdPerson ? "third" : "first",
        elevation: w.active ? Math.round(w.ground) : null,
        locked: document.pointerLockElement === canvas,
        lat: Cesium.Math.toDegrees(lat),
        lon: Cesium.Math.toDegrees(lon),
        height,
        heading,
      });
    };

    const setThirdPerson = (on) => {
      walker.setThirdPerson(on);
      emitStatus();
    };

    const enterWalk = async (latDeg, lonDeg) => {
      buildings.ensure(); // walking inside Cesium collides with them
      let lon, lat;
      if (latDeg !== undefined) {
        lon = Cesium.Math.toRadians(lonDeg);
        lat = Cesium.Math.toRadians(latDeg);
      } else {
        const c = Cesium.Cartographic.fromCartesian(camera.position);
        lon = c.longitude;
        lat = c.latitude;
      }
      await walker.start(lon, lat);
      roads.loadAround(w.lat, w.lon);
      scene.screenSpaceCameraController.enableInputs = false;
      canvas.requestPointerLock?.();
      emitStatus();
    };

    const exitWalk = () => {
      const wasWalking = walker.stop();
      scene.screenSpaceCameraController.enableInputs = true;
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      if (wasWalking) {
        // Rise to a vantage where orbit/zoom controls feel natural.
        camera.flyTo({
          destination: Cesium.Cartesian3.fromRadians(w.lon, w.lat, w.ground + 350),
          orientation: { heading: w.heading, pitch: Cesium.Math.toRadians(-40), roll: 0 },
          duration: 1.2,
        });
      }
      emitStatus();
    };

    // Cesium streams terrain and building tiles hardest while the camera
    // moves, and every decode/GPU upload lands on the main thread: that is the
    // fly-down stutter. Coarsen LOD for the flight and restore it on arrival.
    // This also freezes adaptive resolution, since each resolutionScale step
    // resizes every framebuffer, itself a hitch mid-flight.
    let flying = false;
    const flightLod = (on, hideBuildings = false) => {
      flying = on;
      try {
        scene.globe.maximumScreenSpaceError = on ? 8 : 2.5;
        buildings.setFlight(on, hideBuildings);
      } catch { /* tileset not ready yet */ }
    };

    // "street" hands off to the Three.js engine after the fly-down;
    // "classic" walks inside Cesium.
    let walkEngine = "street";
    const flyToStreet = async (lat, lon, { demo = false } = {}) => {
      exitWalk();
      const toStreet = walkEngine === "street";
      flightLod(true, toStreet);
      if (toStreet) onDepart?.(lat, lon);
      // The exact height only matters when walking inside Cesium; waiting for
      // it held the camera still for about a second after the click.
      const ground = toStreet
        ? saneHeight(scene.globe.getHeight(Cesium.Cartographic.fromDegrees(lon, lat))) ?? 0
        : await walker.preciseGroundHeight(lon, lat);
      if (destroyed) return;
      camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, ground + 260),
        orientation: { heading: Cesium.Math.toRadians(20), pitch: Cesium.Math.toRadians(-35), roll: 0 },
        duration: 3,
        complete: () => {
          if (destroyed) return;
          if (toStreet) {
            // Buildings stay hidden: the page is about to swap engines.
            if (onArrive) onArrive(lat, lon, { demo });
            else window.location.href = streetUrl(lat, lon, { demo });
          } else {
            flightLod(false);
            enterWalk(lat, lon);
          }
        },
        cancel: () => flightLod(false),
      });
    };

    const homeView = () => {
      exitWalk();
      // The opening globe move pulls a full pyramid of imagery/terrain while
      // the camera animates: same tile storm as flyToStreet.
      flightLod(true);
      camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(10, 25, 20000000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
        duration: 2,
        complete: () => flightLod(false),
        cancel: () => flightLod(false),
      });
    };
    homeView();

    // ---- input ----
    const keys = {};
    const clickHandler = new Cesium.ScreenSpaceEventHandler(canvas);
    cleanups.push(() => clickHandler.destroy());
    // Double-click the globe (fly mode) to travel there.
    clickHandler.setInputAction((click) => {
      if (w.active) return;
      const cartesian = scene.pickPosition(click.position) || camera.pickEllipsoid(click.position, scene.globe.ellipsoid);
      if (!cartesian) return;
      const c = Cesium.Cartographic.fromCartesian(cartesian);
      flyToStreet(Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude));
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    const listeners = [
      [canvas, "click", () => {
        if (w.active && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
      }],
      [document, "mousemove", (e) => {
        if (!w.active || document.pointerLockElement !== canvas) return;
        walker.look(e.movementX * 0.0022, e.movementY * 0.0022);
      }],
      [document, "pointerlockchange", () => emitStatus()],
      [window, "keydown", (e) => {
        keys[e.code] = true;
        if (e.code === "KeyF" && !e.repeat) (w.active ? exitWalk() : enterWalk());
        if (e.code === "KeyV" && !e.repeat) setThirdPerson(!w.thirdPerson);
      }],
      [window, "keyup", (e) => { keys[e.code] = false; }],
    ];
    for (const [target, type, handler] of listeners) target.addEventListener(type, handler);
    cleanups.push(() => { for (const [target, type, handler] of listeners) target.removeEventListener(type, handler); });

    // ---- quality ----
    let manualQuality = store.getSettings()?.qualityMode === "manual";
    let tier = "medium";
    const applyQualityTier = (quality) => {
      if (!quality) return;
      tier = quality;
      buildings.setTier(quality);
      // Animated ocean is its own globe shader variant per tile type. With it
      // off, zooming toward a city spent ~30% less main-thread time linking
      // shaders on an Intel UHD laptop (2.7-2.9 s vs 3.9-4.2 s), so only the
      // high tier keeps it; the OSM imagery still paints water blue.
      scene.globe.showWaterEffect = hasTerrain && quality === "high";
      const profile = globeQualityProfile(quality);
      viewer.resolutionScale = profile.resolutionScale;
      scene.globe.maximumScreenSpaceError = profile.maximumScreenSpaceError;
      scene.postProcessStages.fxaa.enabled = profile.fxaa;
    };
    // Auto-pick once unless the visitor locked a preset.
    applyQualityTier(manualQuality
      ? store.getSettings()?.quality || "medium"
      : applyAutoQuality(store.getSettings, store.changeSetting));

    // ---- per-frame update ----
    let statusFrames = 0;
    let fpsTime = performance.now();
    let fpsCount = 0;
    const onSecond = (now) => {
      fps = Math.round((fpsCount * 1000) / (now - fpsTime));
      fpsCount = 0;
      fpsTime = now;
      // Leave the resolution alone under a chosen preset or mid-flight.
      if (!manualQuality && !flying) viewer.resolutionScale = nextResolutionScale(fps, viewer.resolutionScale);
      // A street-bound flight hides buildings anyway; don't start loading them then.
      if (!buildings.requested && tier === "high" && !flying && camera.positionCartographic.height < BUILDINGS_LOAD_HEIGHT) {
        buildings.ensure();
      }
    };
    const publishPosition = (lat, lon, heading, height) => {
      if (posRef) posRef.current = { lat: Cesium.Math.toDegrees(lat), lon: Cesium.Math.toDegrees(lon), heading, height };
    };
    const tick = () => {
      const now = performance.now();
      fpsCount++;
      if (now - fpsTime >= 1000) onSecond(now);
      if (w.active) {
        let f = 0;
        let r = 0;
        const touch = touchInputRef.current;
        if (touch) {
          const tm = readTouchMovement(touch);
          f += tm.f;
          r += tm.r;
          if (touch.lookDX) w.heading += touch.lookDX;
          touch.lookDX = 0;
          touch.lookDY = 0;
        }
        if (keys.KeyW || keys.ArrowUp) f += 1;
        if (keys.KeyS || keys.ArrowDown) f -= 1;
        if (keys.KeyD || keys.ArrowRight) r += 1;
        if (keys.KeyA || keys.ArrowLeft) r -= 1;
        const run = !!(keys.ShiftLeft || keys.ShiftRight || touch?.sprint);
        // statusFrames advances below; sample the ground every 10th frame at rest.
        walker.step(now, { f, r, run, sampleGround: (statusFrames + 1) % 10 === 0 });
        if (++statusFrames % 120 === 0) roads.loadAround(w.lat, w.lon);
        publishPosition(w.lat, w.lon, w.heading, w.ground + EYE_HEIGHT);
        if (statusFrames % 15 === 0) emitStatus();
      } else {
        const carto = Cesium.Cartographic.fromCartesian(camera.position);
        const speed = flySpeed(carto ? carto.height : 1000);
        if (keys.KeyW || keys.ArrowUp) camera.moveForward(speed);
        if (keys.KeyS || keys.ArrowDown) camera.moveBackward(speed);
        if (keys.KeyA || keys.ArrowLeft) camera.moveLeft(speed);
        if (keys.KeyD || keys.ArrowRight) camera.moveRight(speed);
        if (keys.Space || keys.KeyQ) camera.moveUp(speed);
        if (keys.ShiftLeft || keys.KeyE) camera.moveDown(speed);
        const cc = Cesium.Cartographic.fromCartesian(camera.position);
        publishPosition(cc.latitude, cc.longitude, camera.heading, cc.height);
        if (++statusFrames % 20 === 0) emitStatus();
      }
      if (w.active || FLY_KEYS.some((code) => keys[code]) || statusFrames % 2 === 0) scene.requestRender();
    };
    scene.preUpdate.addEventListener(tick);
    cleanups.push(() => { if (!viewer.isDestroyed()) scene.preUpdate.removeEventListener(tick); });

    /** @param {{ hour?: number, weather?: number, quality?: string, engine?: string }} [patch] */
    const applySettings = ({ hour, weather, quality, engine } = {}) => {
      if (engine) walkEngine = engine;
      if (hour !== undefined) {
        // The slider is local solar time at the camera (or walker) position.
        const cc = Cesium.Cartographic.fromCartesian(camera.position);
        const lonDeg = Cesium.Math.toDegrees(w.active ? w.lon : cc.longitude);
        viewer.clock.currentTime = Cesium.JulianDate.fromDate(solarHourToDate(hour, lonDeg));
        viewer.clock.shouldAnimate = false;
      }
      if (weather !== undefined) {
        const atmosphere = weatherAtmosphere(weather);
        scene.fog.density = atmosphere.fogDensity;
        if (scene.skyAtmosphere) {
          scene.skyAtmosphere.brightnessShift = atmosphere.skyBrightnessShift;
          scene.skyAtmosphere.saturationShift = atmosphere.skySaturationShift;
        }
        scene.globe.atmosphereBrightnessShift = atmosphere.globeBrightnessShift;
      }
      if (quality) {
        manualQuality = true;
        applyQualityTier(quality);
      }
    };

    const controller = { flyToStreet, homeView, enterWalk, exitWalk, setThirdPerson, applySettings };
    onController?.(controller);
    progress(100, "Ready");
    onReady?.({ hasTiles: !!ionToken, hasBuildings: !!ionToken, hasTerrain });
    emitStatus();
    return controller;
  };

  const ready = boot();
  const dispose = () => {
    destroyed = true;
    for (const cleanup of cleanups.reverse()) cleanup();
  };
  return { ready, dispose };
}
