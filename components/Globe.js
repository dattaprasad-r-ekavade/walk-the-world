"use client";

import { useEffect, useRef } from "react";
import { getCesiumIonToken } from "@/lib/env";
import { loadCesium } from "@/lib/loadCesium";
import { MONUMENTS } from "@/lib/monuments";
import { trackStatusUpdate } from "@/lib/perf";
import { touchInputRef, readTouchMovement } from "@/lib/touch-input";
import { applyAutoQuality } from "@/lib/engine/gpu-tier";
import { useGameStore } from "@/stores/game-store";

// CesiumJS 3D globe — stylized single-player walking game.
//
// World layers (all free / non-commercial friendly):
//  - Carto Voyager raster basemap  → crisp, game-map-style ground with roads
//  - Cesium World Terrain (ion)    → real elevation
//  - Cesium OSM Buildings (ion)    → clean extruded buildings, styled by
//    height palette instead of melted photogrammetry
//
// Modes: fly (globe) / walk (first- or third-person, V toggles the view;
// third person shows an animated character with a chase camera).
const AVATAR_URL =
  "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Models@master/2.0/RiggedFigure/glTF-Binary/RiggedFigure.glb";
const AVATAR_HEADING_OFFSET = Math.PI / 2; // glTF forward-axis correction

export default function Globe({ controllerRef, onReady, onStatus, onProgress, posRef }) {
  const containerRef = useRef(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  useEffect(() => {
    let viewer;
    let handler;
    let destroyed = false;
    const keys = {};
    let onKeyDown, onKeyUp, onMouseMove, onPointerLockChange, onCanvasClick;
    let tickListener;

    (async () => {
      const progress = (pct, stage) => {
        if (!destroyed) onProgress?.({ pct, stage });
      };
      progress(5, "Loading engine…");
      const Cesium = await loadCesium();
      if (destroyed || !containerRef.current) return;
      progress(35, "Creating world…");

      const ionToken = getCesiumIonToken();
      if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

      // Base: bundled Natural Earth II (zero-config fallback, far view).
      const baseLayer = Cesium.ImageryLayer.fromProviderAsync(
        Cesium.TileMapServiceImageryProvider.fromUrl(
          Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII")
        ),
        {}
      );

      viewer = new Cesium.Viewer(containerRef.current, {
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
        contextOptions: {
          webgl: {
            powerPreference: "high-performance", // prefer discrete GPU
            antialias: false,
          },
        },
      });
      const scene = viewer.scene;
      const camera = viewer.camera;
      const canvas = scene.canvas;
      scene.globe.enableLighting = true;
      scene.globe.depthTestAgainstTerrain = true;
      scene.globe.dynamicAtmosphereLighting = true;
      scene.fog.enabled = true;
      scene.fog.density = 0.0004;
      // Performance: trade a little detail for frame rate (60 FPS target).
      scene.fog.screenSpaceErrorFactor = 4; // fog culls more distant tiles
      scene.postProcessStages.fxaa.enabled = true; // cheap AA, smooths jaggies
      scene.globe.maximumScreenSpaceError = 2.5; // terrain LOD (default 2)
      scene.globe.tileCacheSize = 300;
      scene.msaaSamples = 1;
      scene.screenSpaceCameraController.enableCollisionDetection = false; // free flight
      viewer.cesiumWidget.creditContainer.style.display = "none";

      // Game-map ground: OSM standard raster — water is blue, forests green,
      // roads yellow/white, so every surface reads as what it is.
      try {
        const osm = new Cesium.UrlTemplateImageryProvider({
          url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          maximumLevel: 18, // z19 doubles tile count for little gain
          credit: "© OpenStreetMap contributors",
        });
        viewer.imageryLayers.addImageryProvider(osm);
      } catch (e) {
        console.warn("[cesium] OSM basemap unavailable:", e?.message);
      }

      // Real elevation via Cesium World Terrain (free ion community token).
      let hasTerrain = false;
      progress(55, "Streaming terrain…");
      if (ionToken) {
        try {
          viewer.terrainProvider = await Cesium.createWorldTerrainAsync({
            requestWaterMask: true, // animated water on seas/rivers/lakes
            requestVertexNormals: true, // shaded mountains
          });
          scene.globe.showWaterEffect = true;
          hasTerrain = true;
        } catch (e) {
          console.warn("[cesium] world terrain unavailable:", e?.message);
        }
      }

      // Clean extruded buildings: Cesium OSM Buildings, styled by height so
      // the city reads as a designed game world (no melted photogrammetry).
      let osmBuildings = null;
      progress(75, "Raising buildings…");
      if (ionToken) {
        try {
          osmBuildings = await Cesium.createOsmBuildingsAsync({
            maximumScreenSpaceError: 24, // building LOD (default 16)
          });
          osmBuildings.dynamicScreenSpaceError = true;
          osmBuildings.dynamicScreenSpaceErrorDensity = 0.002;
          // Facade "mask": NOTE — Cesium cannot combine Cesium3DTileStyle
          // with a CustomShader (the style silently wins), so ALL coloring
          // happens here: per-block palette tint + per-floor window grid on
          // walls, clean roofs. Verified visually at street level.
          try {
            osmBuildings.customShader = new Cesium.CustomShader({
              mode: Cesium.CustomShaderMode.MODIFY_MATERIAL,
              lightingModel: Cesium.LightingModel.PBR,
              fragmentShaderText: `
                void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
                  vec3 pos = fsInput.attributes.positionMC;
                  // OSM Buildings tiles are ENU-oriented: model +Z is up.
                  vec3 upEC = normalize((czm_modelView * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
                  vec3 nEC = normalize(fsInput.attributes.normalEC);
                  float wallness = 1.0 - smoothstep(0.55, 0.8, abs(dot(nEC, upEC)));

                  // per-block tint so neighbouring buildings differ
                  vec2 cell = floor(pos.xy / 34.0);
                  float h1 = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
                  float h2 = fract(sin(dot(cell, vec2(269.5, 183.3))) * 28001.8384);
                  vec3 base = vec3(0.88, 0.85, 0.79);
                  base = mix(base, vec3(0.70, 0.77, 0.86), step(0.62, h1));
                  base = mix(base, vec3(0.83, 0.76, 0.66), step(0.55, h2) * step(h1, 0.62));
                  base = mix(base, vec3(0.76, 0.72, 0.78), step(0.85, h1));

                  // window grid: floors every ~3.1 m, columns every ~3.4 m
                  float floorBand = fract(pos.z / 3.1);
                  float rowWin = step(0.3, floorBand) * step(floorBand, 0.78);
                  float colBand = fract((pos.x + pos.y) / 3.4);
                  float colWin = step(0.22, colBand) * step(colBand, 0.75);
                  float window = rowWin * colWin * wallness;

                  vec3 glass = vec3(0.16, 0.22, 0.31) + h2 * 0.08;
                  material.diffuse = mix(base, glass, window * 0.92);
                  material.specular = mix(vec3(0.02), vec3(0.45), window);
                  material.roughness = mix(0.9, 0.2, window);
                  material.diffuse *= mix(0.86, 1.0, wallness);
                }
              `,
            });
          } catch (e) {
            console.warn("[cesium] facade shader unavailable:", e?.message);
          }
          scene.primitives.add(osmBuildings);
        } catch (e) {
          console.warn("[cesium] OSM Buildings unavailable:", e?.message);
        }
      }

      // ---- Painted roads: fetch OSM highways around the walker and draw
      // ground-clamped corridors colored + sized by road class. ----
      const ROAD_STYLE = {
        motorway: ["#4a5568", 18], trunk: ["#4a5568", 16],
        primary: ["#5a6474", 14], secondary: ["#616b7a", 11],
        tertiary: ["#6a7382", 9], residential: ["#788190", 7],
        unclassified: ["#788190", 6], service: ["#8a92a0", 4],
        pedestrian: ["#9a8f7a", 5], footway: ["#a89878", 2.5],
        path: ["#a89878", 2], cycleway: ["#7a8fa8", 2.5],
        living_street: ["#8a92a0", 6], track: ["#9a8a6a", 3],
      };
      let roadEntities = [];
      let roadFetch = { lat: null, lon: null, busy: false };
      const loadRoadsAround = async (latRad, lonRad) => {
        const latDeg = Cesium.Math.toDegrees(latRad);
        const lonDeg = Cesium.Math.toDegrees(lonRad);
        if (roadFetch.busy) return;
        if (
          roadFetch.lat !== null &&
          Math.hypot(latDeg - roadFetch.lat, lonDeg - roadFetch.lon) < 0.0025
        )
          return; // still within the loaded area (~250 m)
        roadFetch = { lat: latDeg, lon: lonDeg, busy: true };
        try {
          const q = `[out:json][timeout:15];way(around:450,${latDeg.toFixed(5)},${lonDeg.toFixed(5)})[highway];out geom 400;`;
          const res = await fetch("https://overpass-api.de/api/interpreter", {
            method: "POST",
            body: "data=" + encodeURIComponent(q),
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          });
          const data = await res.json();
          if (destroyed) return;
          for (const e of roadEntities) viewer.entities.remove(e);
          roadEntities = [];
          for (const way of data.elements || []) {
            if (!way.geometry || way.geometry.length < 2) continue;
            const style = ROAD_STYLE[way.tags?.highway];
            if (!style) continue;
            const coords = [];
            for (const g of way.geometry) coords.push(g.lon, g.lat);
            roadEntities.push(
              viewer.entities.add({
                corridor: {
                  positions: Cesium.Cartesian3.fromDegreesArray(coords),
                  width: style[1],
                  material: Cesium.Color.fromCssColorString(style[0]).withAlpha(0.85),
                  classificationType: Cesium.ClassificationType.TERRAIN,
                },
              })
            );
          }
        } catch (e) {
          console.warn("[roads] overpass fetch failed:", e?.message);
        } finally {
          roadFetch.busy = false;
        }
      };

      // Monument markers: gold label pinned above each famous building.
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
      progress(95, "Final touches…");

      const fpsRef = { value: 0 };
      // ================= Walk-mode state =================
      const R = 6378137; // Earth radius (m)
      const EYE_HEIGHT = 1.8;
      const WALK_SPEED = 5; // m/s
      const RUN_MULT = 6;
      const CHASE_BACK = 7.5; // third-person camera offset (m)
      const CHASE_UP = 3.2;
      const walker = {
        active: false,
        thirdPerson: false,
        lon: 0,
        lat: 0,
        heading: 0,
        pitch: 0,
        ground: 0,
        moving: false,
        lastTime: undefined,
      };

      // Animated avatar shown in third person.
      const avatar = viewer.entities.add({
        show: false,
        position: new Cesium.CallbackProperty(
          () =>
            Cesium.Cartesian3.fromRadians(walker.lon, walker.lat, walker.ground),
          false
        ),
        orientation: new Cesium.CallbackProperty(() => {
          const pos = Cesium.Cartesian3.fromRadians(
            walker.lon,
            walker.lat,
            walker.ground
          );
          return Cesium.Transforms.headingPitchRollQuaternion(
            pos,
            new Cesium.HeadingPitchRoll(
              walker.heading + AVATAR_HEADING_OFFSET,
              0,
              0
            )
          );
        }, false),
        model: {
          uri: AVATAR_URL,
          scale: 1.1,
          minimumPixelSize: 0,
          runAnimations: true,
          color: Cesium.Color.fromCssColorString("#cdd8e8"), // clean matte tint
          colorBlendMode: Cesium.ColorBlendMode.MIX,
          colorBlendAmount: 0.6,
        },
      });

      const emitStatus = (extra = {}) => {
        let lat, lon, height, heading;
        if (walker.active) {
          lat = walker.lat;
          lon = walker.lon;
          height = walker.ground + EYE_HEIGHT;
          heading = walker.heading;
        } else {
          const cc = Cesium.Cartographic.fromCartesian(camera.position);
          lat = cc.latitude;
          lon = cc.longitude;
          height = cc.height;
          heading = camera.heading;
        }
        trackStatusUpdate();
        statusRef.current?.({
          fps: fpsRef.value,
          mode: walker.active ? "walk" : "fly",
          view: walker.thirdPerson ? "third" : "first",
          elevation: walker.active ? Math.round(walker.ground) : null,
          locked: document.pointerLockElement === canvas,
          lat: Cesium.Math.toDegrees(lat),
          lon: Cesium.Math.toDegrees(lon),
          height,
          heading,
          ...extra,
        });
      };

      // Ground sampling with sanity bounds (Dead Sea .. Everest). Buildings
      // and the avatar are excluded so the walker stays on the streets.
      const saneHeight = (h) =>
        h !== undefined && h !== null && isFinite(h) && h > -450 && h < 8900
          ? h
          : undefined;
      const scratchCarto = new Cesium.Cartographic();
      const groundHeightAt = (lon, lat) => {
        scratchCarto.longitude = lon;
        scratchCarto.latitude = lat;
        scratchCarto.height = 0;
        let h;
        if (scene.sampleHeightSupported) {
          try {
            const exclude = [avatar];
            if (osmBuildings) exclude.push(osmBuildings);
            h = saneHeight(scene.sampleHeight(scratchCarto, exclude));
          } catch {
            /* not ready */
          }
        }
        if (h === undefined) {
          h = saneHeight(scene.globe.getHeight(scratchCarto));
        }
        return h;
      };

      // Height including buildings (only the avatar excluded) — used for
      // collision and spawn checks.
      const structureHeightAt = (lon, lat) => {
        scratchCarto.longitude = lon;
        scratchCarto.latitude = lat;
        scratchCarto.height = 0;
        if (!scene.sampleHeightSupported) return undefined;
        try {
          return saneHeight(scene.sampleHeight(scratchCarto, [avatar]));
        } catch {
          return undefined;
        }
      };

      // True if the spot is open ground (no building more than ~2 m above
      // the terrain there).
      const isOpenGround = (lon, lat) => {
        const structure = structureHeightAt(lon, lat);
        if (structure === undefined) return true;
        scratchCarto.longitude = lon;
        scratchCarto.latitude = lat;
        scratchCarto.height = 0;
        const terrain = saneHeight(scene.globe.getHeight(scratchCarto));
        if (terrain === undefined) return true;
        return structure - terrain < 2.0;
      };

      // Spiral outward to find the nearest building-free spot (roads/open
      // space) so we never spawn on a rooftop.
      const findOpenGround = (lon, lat) => {
        if (isOpenGround(lon, lat)) return { lon, lat };
        for (const r of [15, 30, 50, 80, 120]) {
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const la = lat + (Math.cos(a) * r) / R;
            const lo = lon + (Math.sin(a) * r) / (R * Math.cos(lat));
            if (isOpenGround(lo, la)) return { lon: lo, lat: la };
          }
        }
        return { lon, lat };
      };

      const preciseGroundHeight = async (lonDeg, latDeg) => {
        if (!hasTerrain) return 0;
        try {
          const [c] = await Cesium.sampleTerrainMostDetailed(
            viewer.terrainProvider,
            [Cesium.Cartographic.fromDegrees(lonDeg, latDeg)]
          );
          return saneHeight(c?.height) ?? 0;
        } catch {
          return 0;
        }
      };

      const applyWalkerCamera = () => {
        if (walker.thirdPerson) {
          const backLat = walker.lat - (Math.cos(walker.heading) * CHASE_BACK) / R;
          const backLon =
            walker.lon -
            (Math.sin(walker.heading) * CHASE_BACK) /
              (R * Math.cos(walker.lat));
          camera.setView({
            destination: Cesium.Cartesian3.fromRadians(
              backLon,
              backLat,
              walker.ground + CHASE_UP
            ),
            orientation: {
              heading: walker.heading,
              pitch: Cesium.Math.toRadians(-14) + walker.pitch * 0.4,
              roll: 0,
            },
          });
        } else {
          camera.setView({
            destination: Cesium.Cartesian3.fromRadians(
              walker.lon,
              walker.lat,
              walker.ground + EYE_HEIGHT
            ),
            orientation: {
              heading: walker.heading,
              pitch: walker.pitch,
              roll: 0,
            },
          });
        }
      };

      const setThirdPerson = (on) => {
        walker.thirdPerson = on;
        avatar.show = on && walker.active;
        if (walker.active) applyWalkerCamera();
        emitStatus();
      };

      const enterWalk = async (latDeg, lonDeg) => {
        let lon, lat;
        if (latDeg !== undefined) {
          lon = Cesium.Math.toRadians(lonDeg);
          lat = Cesium.Math.toRadians(latDeg);
        } else {
          const c = Cesium.Cartographic.fromCartesian(camera.position);
          lon = c.longitude;
          lat = c.latitude;
        }
        const open = findOpenGround(lon, lat);
        lon = open.lon;
        lat = open.lat;
        const g =
          groundHeightAt(lon, lat) ??
          (await preciseGroundHeight(
            Cesium.Math.toDegrees(lon),
            Cesium.Math.toDegrees(lat)
          ));
        walker.lon = lon;
        walker.lat = lat;
        loadRoadsAround(lat, lon);
        walker.ground = g ?? 0;
        walker.heading = camera.heading;
        walker.pitch = 0;
        walker.active = true;
        walker.lastTime = undefined;
        avatar.show = walker.thirdPerson;
        scene.screenSpaceCameraController.enableInputs = false;
        applyWalkerCamera();
        canvas.requestPointerLock?.();
        emitStatus();
      };

      const exitWalk = () => {
        const wasWalking = walker.active;
        walker.active = false;
        avatar.show = false;
        scene.screenSpaceCameraController.enableInputs = true;
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        if (wasWalking) {
          // rise to a vantage where orbit/zoom controls feel natural
          camera.flyTo({
            destination: Cesium.Cartesian3.fromRadians(
              walker.lon,
              walker.lat,
              walker.ground + 350
            ),
            orientation: {
              heading: walker.heading,
              pitch: Cesium.Math.toRadians(-40),
              roll: 0,
            },
            duration: 1.2,
          });
        }
        emitStatus();
      };

      // Walk engine: "street" hands off to the 7×-faster Three.js engine
      // after the cinematic fly-down; "classic" walks inside Cesium.
      let walkEngine = "street";
      const flyToStreet = async (lat, lon) => {
        exitWalk();
        const ground = await preciseGroundHeight(lon, lat);
        if (destroyed) return;
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, ground + 260),
          orientation: {
            heading: Cesium.Math.toRadians(20),
            pitch: Cesium.Math.toRadians(-35),
            roll: 0,
          },
          duration: 3,
          complete: () => {
            if (destroyed) return;
            if (walkEngine === "street") {
              window.location.href = `/street?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`;
            } else {
              enterWalk(lat, lon);
            }
          },
        });
      };

      const homeView = () => {
        exitWalk();
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(10, 25, 20000000),
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-90),
            roll: 0,
          },
          duration: 2,
        });
      };
      homeView();

      // Click the globe (fly mode) to travel there.
      handler = new Cesium.ScreenSpaceEventHandler(canvas);
      handler.setInputAction((click) => {
        if (walker.active) return;
        const cartesian =
          scene.pickPosition(click.position) ||
          camera.pickEllipsoid(click.position, scene.globe.ellipsoid);
        if (!cartesian) return;
        const c = Cesium.Cartographic.fromCartesian(cartesian);
        flyToStreet(
          Cesium.Math.toDegrees(c.latitude),
          Cesium.Math.toDegrees(c.longitude)
        );
      }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

      // Pointer-lock mouse look.
      onCanvasClick = () => {
        if (walker.active && document.pointerLockElement !== canvas) {
          canvas.requestPointerLock?.();
        }
      };
      canvas.addEventListener("click", onCanvasClick);

      onMouseMove = (e) => {
        if (!walker.active || document.pointerLockElement !== canvas) return;
        const SENS = 0.0022;
        walker.heading = Cesium.Math.zeroToTwoPi(
          walker.heading + e.movementX * SENS
        );
        walker.pitch = Cesium.Math.clamp(
          walker.pitch - e.movementY * SENS,
          Cesium.Math.toRadians(-85),
          Cesium.Math.toRadians(85)
        );
      };
      document.addEventListener("mousemove", onMouseMove);

      onPointerLockChange = () => emitStatus();
      document.addEventListener("pointerlockchange", onPointerLockChange);

      onKeyDown = (e) => {
        keys[e.code] = true;
        if (e.code === "KeyF" && !e.repeat) {
          walker.active ? exitWalk() : enterWalk();
        }
        if (e.code === "KeyV" && !e.repeat) {
          setThirdPerson(!walker.thirdPerson);
        }
      };
      onKeyUp = (e) => {
        keys[e.code] = false;
      };
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);

      // Per-frame update.
      let statusFrames = 0;
      let fpsTime = performance.now();
      let fpsCount = 0;
      let fps = 0;
      tickListener = () => {
        const now = performance.now();
        fpsCount++;
        if (now - fpsTime >= 1000) {
          fps = Math.round((fpsCount * 1000) / (now - fpsTime));
          fpsRef.value = fps;
          fpsCount = 0;
          fpsTime = now;
          // Adaptive resolution: drop render scale when struggling, restore
          // when there is headroom — keeps interaction near 60 FPS.
          if (manualQuality) {
            /* user picked a quality preset — don't fight it */
          } else if (fps > 0 && fps < 40 && viewer.resolutionScale > 0.7) {
            viewer.resolutionScale = Math.max(0.7, viewer.resolutionScale - 0.1);
          } else if (fps > 55 && viewer.resolutionScale < 1.0) {
            viewer.resolutionScale = Math.min(1.0, viewer.resolutionScale + 0.05);
          }
        }
        if (walker.active) {
          const dt = walker.lastTime
            ? Math.min((now - walker.lastTime) / 1000, 0.1)
            : 0;
          walker.lastTime = now;

          let f = 0;
          let r = 0;
          const touch = touchInputRef.current;
          if (touch) {
            const tm = readTouchMovement(touch);
            f += tm.f;
            r += tm.r;
            if (touch.lookDX) walker.heading += touch.lookDX;
            touch.lookDX = 0;
            touch.lookDY = 0;
          }
          if (keys.KeyW || keys.ArrowUp) f += 1;
          if (keys.KeyS || keys.ArrowDown) f -= 1;
          if (keys.KeyD || keys.ArrowRight) r += 1;
          if (keys.KeyA || keys.ArrowLeft) r -= 1;
          walker.moving = !!(f || r);
          if (walker.moving) {
            const run =
              keys.ShiftLeft || keys.ShiftRight || touch?.sprint ? RUN_MULT : 1;
            const d = WALK_SPEED * run * dt;
            const sin = Math.sin(walker.heading);
            const cos = Math.cos(walker.heading);
            const east = (f * sin + r * cos) * d;
            const north = (f * cos - r * sin) * d;
            const STEP = 1.4; // max climbable step (m); walls block, curbs don't
            const nLat = walker.lat + north / R;
            const nLon = walker.lon + east / (R * Math.cos(walker.lat));
            // one pick per frame on the destination; extra slide picks only
            // when actually blocked — smooth AND cheap
            const canStand = (lo, la) => {
              const h = structureHeightAt(lo, la);
              return h === undefined || h - walker.ground < STEP;
            };
            if (canStand(nLon, nLat)) {
              walker.lat = nLat;
              walker.lon = nLon;
            } else if (canStand(walker.lon, nLat)) {
              walker.lat = nLat; // slide along east-west wall
            } else if (canStand(nLon, walker.lat)) {
              walker.lon = nLon; // slide along north-south wall
            }
          }

          if (++statusFrames % 120 === 0) loadRoadsAround(walker.lat, walker.lon);
          const g = walker.moving || statusFrames % 10 === 0
            ? groundHeightAt(walker.lon, walker.lat)
            : undefined; // standing still: ground can't change under you
          if (g !== undefined) {
            walker.ground = Cesium.Math.lerp(
              walker.ground,
              g,
              dt ? Math.min(1, dt * 8) : 1
            );
          }
          applyWalkerCamera();

          if (posRef) {
            posRef.current = {
              lat: Cesium.Math.toDegrees(walker.lat),
              lon: Cesium.Math.toDegrees(walker.lon),
              heading: walker.heading,
              height: walker.ground + EYE_HEIGHT,
            };
          }
          if (statusFrames % 15 === 0) emitStatus();
        } else {
          const carto = Cesium.Cartographic.fromCartesian(camera.position);
          const height = carto ? carto.height : 1000;
          const speed = Math.max(1.5, Math.min(height * 0.04, 50000));
          if (keys.KeyW || keys.ArrowUp) camera.moveForward(speed);
          if (keys.KeyS || keys.ArrowDown) camera.moveBackward(speed);
          if (keys.KeyA || keys.ArrowLeft) camera.moveLeft(speed);
          if (keys.KeyD || keys.ArrowRight) camera.moveRight(speed);
          if (keys.Space || keys.KeyQ) camera.moveUp(speed);
          if (keys.ShiftLeft || keys.KeyE) camera.moveDown(speed);
          if (posRef) {
            const cc = Cesium.Cartographic.fromCartesian(camera.position);
            posRef.current = {
              lat: Cesium.Math.toDegrees(cc.latitude),
              lon: Cesium.Math.toDegrees(cc.longitude),
              heading: camera.heading,
              height: cc.height,
            };
          }
          if (++statusFrames % 20 === 0) emitStatus();
        }
        const anyKey = keys.KeyW || keys.KeyS || keys.KeyA || keys.KeyD ||
          keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight ||
          keys.Space || keys.KeyQ || keys.ShiftLeft || keys.KeyE;
        if (walker.active || anyKey || statusFrames % 2 === 0) {
          scene.requestRender();
        }
      };
      scene.preUpdate.addEventListener(tickListener);

      let facadeShaderRef = osmBuildings ? osmBuildings.customShader : null;
      let manualQuality = useGameStore.getState().settings?.qualityMode === "manual";
      const applyQualityTier = (quality) => {
        if (!quality) return;
        if (quality === "low") {
          viewer.resolutionScale = 0.65;
          scene.globe.maximumScreenSpaceError = 3.5;
          scene.postProcessStages.fxaa.enabled = false;
          if (osmBuildings) {
            osmBuildings.maximumScreenSpaceError = 44;
            osmBuildings.customShader = undefined;
          }
        } else if (quality === "medium") {
          viewer.resolutionScale = 0.85;
          scene.globe.maximumScreenSpaceError = 2.5;
          scene.postProcessStages.fxaa.enabled = false;
          if (osmBuildings) {
            osmBuildings.maximumScreenSpaceError = 28;
            osmBuildings.customShader = facadeShaderRef;
          }
        } else {
          viewer.resolutionScale = 1.0;
          scene.globe.maximumScreenSpaceError = 2.0;
          scene.postProcessStages.fxaa.enabled = true;
          if (osmBuildings) {
            osmBuildings.maximumScreenSpaceError = 20;
            osmBuildings.customShader = facadeShaderRef;
          }
        }
      };
      // 16.3: auto-pick once if user hasn't locked a preset
      if (!manualQuality) {
        const q = applyAutoQuality(
          () => useGameStore.getState().settings,
          (patch) => useGameStore.getState().changeSetting(patch)
        );
        applyQualityTier(q);
      } else {
        applyQualityTier(useGameStore.getState().settings?.quality || "medium");
      }
      const applySettings = ({ hour, weather, quality, engine } = {}) => {
        if (engine) walkEngine = engine;
        if (hour !== undefined) {
          // interpret the slider as LOCAL solar time at the camera position
          const cc = Cesium.Cartographic.fromCartesian(camera.position);
          const lonDeg = Cesium.Math.toDegrees(
            walker.active ? walker.lon : cc.longitude
          );
          const utcHour = hour - lonDeg / 15;
          const now = new Date();
          const d = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
          );
          d.setTime(d.getTime() + utcHour * 3600 * 1000);
          viewer.clock.currentTime = Cesium.JulianDate.fromDate(d);
          viewer.clock.shouldAnimate = false;
        }
        if (weather !== undefined) {
          const w = weather / 100; // 0 clear .. 1 heavy overcast/fog
          scene.fog.density = 0.0002 + w * w * 0.0038;
          if (scene.skyAtmosphere) {
            scene.skyAtmosphere.brightnessShift = -0.5 * w;
            scene.skyAtmosphere.saturationShift = -0.55 * w;
          }
          scene.globe.atmosphereBrightnessShift = -0.35 * w;
        }
        if (quality) {
          manualQuality = true;
          applyQualityTier(quality);
        }
      };

      if (controllerRef) {
        controllerRef.current = {
          flyToStreet,
          homeView,
          enterWalk,
          exitWalk,
          setThirdPerson,
          applySettings,
        };
      }
      progress(100, "Ready");
      if (onReady)
        onReady({ hasTiles: !!osmBuildings, hasBuildings: !!osmBuildings, hasTerrain });
      emitStatus();
    })();

    return () => {
      destroyed = true;
      if (onKeyDown) window.removeEventListener("keydown", onKeyDown);
      if (onKeyUp) window.removeEventListener("keyup", onKeyUp);
      if (onMouseMove) document.removeEventListener("mousemove", onMouseMove);
      if (onPointerLockChange)
        document.removeEventListener("pointerlockchange", onPointerLockChange);
      if (handler) handler.destroy();
      if (viewer && !viewer.isDestroyed()) {
        if (tickListener) viewer.scene.preUpdate.removeEventListener(tickListener);
        if (onCanvasClick)
          viewer.scene.canvas.removeEventListener("click", onCanvasClick);
        viewer.destroy();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="cesium-container" />;
}
