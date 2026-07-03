"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { LoadingScreen } from "@/components/hud/Panels";
import { BUILDING_COLORS, ROAD_STYLE } from "@/lib/engine/styles";
import { makeFacadeTexture, makeRoadTexture, makeRailTexture } from "@/lib/engine/textures";
import { lon2tx, lat2ty, tx2lon, ty2lat, EARTH_R, makeLocalFrame } from "@/lib/engine/geo";
import { placeProps } from "@/lib/engine/props";
import { fetchCityData } from "@/lib/engine/cityData";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { trackRender, recordFpsSample } from "@/lib/perf";
import { STREET } from "@/lib/engine/street/constants";
import { createCollision } from "@/lib/engine/street/collision";
import { createGroundHeight } from "@/lib/engine/street/ground-height";
import { createHudRef } from "@/lib/engine/street/hud-ref";
import { GameShell } from "@/components/game-shell/GameShell";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/stores/game-store";
import { useGameKeyboard } from "@/hooks/use-game-keyboard";
import { touchInputRef, readTouchMovement, applyTouchLook } from "@/lib/touch-input";
import { menuBtnPrimary } from "@/lib/ui";

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

  const mountRef = useRef(null);
  const [stage, setStage] = useState("Preparing engine…");
  const [readyPct, setReadyPct] = useState(5);
  const [hudLocked, setHudLocked] = useState(false);
  const [place, setPlace] = useState(null);
  const [bigMap, setBigMap] = useState(false);
  const [liveWx, setLiveWx] = useState(null);

  const useRealWeather = async () => {
    setLiveWx("loading");
    const r = await engineRef.current.applyRealWeather?.();
    if (r) {
      changeSettingStore({ hour: r.hour, weather: r.weather });
      setLiveWx(`${r.temp}°C · ${r.rain > 0.05 ? "raining" : "dry"} — synced`);
    } else setLiveWx("unavailable");
  };
  const posRef = useRef(null);
  const engineRef = useRef({});

  const changeSetting = (patch) => {
    changeSettingStore(patch);
    if (patch.hour !== undefined) engineRef.current.setTime?.(patch.hour);
    if (patch.weather !== undefined) {
      engineRef.current.setWeather?.(patch.weather);
      engineRef.current.setPrecip?.(patch.weather >= 85 ? "rain" : null);
    }
    if (patch.quality) engineRef.current.setQuality?.(patch.quality);
  };

  useGameKeyboard(
    (e) => {
      if (e.code === "KeyM") togglePanel("travel");
      if (e.code === "KeyP") togglePanel("pause");
      if (e.code === "Tab") {
        e.preventDefault();
        setBigMap((b) => !b);
      }
      if (e.code === "KeyN" && place) setPlace((pl) => pl && String(pl));
    },
    [place, togglePanel]
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

    // ---- local ENU conversion (lib/engine/geo) ----
    const { toLocal, toGeo } = makeLocalFrame(lat0, lon0);

    // ---- three basics ----
    const renderer = new THREE.WebGLRenderer({
      antialias: true, // MSAA — the merged low-poly scene can afford it
      powerPreference: "high-performance",
    });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9cc4e8);
    scene.fog = new THREE.Fog(0x9cc4e8, 400, 2600);
    const camera = new THREE.PerspectiveCamera(
      70, mount.clientWidth / mount.clientHeight, 0.1, 6000
    );
    camera.rotation.order = "YXZ";

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

    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x8c8474, 1.0);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(300, 500, -200);
    scene.add(sun);

    // ---- settings hooks (time of day / weather / quality) ----
    const daySky = new THREE.Color(0x9cc4e8);
    const duskSky = new THREE.Color(0xd8926a);
    const nightSky = new THREE.Color(0x0c1428);
    let weatherAmt = 0;
    const applySky = (hour) => {
      // sun elevation from local solar hour
      const t = ((hour - 6) / 12) * Math.PI; // 6h→sunrise, 18h→sunset
      const elev = Math.sin(t);
      sun.position.set(Math.cos(t) * 500, Math.max(elev, -0.2) * 500, -200);
      sun.intensity = Math.max(0, elev) * 1.6 + 0.05;
      hemi.intensity = 0.25 + Math.max(0, elev) * 0.85;
      const sky = new THREE.Color();
      if (elev > 0.25) sky.copy(daySky);
      else if (elev > -0.05) sky.lerpColors(duskSky, daySky, (elev + 0.05) / 0.3);
      else sky.copy(nightSky);
      sky.lerp(new THREE.Color(0x8a8f96), weatherAmt * 0.7); // overcast grey
      scene.background = sky;
      scene.fog.color.copy(sky);
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
      scene.fog.near = 400 - weatherAmt * 330;
      scene.fog.far = 2600 - weatherAmt * 2100;
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
      renderer.setPixelRatio(
        q === "low" ? 0.75 : q === "medium" ? Math.min(window.devicePixelRatio, 1.25) : Math.min(window.devicePixelRatio, 2)
      );
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };

    // ---- state ----
    const player = { x: 0, z: 0, heading: 0, pitch: 0, third: false, moving: false };
    const keys = {};
    const terrainTiles = new Map();
    const tileCanvases = [];
    const { addFootprint, insideBuilding } = createCollision(GRID);
    let groundHeight = () => 0;
    const spinners = [];
    const lampGlows = [];
    let avatar = null;
    let running = true;
    let hudDom = null;
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
        terrainTiles.set(`${tx}/${ty}`, { heights, n: N, x0: tl.x, z0: tl.z, sizeX, sizeZ });

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

        // OSM texture (2x2 z15 subtiles upscaled onto a 1024 canvas so roads
        // painted later stay reasonably crisp)
        const W = isCenter ? 2048 : 1024; // sharp where the player walks
        const half = W / 2;
        const tex = document.createElement("canvas");
        tex.width = tex.height = W;
        const tg = tex.getContext("2d");
        tg.fillStyle = "#b5c9a3"; tg.fillRect(0, 0, W, W);
        const subs = [];
        for (let sy = 0; sy < 2; sy++)
          for (let sx = 0; sx < 2; sx++)
            subs.push(
              loadImage(`https://tile.openstreetmap.org/${Z + 1}/${tx * 2 + sx}/${ty * 2 + sy}.png`)
                .then((im) => tg.drawImage(im, sx * half, sy * half, half, half))
                .catch(() => {})
            );
        const texture = new THREE.CanvasTexture(tex);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = isCenter ? 4 : 1;
        if (isCenter) {
          await Promise.all(subs);
        } else {
          Promise.all(subs).then(() => {
            texture.needsUpdate = true;
          });
        }
        tileCanvases.push({ g: tg, texture, x0: tl.x, z0: tl.z, sizeX, sizeZ, w: W });
        const terrMat = new THREE.MeshLambertMaterial({ map: texture });
        const mesh = new THREE.Mesh(geo, terrMat);
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
      }
    };

    // ---- buildings + roads from Overpass ----
    const loadCity = async (data) => {
      if (!data?.elements?.length) return;
      setStage(`Building city (${data.elements.length} features)…`);
      setReadyPct((p) => Math.max(p, 60));
      try {
        if (disposed) return;
        const byColor = new Map();
        const roadByColor = new Map();
        const roadPoints = [];
        const roadPaths = []; // {pts, color, width} for terrain-texture painting
        const bridges = []; // {pts, width, isRail}
        const rails = []; // {pts}
        const stations = []; // {x, z, name}
        const props = []; // {kind, x, z, tags}
        const barrierWays = []; // {pts, kind}
        const powerLines = []; // {pts}
        const treeSpots = [];
        const flatPolys = []; // {ring, color, lift}
        let featureIdx = 0;
        const total = data.elements.length;

        for (const way of data.elements || []) {
          featureIdx++;
          if (featureIdx % 120 === 0) {
            setStage(`Building city (${featureIdx}/${total})…`);
            await new Promise((r) => requestAnimationFrame(r));
            if (disposed) return;
          }
          if (way.type === "node" && way.tags?.natural === "tree") {
            const pt = toLocal(way.lat, way.lon);
            treeSpots.push(pt);
            continue;
          }
          if (way.type === "node" && way.tags?.railway === "station") {
            const pt = toLocal(way.lat, way.lon);
            stations.push({ x: pt.x, z: pt.z, name: way.tags.name || "Station" });
            continue;
          }
          if (way.type === "node" && way.tags) {
            const T = way.tags;
            const kind =
              T.highway === "street_lamp" ? "lamp" :
              T.highway === "traffic_signals" ? "signals" :
              T.highway === "bus_stop" ? "bus_stop" :
              T.amenity === "bench" ? "bench" :
              T.amenity === "fountain" ? "fountain" :
              T.amenity === "waste_basket" ? "bin" :
              T.amenity === "telephone" ? "phone" :
              T.advertising === "billboard" ? "billboard" :
              T.man_made === "flagpole" ? "flagpole" :
              T.man_made === "tower" ? "comm_tower" :
              T.man_made === "chimney" ? "chimney" :
              T.man_made === "water_tower" ? "water_tower" :
              T.man_made === "windmill" ? "windmill" :
              T.man_made === "lighthouse" ? "lighthouse" :
              T.man_made === "silo" || T.man_made === "storage_tank" ? "silo" :
              T.man_made === "crane" ? "crane" :
              T.man_made === "obelisk" ? "obelisk" :
              T.barrier === "bollard" ? "bollard" :
              T.barrier === "gate" ? "gate" :
              T.railway === "subway_entrance" ? "subway" :
              T.railway === "level_crossing" ? null :
              T.natural === "peak" ? "peak" :
              T.historic === "monument" || T.historic === "memorial" ? "memorial" :
              T["generator:source"] === "wind" ? "turbine" :
              T.power === "tower" ? "pylon" : null;
            if (kind) {
              const pt = toLocal(way.lat, way.lon);
              props.push({ kind, x: pt.x, z: pt.z, tags: T });
            }
            continue;
          }
          if (way.geometry && way.tags?.barrier && /^(wall|fence|hedge|city_wall)$/.test(way.tags.barrier)) {
            barrierWays.push({
              pts: way.geometry.map((g) => toLocal(g.lat, g.lon)),
              kind: way.tags.barrier,
            });
            continue;
          }
          if (way.geometry && way.tags?.natural === "tree_row") {
            // instanced trees every ~7 m along the line
            const g0 = way.geometry;
            for (let i = 0; i < g0.length - 1; i++) {
              const a = toLocal(g0[i].lat, g0[i].lon);
              const b = toLocal(g0[i + 1].lat, g0[i + 1].lon);
              const d = Math.hypot(b.x - a.x, b.z - a.z);
              for (let t = 0; t < d; t += 7)
                treeSpots.push({ x: a.x + ((b.x - a.x) * t) / d, z: a.z + ((b.z - a.z) * t) / d });
            }
            continue;
          }
          if (way.geometry && way.tags?.power === "line") {
            powerLines.push({ pts: way.geometry.map((g) => toLocal(g.lat, g.lon)) });
            continue;
          }
          if (way.geometry && way.tags?.railway && /^(rail|light_rail|tram)$/.test(way.tags.railway)) {
            const pts = way.geometry.map((g) => {
              const q2 = toLocal(g.lat, g.lon);
              return new THREE.Vector2(q2.x, q2.z);
            });
            if (way.tags.bridge) bridges.push({ pts, width: 5, isRail: true });
            else rails.push({ pts });
            continue;
          }
          if (!way.geometry || way.geometry.length < 2) continue;

          if (
            way.tags?.natural === "water" ||
            way.tags?.waterway === "riverbank"
          ) {
            flatPolys.push({ way, color: 0x6fa8d8, lift: 0.06 });
            continue;
          }
          if (way.tags?.natural === "beach" || way.tags?.natural === "sand") {
            flatPolys.push({ way, color: 0xe6d5a3, lift: 0.04 });
            continue;
          }
          if (/farmland|orchard|vineyard/.test(way.tags?.landuse || "")) {
            flatPolys.push({ way, color: 0xd3c89e, lift: 0.03 });
            continue;
          }
          if (way.tags?.leisure === "pitch") {
            flatPolys.push({ way, color: 0x4f9e5d, lift: 0.06, pitch: way.tags.sport || "" });
            continue;
          }
          if (way.tags?.leisure === "swimming_pool") {
            flatPolys.push({ way, color: 0x39a0e0, lift: 0.06 });
            continue;
          }
          if (way.tags?.leisure === "playground") {
            flatPolys.push({ way, color: 0xd9b98a, lift: 0.05 });
            continue;
          }
          if (way.tags?.leisure === "track") {
            flatPolys.push({ way, color: 0xb5543f, lift: 0.06 });
            continue;
          }
          if (way.tags?.leisure === "golf_course") {
            flatPolys.push({ way, color: 0x7fb56b, lift: 0.03 });
            continue;
          }
          if (way.tags?.amenity === "parking") {
            flatPolys.push({ way, color: 0x8a9098, lift: 0.05 });
            continue;
          }
          if (
            way.tags?.leisure === "park" ||
            /grass|meadow|forest/.test(way.tags?.landuse || "")
          ) {
            flatPolys.push({ way, color: 0x93bd7f, lift: 0.04 });
            // scatter a few trees in green areas
            const g0 = way.geometry[0];
            for (let i = 0; i < Math.min(6, way.geometry.length); i += 2) {
              const g = way.geometry[i] || g0;
              treeSpots.push(toLocal(g.lat, g.lon));
            }
            continue;
          }

          if (way.tags?.building) {
            const ring = way.geometry.map((g) => {
              const p = toLocal(g.lat, g.lon);
              return [p.x, p.z];
            });
            if (ring.length < 3) continue;
            const h =
              parseFloat(way.tags.height) ||
              (parseInt(way.tags["building:levels"]) || 0) * 3.2 ||
              8 + (way.id % 7);
            let base = Infinity;
            for (const [rx, rz] of ring) base = Math.min(base, groundHeight(rx, rz));
            base -= 1.5; // sink into terrain on slopes
            const shape = new THREE.Shape();
            shape.moveTo(ring[0][0], -ring[0][1]);
            for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i][0], -ring[i][1]);
            let geo;
            try {
              geo = new THREE.ExtrudeGeometry(shape, { depth: h + 4, bevelEnabled: false });
            } catch { continue; }
            geo.rotateX(-Math.PI / 2);
            geo.translate(0, base, 0);
            // extend extrusion down by growing depth instead of floating
            
            const color =
              BUILDING_COLORS[way.tags.building] ||
              (h > 60 ? 0x9fb6d9 : h > 25 ? 0xd4cfc4 : 0xe3ddd2);
            if (!byColor.has(color)) byColor.set(color, []);
            byColor.get(color).push(geo);
            addFootprint(ring);
          } else if (way.tags?.highway && ROAD_STYLE[way.tags.highway]) {
            const [color, width] = ROAD_STYLE[way.tags.highway];
            const raw = way.geometry.map((g) => {
              const p = toLocal(g.lat, g.lon);
              return new THREE.Vector2(p.x, p.z);
            });
            // subdivide long segments so ribbons follow the terrain instead
            // of sinking through rises between road vertices
            const pts = [];
            for (let i = 0; i < raw.length; i++) {
              pts.push(raw[i]);
              if (i < raw.length - 1) {
                const d = raw[i].distanceTo(raw[i + 1]);
                const steps = Math.min(16, Math.floor(d / 10));
                for (let k = 1; k <= steps; k++)
                  pts.push(new THREE.Vector2().lerpVectors(raw[i], raw[i + 1], k / (steps + 1)));
              }
            }
            if (way.tags.bridge) {
              bridges.push({ pts, width: Math.max(width, 6), isRail: false });
            } else {
              roadPaths.push({ pts, color, width });
            }
            const walkable = !["motorway", "trunk"].includes(way.tags.highway);
            if (walkable)
              for (let i = 0; i < pts.length; i++) {
                const nb = pts[i + 1] || pts[i - 1] || pts[i];
                roadPoints.push({ x: pts[i].x, z: pts[i].y, nx: nb.x, nz: nb.y });
              }
          }
        }
        let tris = 0;
        const facadeTex = makeFacadeTexture();
        for (const [color, geos] of byColor) {
          const merged = mergeGeometries(geos, false);
          tris += (merged.index ? merged.index.count : merged.attributes.position.count) / 3;
          scene.add(
            new THREE.Mesh(
              merged,
              new THREE.MeshLambertMaterial({ color, map: facadeTex })
            )
          );
        }
        // ---- DECAL ROADS: terrain-conforming ribbons. Each cross-section
        // edge samples the ground at ITS OWN position (handles cross-slope),
        // rows every ~9 m (follows along-slope), lifted 8 cm with a strong
        // polygon offset — visually glued to the terrain like a decal. ----
        {
          const decalByColor = new Map();
          for (const rp of roadPaths) {
            const pts = [];
            for (let i = 0; i < rp.pts.length; i++) {
              pts.push(rp.pts[i]);
              if (i < rp.pts.length - 1) {
                const d = rp.pts[i].distanceTo(rp.pts[i + 1]);
                const steps = Math.min(24, Math.floor(d / 9));
                for (let k = 1; k <= steps; k++)
                  pts.push(new THREE.Vector2().lerpVectors(rp.pts[i], rp.pts[i + 1], k / (steps + 1)));
              }
            }
            if (pts.length < 2) continue;
            const half = rp.width / 2;
            const v = [];
            const uv = [];
            const idx = [];
            for (let i = 0; i < pts.length; i++) {
              const dir = new THREE.Vector2();
              if (i === 0) dir.subVectors(pts[1], pts[0]);
              else if (i === pts.length - 1) dir.subVectors(pts[i], pts[i - 1]);
              else dir.subVectors(pts[i + 1], pts[i - 1]);
              dir.normalize();
              const nx = -dir.y * half, nz = dir.x * half;
              const lx = pts[i].x + nx, lz = pts[i].y + nz;
              const rx = pts[i].x - nx, rz = pts[i].y - nz;
              const ly = groundHeight(lx, lz) + 0.08;
              const ry = groundHeight(rx, rz) + 0.08;
              v.push(lx, ly, lz, rx, ry, rz);
              uv.push(0, i * 0.12, 1, i * 0.12);
              if (i > 0) {
                const a = (i - 1) * 2;
                idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
              }
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
            geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
            geo.setIndex(idx);
            if (!decalByColor.has(rp.color)) decalByColor.set(rp.color, []);
            decalByColor.get(rp.color).push(geo);
          }
          const roadTexMarked = makeRoadTexture(true);
          const roadTexPlain = makeRoadTexture(false);
          for (const [color, geos] of decalByColor) {
            const merged = mergeGeometries(geos, false);
            merged.computeVertexNormals();
            const mesh = new THREE.Mesh(
              merged,
              new THREE.MeshLambertMaterial({
                color,
                map: color <= 0x646a73 ? roadTexMarked : roadTexPlain,
                polygonOffset: true,
                polygonOffsetFactor: -4,
                polygonOffsetUnits: -4,
                side: THREE.DoubleSide,
              })
            );
            mesh.renderOrder = 1;
            scene.add(mesh);
          }
        }

        // Water + park/grass polygons draped just above the terrain.
        for (const { way, color, lift } of flatPolys) {
          try {
            const ring = way.geometry.map((g) => toLocal(g.lat, g.lon));
            if (ring.length < 3) continue;
            const shape = new THREE.Shape();
            shape.moveTo(ring[0].x, -ring[0].z);
            for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i].x, -ring[i].z);
            const geo = new THREE.ShapeGeometry(shape);
            geo.rotateX(-Math.PI / 2);
            let cy = 0;
            for (const r of ring) cy = Math.max(cy, groundHeight(r.x, r.z));
            geo.translate(0, cy + lift, 0);
            scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color })));
          } catch { /* skip bad ring */ }
        }

        // Low-poly instanced trees (cone canopy + trunk in one geometry).
        if (treeSpots.length) {
          const canopy = new THREE.ConeGeometry(1.6, 3.6, 6);
          canopy.translate(0, 4.2, 0);
          const trunk = new THREE.CylinderGeometry(0.22, 0.28, 2.6, 5);
          trunk.translate(0, 1.3, 0);
          const cCol = new Float32Array(canopy.attributes.position.count * 3).fill(0);
          for (let i = 0; i < cCol.length; i += 3) { cCol[i] = 0.28; cCol[i+1] = 0.52; cCol[i+2] = 0.25; }
          const tCol = new Float32Array(trunk.attributes.position.count * 3);
          for (let i = 0; i < tCol.length; i += 3) { tCol[i] = 0.42; tCol[i+1] = 0.30; tCol[i+2] = 0.20; }
          canopy.setAttribute("color", new THREE.BufferAttribute(cCol, 3));
          trunk.setAttribute("color", new THREE.BufferAttribute(tCol, 3));
          const treeGeo = mergeGeometries([trunk, canopy], false);
          const inst = new THREE.InstancedMesh(
            treeGeo,
            new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
            Math.min(treeSpots.length, 500)
          );
          const m4 = new THREE.Matrix4();
          for (let i = 0; i < inst.count; i++) {
            const t = treeSpots[i];
            const sc = 0.8 + (i % 5) * 0.15;
            m4.makeScale(sc, sc, sc);
            m4.setPosition(t.x, groundHeight(t.x, t.z), t.z);
            inst.setMatrixAt(i, m4);
          }
          scene.add(inst);
        }
        window.__streetTriangles = Math.round(tris);

        // ---- ROAD MASK: paint roads straight into the ground texture so
        // they are perfectly draped over any terrain (no sinking, ever) ----
        const hex = (c) => "#" + c.toString(16).padStart(6, "0");
        const trace = (tc, pts, sx, sz) => {
          tc.g.beginPath();
          let started = false;
          for (const pt of pts) {
            const px = (pt.x - tc.x0) * sx;
            const py = (pt.y - tc.z0) * sz;
            if (!started) { tc.g.moveTo(px, py); started = true; }
            else tc.g.lineTo(px, py);
          }
        };
        for (const tc of tileCanvases) {
          const sx = tc.w / tc.sizeX;
          const sz = tc.w / tc.sizeZ;
          tc.g.lineCap = "round";
          tc.g.lineJoin = "round";
          // pass 1: dark casing (road edges)
          for (const rp of roadPaths) {
            trace(tc, rp.pts, sx, sz);
            tc.g.strokeStyle = "rgba(40,44,50,0.9)";
            tc.g.lineWidth = Math.max(2.5, rp.width * sx * 1.22);
            tc.g.stroke();
          }
          // pass 2: asphalt fill
          for (const rp of roadPaths) {
            trace(tc, rp.pts, sx, sz);
            tc.g.strokeStyle = hex(rp.color);
            tc.g.lineWidth = Math.max(1.8, rp.width * sx);
            tc.g.stroke();
          }
          // pass 3: markings on bigger roads
          for (const rp of roadPaths) {
            if (rp.width < 9) continue;
            trace(tc, rp.pts, sx, sz);
            tc.g.strokeStyle = "rgba(250,235,180,0.85)";
            tc.g.lineWidth = Math.max(0.8, rp.width * sx * 0.06);
            tc.g.setLineDash([12, 10]);
            tc.g.stroke();
            tc.g.setLineDash([]);
          }
          tc.texture.needsUpdate = true;
        }
        // ---- RAILWAY TRACKS: draped ribbons with rail/sleeper texture ----
        if (rails.length) {
          const railTex = makeRailTexture();
          const geos = [];
          for (const r of rails) {
            const pts = [];
            for (let i = 0; i < r.pts.length; i++) {
              pts.push(r.pts[i]);
              if (i < r.pts.length - 1) {
                const d = r.pts[i].distanceTo(r.pts[i + 1]);
                const steps = Math.min(24, Math.floor(d / 9));
                for (let k = 1; k <= steps; k++)
                  pts.push(new THREE.Vector2().lerpVectors(r.pts[i], r.pts[i + 1], k / (steps + 1)));
              }
            }
            if (pts.length < 2) continue;
            const half = 1.6;
            const v = [], uv = [], idx = [];
            for (let i = 0; i < pts.length; i++) {
              const dir = new THREE.Vector2();
              if (i === 0) dir.subVectors(pts[1], pts[0]);
              else if (i === pts.length - 1) dir.subVectors(pts[i], pts[i - 1]);
              else dir.subVectors(pts[i + 1], pts[i - 1]);
              dir.normalize();
              const nx = -dir.y * half, nz = dir.x * half;
              const lx = pts[i].x + nx, lz = pts[i].y + nz;
              const rx = pts[i].x - nx, rz = pts[i].y - nz;
              v.push(lx, groundHeight(lx, lz) + 0.12, lz, rx, groundHeight(rx, rz) + 0.12, rz);
              uv.push(0, i, 1, i);
              if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
            }
            const g2 = new THREE.BufferGeometry();
            g2.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
            g2.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
            g2.setIndex(idx);
            geos.push(g2);
          }
          if (geos.length) {
            const merged = mergeGeometries(geos, false);
            merged.computeVertexNormals();
            const m = new THREE.Mesh(
              merged,
              new THREE.MeshLambertMaterial({
                map: railTex, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide,
              })
            );
            m.renderOrder = 1;
            scene.add(m);
          }
        }

        // ---- BRIDGES: level deck + railings + pillars; deck is walkable ----
        const bridgeDecks = []; // {pts, halfW, y0, y1, len, cum}
        {
          const deckMat = new THREE.MeshLambertMaterial({ color: 0x6d737c, map: makeRoadTexture(true) });
          const railMat = new THREE.MeshLambertMaterial({ color: 0x8b939e });
          const pillarMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
          const railTex2 = makeRailTexture();
          for (const br of bridges) {
            if (br.pts.length < 2) continue;
            const P = br.pts;
            const cum = [0];
            for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + P[i].distanceTo(P[i - 1]));
            const len = cum[cum.length - 1] || 1;
            const y0 = groundHeight(P[0].x, P[0].y) + 1.2;
            const y1 = groundHeight(P[P.length - 1].x, P[P.length - 1].y) + 1.2;
            const halfW = br.width / 2;
            const deckY = (t) => y0 + (y1 - y0) * t;
            const v = [], uv = [], idx = [];
            const rv = [], ridx = []; // railings
            for (let i = 0; i < P.length; i++) {
              const t = cum[i] / len;
              const dir = new THREE.Vector2();
              if (i === 0) dir.subVectors(P[1], P[0]);
              else if (i === P.length - 1) dir.subVectors(P[i], P[i - 1]);
              else dir.subVectors(P[i + 1], P[i - 1]);
              dir.normalize();
              const nx = -dir.y * halfW, nz = dir.x * halfW;
              const y = deckY(t);
              const lx = P[i].x + nx, lz = P[i].y + nz;
              const rx = P[i].x - nx, rz = P[i].y - nz;
              v.push(lx, y, lz, rx, y, rz);
              uv.push(0, cum[i] * 0.07, 1, cum[i] * 0.07);
              if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
              // railing wall verts (both sides, 1.1 m tall)
              rv.push(lx, y, lz, lx, y + 1.1, lz, rx, y, rz, rx, y + 1.1, rz);
              if (i > 0) {
                const b = (i - 1) * 4;
                ridx.push(b, b + 1, b + 4, b + 1, b + 5, b + 4);
                ridx.push(b + 2, b + 3, b + 6, b + 3, b + 7, b + 6);
              }
            }
            const dg = new THREE.BufferGeometry();
            dg.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
            dg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
            dg.setIndex(idx);
            dg.computeVertexNormals();
            const deck = new THREE.Mesh(dg, br.isRail ? new THREE.MeshLambertMaterial({ map: railTex2 }) : deckMat);
            deck.material.side = THREE.DoubleSide;
            scene.add(deck);
            const rg = new THREE.BufferGeometry();
            rg.setAttribute("position", new THREE.Float32BufferAttribute(rv, 3));
            rg.setIndex(ridx);
            rg.computeVertexNormals();
            railMat.side = THREE.DoubleSide;
            scene.add(new THREE.Mesh(rg, railMat));
            // pillars every ~25 m down to the ground
            for (let dCum = 12; dCum < len; dCum += 25) {
              let i = 1;
              while (i < cum.length && cum[i] < dCum) i++;
              const t2 = (dCum - cum[i - 1]) / Math.max(0.01, cum[i] - cum[i - 1]);
              const px = P[i - 1].x + (P[i].x - P[i - 1].x) * t2;
              const pz = P[i - 1].y + (P[i].y - P[i - 1].y) * t2;
              const gy2 = groundHeight(px, pz);
              const top = deckY(dCum / len);
              const h = Math.max(0.5, top - gy2);
              const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, h, 8), pillarMat);
              pil.position.set(px, gy2 + h / 2, pz);
              scene.add(pil);
            }
            bridgeDecks.push({ pts: P, halfW: halfW + 0.3, y0, y1, len, cum });
          }
        }
        engineRef.current.bridgeDecks = bridgeDecks;

        // ---- STATIONS: platform + canopy + name sign ----
        {
          const platMat = new THREE.MeshLambertMaterial({ color: 0xb9b2a4 });
          const roofMat = new THREE.MeshLambertMaterial({ color: 0x7c4a3a });
          const postMat = new THREE.MeshLambertMaterial({ color: 0x555b64 });
          for (const st of stations.slice(0, 6)) {
            const gy2 = groundHeight(st.x, st.z);
            const plat = new THREE.Mesh(new THREE.BoxGeometry(26, 0.9, 6), platMat);
            plat.position.set(st.x, gy2 + 0.45, st.z);
            scene.add(plat);
            const roof = new THREE.Mesh(new THREE.BoxGeometry(24, 0.3, 5), roofMat);
            roof.position.set(st.x, gy2 + 4.3, st.z);
            scene.add(roof);
            for (const [ox, oz] of [[-10, -2], [10, -2], [-10, 2], [10, 2]]) {
              const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 3.4, 6), postMat);
              post.position.set(st.x + ox, gy2 + 2.5, st.z + oz);
              scene.add(post);
            }
            // name sign sprite
            const c2 = document.createElement("canvas");
            c2.width = 512; c2.height = 96;
            const g3 = c2.getContext("2d");
            g3.fillStyle = "rgba(18,42,80,0.92)";
            g3.fillRect(0, 0, 512, 96);
            g3.strokeStyle = "#ffd75e"; g3.lineWidth = 5; g3.strokeRect(4, 4, 504, 88);
            g3.fillStyle = "#ffffff"; g3.font = "bold 46px sans-serif"; g3.textAlign = "center";
            g3.fillText("🚉 " + st.name.slice(0, 20), 256, 60);
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c2), transparent: true }));
            sp.scale.set(22, 4.2, 1);
            sp.position.set(st.x, gy2 + 9, st.z);
            scene.add(sp);
          }
        }

        // ---- OVERTURE FALLBACK: where OSM has few buildings, pull ML
        // footprints from the Overture pipeline (R2-cached, DuckDB-backed).
        // Dedupe: skip footprints whose centroid lands in an OSM building. ----
        {
        let osmBuildingCount = 0;
        for (const [, geos] of byColor) osmBuildingCount += geos.length;
        console.info(`[street] OSM buildings: ${osmBuildingCount}`);
        if (osmBuildingCount < 120) {
            try {
              const okey = `wtw_ovt_${lat0.toFixed(3)}_${lon0.toFixed(3)}`;
              const r3 = await fetch(`/api/overture/${okey}`);
              if (r3.ok) {
                const extra = await r3.json();
                const geos2 = [];
                let added = 0;
                for (const b of extra) {
                  if (added > 800) break;
                  const ring = b.ring.map(([lo, la]) => {
                    const pt = toLocal(la, lo);
                    return [pt.x, pt.z];
                  });
                  let cx2 = 0, cz2 = 0;
                  for (const [rx, rz] of ring) { cx2 += rx; cz2 += rz; }
                  cx2 /= ring.length; cz2 /= ring.length;
                  if (insideBuilding(cx2, cz2)) continue; // OSM already has it
                  let base2 = Infinity;
                  for (const [rx, rz] of ring) base2 = Math.min(base2, groundHeight(rx, rz));
                  const shape2 = new THREE.Shape();
                  shape2.moveTo(ring[0][0], -ring[0][1]);
                  for (let i2 = 1; i2 < ring.length; i2++) shape2.lineTo(ring[i2][0], -ring[i2][1]);
                  let g5;
                  try { g5 = new THREE.ExtrudeGeometry(shape2, { depth: (b.h || 8) + 4, bevelEnabled: false }); }
                  catch { continue; }
                  g5.rotateX(-Math.PI / 2);
                  g5.translate(0, base2 - 1.5, 0);
                  geos2.push(g5);
                  addFootprint(ring);
                  added++;
                }
                if (geos2.length) {
                  const merged2 = mergeGeometries(geos2, false);
                  scene.add(new THREE.Mesh(merged2, new THREE.MeshLambertMaterial({ color: 0xded6c6, map: facadeTex })));
                  console.info(`[overture] added ${geos2.length} buildings`);
                }
              }
            } catch { /* optional layer */ }
          }
        }

        // ---- PROPS (lib/engine/props): tag -> asset builders ----
        placeProps(props, { scene, groundHeight, spinners, lampGlows });
        engineRef.current.spinners = spinners;
        engineRef.current.lampGlows = lampGlows;

        // ---- BARRIERS: thin walls along ways, with collision ----
        {
          const mats = {
            wall: new THREE.MeshLambertMaterial({ color: 0xb0a894, side: THREE.DoubleSide }),
            city_wall: new THREE.MeshLambertMaterial({ color: 0xa89a80, side: THREE.DoubleSide }),
            fence: new THREE.MeshLambertMaterial({ color: 0x8a7f6e, side: THREE.DoubleSide, transparent: true, opacity: 0.75 }),
            hedge: new THREE.MeshLambertMaterial({ color: 0x4b7a45, side: THREE.DoubleSide }),
          };
          const hts = { wall: 1.9, city_wall: 5, fence: 1.3, hedge: 1.5 };
          for (const bw of barrierWays) {
            const H = hts[bw.kind] || 1.5;
            const v = [], idx = [];
            const P = bw.pts;
            for (let i = 0; i < P.length; i++) {
              const gy2 = groundHeight(P[i].x, P[i].z);
              v.push(P[i].x, gy2, P[i].z, P[i].x, gy2 + H, P[i].z);
              if (i > 0) {
                const a = (i - 1) * 2;
                idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
                // collision: thin quad footprint into the grid
                addFootprint([
                  [P[i - 1].x - 0.2, P[i - 1].z - 0.2], [P[i].x - 0.2, P[i].z - 0.2],
                  [P[i].x + 0.2, P[i].z + 0.2], [P[i - 1].x + 0.2, P[i - 1].z + 0.2],
                ]);
              }
            }
            if (v.length < 12) continue;
            const g2 = new THREE.BufferGeometry();
            g2.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
            g2.setIndex(idx);
            g2.computeVertexNormals();
            scene.add(new THREE.Mesh(g2, mats[bw.kind] || mats.wall));
          }
        }

        // ---- POWER LINES: pylons already placed as props; hang wires ----
        {
          const wireMat = new THREE.LineBasicMaterial({ color: 0x30343a });
          for (const pl of powerLines) {
            const P = pl.pts;
            if (P.length < 2) continue;
            for (const dy of [-1.2, 0, 1.2]) {
              const pts3 = [];
              for (const q2 of P) pts3.push(new THREE.Vector3(q2.x + dy * 0.3, groundHeight(q2.x, q2.z) + 20.5, q2.z + dy * 0.3));
              const g3 = new THREE.BufferGeometry().setFromPoints(pts3);
              scene.add(new THREE.Line(g3, wireMat));
            }
          }
        }

        // Spawn on the nearest road point (streets, not courtyards/rooftops).
        let best = null;
        let bestD = Infinity;
        for (const pt of roadPoints) {
          const d = pt.x * pt.x + pt.z * pt.z;
          if (d < bestD) { bestD = d; best = pt; }
        }
        if (best) {
          player.x = best.x;
          player.z = best.z;
          const vx = best.nx - best.x, vz = best.nz - best.z;
          if (vx || vz) player.heading = Math.atan2(vx, -vz);
        }
      } catch (e) {
        console.warn("[street] overpass failed:", e?.message);
      }
    };

    // ---- avatar: simple static mannequin (no rig, no animation — clean) ----
    const loadAvatar = () => {
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0x6d84a8 });
      const legMat = new THREE.MeshLambertMaterial({ color: 0x3f4a5c });
      const skinMat = new THREE.MeshLambertMaterial({ color: 0xd9c2a8 });
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
    const onClick = () => {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    };
    const onKey = (e) => {
      keys[e.code] = e.type === "keydown";
      if (e.type === "keydown" && e.code === "KeyV" && !e.repeat) {
        player.third = !player.third;
        if (avatar) avatar.visible = player.third;
      }
    };
    const onMouse = (e) => {
      if (document.pointerLockElement !== canvas) return;
      player.heading += e.movementX * 0.0022;
      player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - e.movementY * 0.0022));
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
    };
    canvas.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    document.addEventListener("mousemove", onMouse);
    document.addEventListener("pointerlockchange", onLock);
    window.addEventListener("resize", onResize);

    // ---- main loop ----
    const clock = new THREE.Clock();
    let fpsCount = 0, fpsTime = performance.now(), fpsVal = 0, hudTick = 0, precipTick = 0;
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
        applyTouchLook(touch, player);
      }
      if (keys.KeyW || keys.ArrowUp) f += 1;
      if (keys.KeyS || keys.ArrowDown) f -= 1;
      if (keys.KeyD || keys.ArrowRight) r += 1;
      if (keys.KeyA || keys.ArrowLeft) r -= 1;
      player.moving = !!(f || r);
      if (player.moving) {
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
        if (!blocked(nx, nz)) { player.x = nx; player.z = nz; }
        else if (!blocked(player.x, nz)) player.z = nz;
        else if (!blocked(nx, player.z)) player.x = nx;
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

      if (player.third && avatar) {
        avatar.position.set(player.x, gy, player.z);
        avatar.rotation.y = -player.heading + Math.PI;
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
      } else {
        camera.position.set(player.x, gy + EYE, player.z);
        camera.rotation.y = -player.heading;
        camera.rotation.x = player.pitch;
      }
      // animate wind turbines + precipitation
      for (const r of engineRef.current.spinners || []) r.rotation.z += dt * 1.4;
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
      {
        const g = toGeo(player.x, player.z);
        posRef.current = { lat: g.lat, lon: g.lon, heading: player.heading, height: gy + 2 };
      }
      renderer.render(scene, camera);

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
      }
    };

    // ---- boot ----
    (async () => {
      await loadTerrain();
      if (disposed) return;

      applySky(12);
      loadAvatar();
      loop();

      setStage("Fetching city data…");
      const cityData = await cityDataPromise;
      if (disposed) return;

      await loadCity(cityData);
      if (disposed) return;

      setReadyPct(100);
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

      // ---- R2 neighbor prefetch: warm 4 adjacent cells in the background.
      // Reuses fetchCityData so cached cells are ALWAYS full-fidelity (a lean
      // prefetch query would poison the shared cache with partial data). ----
      setTimeout(async () => {
        const D = 0.0055;
        const cells = [[lat0 + D, lon0], [lat0 - D, lon0], [lat0, lon0 + D], [lat0, lon0 - D]];
        const CONCURRENCY = 2;
        let i = 0;
        const worker = async () => {
          while (i < cells.length && !disposed) {
            const idx = i++;
            const [la, lo] = cells[idx];
            try { await fetchCityData(la, lo); } catch { /* best effort */ }
          }
        };
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      }, 10000);
      window.__streetDebug = {
        player,
        insideBuilding,
        groundHeight,
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
      // location title
      fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat0}&longitude=${lon0}&localityLanguage=en`
      )
        .then((r) => r.json())
        .then((d) => {
          const line = [d.locality || d.city, d.countryName].filter(Boolean).join(", ");
          if (line) setPlace(line);
        })
        .catch(() => {});
    })();

    return () => {
      disposed = true;
      running = false;
      if (typeof window !== 'undefined') {
        window.__engineReady = false;
      }
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      document.removeEventListener("mousemove", onMouse);
      document.removeEventListener("pointerlockchange", onLock);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat0, lon0]);

  const streetStatus = {
    mode: "walk",
    lat: lat0,
    lon: lon0,
    heading: 0,
    height: 200,
    fps: 0,
    locked: hudLocked,
    elevation: null,
  };

  return (
    <main>
      <div ref={mountRef} className="cesium-container" />
      {readyPct < 100 && (
        <LoadingScreen logo="🎮" title="STREET ENGINE" pct={readyPct} stage={stage} />
      )}

      {readyPct >= 100 && (
        <GameShell
          engine="street"
          screen="play"
          status={streetStatus}
          posRef={posRef}
          panel={panel}
          setPanel={setPanel}
          bigMap={bigMap}
          setBigMap={setBigMap}
          place={place}
          settings={settings}
          onSettingChange={changeSetting}
          onTravel={(la, lo) => router.push(`/street?lat=${la}&lon=${lo}`)}
          onGoHome={() => router.push("/")}
          walking
          modeLabel="🎮 STREET ENGINE"
          hintText={
            hudLocked
              ? "WASD move · mouse look · Shift sprint · V view · Tab map · M travel"
              : "Click the view to capture the mouse · WASD to walk · M travel · P menu"
          }
          hudRef={hudDomRef}
          coordsFallback={{ lat: lat0, lon: lon0 }}
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
            { label: "⚙ Settings", onClick: () => setPanel("settings") },
            { label: "🌐 Globe View", onClick: () => router.push("/") },
          ]}
        />
      )}
    </main>
  );
}
