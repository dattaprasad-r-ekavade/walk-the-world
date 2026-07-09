// Pure city-geometry builder (plan 19.1). Runs in a Worker or on the main
// thread. Returns transferable ArrayBuffers + JSON metadata; the caller
// rebuilds THREE.BufferGeometry / InstancedMesh and paints the road canvas.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  ROAD_STYLE,
  buildingWallColor,
  buildingRoofColor,
  pitchedRoofColor,
  wantsPitchedRoof,
} from "@/lib/engine/styles";
import { makeLocalFrame } from "@/lib/engine/geo";
import { createGroundHeight } from "@/lib/engine/street/ground-height";
import { remapWallUVs, wantsStorefront } from "@/lib/engine/facade-uv";

function sliceGroup(geo, matIndex) {
  const gr = geo.groups.find((g2) => g2.materialIndex === matIndex);
  if (!gr) return null;
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"]) {
    const attr = geo.attributes[name];
    if (!attr) continue;
    out.setAttribute(
      name,
      new THREE.BufferAttribute(
        attr.array.slice(gr.start * attr.itemSize, (gr.start + gr.count) * attr.itemSize),
        attr.itemSize
      )
    );
  }
  return out;
}

function geoToTransfer(geo) {
  if (!geo) return null;
  const out = {};
  for (const name of Object.keys(geo.attributes)) {
    const attr = geo.attributes[name];
    out[name] = {
      array: attr.array,
      itemSize: attr.itemSize,
      normalized: !!attr.normalized,
    };
  }
  if (geo.index) out.index = geo.index.array;
  return out;
}

function collectTransfers(payload, list = []) {
  if (!payload) return list;
  if (Array.isArray(payload)) {
    for (const item of payload) collectTransfers(item, list);
    return list;
  }
  if (typeof payload !== "object") return list;
  for (const [k, v] of Object.entries(payload)) {
    if (k === "array" && ArrayBuffer.isView(v)) list.push(v.buffer);
    else if (ArrayBuffer.isView(v) && (k === "index" || k === "matrices")) list.push(v.buffer);
    else if (v && typeof v === "object") collectTransfers(v, list);
  }
  return list;
}

/**
 * @param {{
 *   elements: object[],
 *   lat0: number,
 *   lon0: number,
 *   terrainTiles: Array<{ key: string, heights: Float32Array, n: number, x0: number, z0: number, sizeX: number, sizeZ: number }>,
 *   onProgress?: (done: number, total: number) => void,
 * }} opts
 */
export function buildCityGeometry({ elements, lat0, lon0, terrainTiles, onProgress }) {
  const { toLocal } = makeLocalFrame(lat0, lon0);
  const tileMap = new Map();
  for (const t of terrainTiles || []) {
    tileMap.set(t.key, {
      heights: t.heights instanceof Float32Array ? t.heights : new Float32Array(t.heights),
      n: t.n,
      x0: t.x0,
      z0: t.z0,
      sizeX: t.sizeX,
      sizeZ: t.sizeZ,
    });
  }
  const groundHeight = createGroundHeight(tileMap);

  // Pre-scan POIs so storefront UVs work even when the building way
  // appears before its shop node in the Overpass element list.
  const earlyPois = [];
  for (const el of elements || []) {
    if (el.type === "node" && el.tags && (el.tags.shop || el.tags.amenity)) {
      earlyPois.push(toLocal(el.lat, el.lon));
    }
  }

  const byColor = new Map();
  const roofGeosByColor = new Map();
  const clutterGeos = [];
  const roofCapByColor = new Map();
  const buildingRings = [];
  const footprints = [];
  const roadPoints = [];
  const roadPaths = [];
  const bridges = [];
  const rails = [];
  const stations = [];
  const props = [];
  const barrierWays = [];
  const powerLines = [];
  const waterways = [];
  const treeSpots = [];
  const flatPolys = [];
  const pois = [];
  const crossings = [];

  const total = elements?.length || 0;
  let featureIdx = 0;

  for (const way of elements || []) {
    featureIdx++;
    if (onProgress && featureIdx % 200 === 0) onProgress(featureIdx, total);

    if (way.type === "node" && way.tags?.natural === "tree") {
      treeSpots.push(toLocal(way.lat, way.lon));
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
        T.natural === "peak" ? "peak" :
        T.historic === "monument" || T.historic === "memorial" ? "memorial" :
        T["generator:source"] === "wind" ? "turbine" :
        T.power === "tower" ? "pylon" :
        null;
      if (kind) {
        const pt = toLocal(way.lat, way.lon);
        props.push({ kind, x: pt.x, z: pt.z, tags: T, id: `${way.type}/${way.id}` });
      }
      if (T.shop || T.amenity) {
        const pp = toLocal(way.lat, way.lon);
        pois.push({ x: pp.x, z: pp.z, name: T.name, type: T.shop || T.amenity });
      }
      if (T.highway === "crossing" || T.crossing) {
        const cp = toLocal(way.lat, way.lon);
        crossings.push({ x: cp.x, z: cp.z });
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
        return { x: q2.x, y: q2.z };
      });
      if (way.tags.bridge) bridges.push({ pts, width: 5, isRail: true });
      else rails.push({ pts });
      continue;
    }
    if (!way.geometry || way.geometry.length < 2) continue;

    if (way.type === "relation" && way.members &&
        (way.tags?.natural === "water" || way.tags?.waterway === "riverbank" || way.tags?.water)) {
      for (const m of way.members) {
        if (m.role !== "outer" || !m.geometry || m.geometry.length < 3) continue;
        flatPolys.push({ geometry: m.geometry, color: 0x6fa8d8, lift: 0.06 });
      }
      continue;
    }
    if (way.geometry && /^(river|stream|canal)$/.test(way.tags?.waterway || "")) {
      const w = way.tags.waterway === "river" ? 24 : way.tags.waterway === "canal" ? 10 : 4;
      waterways.push({
        pts: way.geometry.map((g) => {
          const q2 = toLocal(g.lat, g.lon);
          return { x: q2.x, y: q2.z };
        }),
        width: parseFloat(way.tags.width) || w,
      });
      continue;
    }
    if (way.tags?.natural === "water" || way.tags?.waterway === "riverbank") {
      flatPolys.push({ geometry: way.geometry, color: 0x6fa8d8, lift: 0.06 });
      continue;
    }
    if (way.tags?.natural === "beach" || way.tags?.natural === "sand") {
      flatPolys.push({ geometry: way.geometry, color: 0xe6d5a3, lift: 0.04 });
      continue;
    }
    if (/farmland|orchard|vineyard/.test(way.tags?.landuse || "")) {
      flatPolys.push({ geometry: way.geometry, color: 0xd3c89e, lift: 0.03 });
      continue;
    }
    if (way.tags?.leisure === "pitch") {
      flatPolys.push({ geometry: way.geometry, color: 0x4f9e5d, lift: 0.06 });
      continue;
    }
    if (way.tags?.leisure === "swimming_pool") {
      flatPolys.push({ geometry: way.geometry, color: 0x39a0e0, lift: 0.06 });
      continue;
    }
    if (way.tags?.leisure === "playground") {
      flatPolys.push({ geometry: way.geometry, color: 0xd9b98a, lift: 0.05 });
      continue;
    }
    if (way.tags?.leisure === "track") {
      flatPolys.push({ geometry: way.geometry, color: 0xb5543f, lift: 0.06 });
      continue;
    }
    if (way.tags?.leisure === "golf_course") {
      flatPolys.push({ geometry: way.geometry, color: 0x7fb56b, lift: 0.03 });
      continue;
    }
    if (way.tags?.amenity === "parking") {
      flatPolys.push({ geometry: way.geometry, color: 0x8a9098, lift: 0.05 });
      continue;
    }
    if (way.tags?.leisure === "park" || /grass|meadow|forest/.test(way.tags?.landuse || "")) {
      flatPolys.push({ geometry: way.geometry, color: 0x93bd7f, lift: 0.04 });
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
      base -= 1.5;
      const shape = new THREE.Shape();
      shape.moveTo(ring[0][0], -ring[0][1]);
      for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i][0], -ring[i][1]);
      let geo;
      try {
        geo = new THREE.ExtrudeGeometry(shape, { depth: h + 4, bevelEnabled: false });
      } catch {
        continue;
      }
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, base, 0);

      const color = buildingWallColor(way.tags, h);
      const matKey = String(way.tags?.["building:material"] || "").toLowerCase();
      const bucketKey = `${color}|${matKey}`;
      if (!byColor.has(bucketKey)) byColor.set(bucketKey, { color, materialKey: matKey, geos: [] });

      const wallGeo = sliceGroup(geo, 1) || geo;
      const capGeo = sliceGroup(geo, 0);

      // centroid early — needed for storefront proximity + roofs
      let cx = 0, cz = 0, area = 0;
      {
        let a2 = 0, sx = 0, sz = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const cr = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
          a2 += cr;
          sx += (ring[j][0] + ring[i][0]) * cr;
          sz += (ring[j][1] + ring[i][1]) * cr;
        }
        area = Math.abs(a2 / 2);
        if (Math.abs(a2) > 1e-6) { cx = sx / (3 * a2); cz = sz / (3 * a2); }
        else { cx = ring[0][0]; cz = ring[0][1]; }
      }
      let nearPoi = false;
      for (const p of earlyPois) {
        if (Math.hypot(p.x - cx, p.z - cz) < 16) { nearPoi = true; break; }
      }
      const shopfront = wantsStorefront(way.tags) || nearPoi;
      remapWallUVs(wallGeo, {
        base,
        height: h,
        shopfront,
        seed: way.id || 1,
      });

      {
        const posA = wallGeo.attributes.position;
        const colA = new Float32Array(posA.count * 3);
        const jr = 0.90 + ((way.id % 13) / 13) * 0.2;
        const jg = 0.90 + ((way.id % 7) / 7) * 0.2;
        const jb = 0.90 + ((way.id % 11) / 11) * 0.2;
        const gy0 = base + 4;
        for (let vi = 0; vi < posA.count; vi++) {
          const vy = posA.getY(vi);
          const ao = 0.66 + 0.34 * Math.max(0, Math.min(1, (vy - gy0) / 9));
          colA[vi * 3] = ao * jr;
          colA[vi * 3 + 1] = ao * jg;
          colA[vi * 3 + 2] = ao * jb;
        }
        wallGeo.setAttribute("color", new THREE.BufferAttribute(colA, 3));
      }
      byColor.get(bucketKey).geos.push(wallGeo);
      if (capGeo) {
        const roofCol = buildingRoofColor(way.tags);
        if (!roofCapByColor.has(roofCol)) roofCapByColor.set(roofCol, []);
        roofCapByColor.get(roofCol).push(capGeo);
      }
      footprints.push({ ring, id: `${way.type}/${way.id}`, tags: way.tags });
      buildingRings.push(ring);

      const roofY = base + h + 4;
      const pitched = wantsPitchedRoof(way.tags, area, h);
      if (pitched && ring.length <= 8) {
        const apexH = Math.min(3.2, 1.6 + Math.sqrt(area) * 0.12);
        const v = [], idx2 = [];
        for (const [rx, rz] of ring) v.push(rx, roofY, rz);
        v.push(cx, roofY + apexH, cz);
        const apex = ring.length;
        for (let i = 0; i < ring.length; i++)
          idx2.push(i, apex, (i + 1) % ring.length);
        const rg = new THREE.BufferGeometry();
        rg.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
        rg.setIndex(idx2);
        rg.computeVertexNormals();
        const rCol = pitchedRoofColor(way.tags);
        if (!roofGeosByColor.has(rCol)) roofGeosByColor.set(rCol, []);
        roofGeosByColor.get(rCol).push(rg);
      } else if (area > 350 && ring.length >= 4) {
        const rot = (way.id % 6) * 0.5;
        const tank = new THREE.CylinderGeometry(1.1, 1.1, 2.2, 10);
        tank.translate(cx + Math.cos(rot) * 3, roofY + 1.1, cz + Math.sin(rot) * 3);
        clutterGeos.push(tank);
        const nAc = 1 + (way.id % 3);
        for (let k = 0; k < nAc; k++) {
          const ac = new THREE.BoxGeometry(1.4, 0.9, 1.1);
          const aa = rot + 1.8 + k * 1.9;
          ac.translate(cx + Math.cos(aa) * (2.5 + k), roofY + 0.45, cz + Math.sin(aa) * (2.5 + k));
          clutterGeos.push(ac);
        }
      }
    } else if (way.tags?.highway && ROAD_STYLE[way.tags.highway]) {
      const [color, width] = ROAD_STYLE[way.tags.highway];
      const raw = way.geometry.map((g) => {
        const p = toLocal(g.lat, g.lon);
        return new THREE.Vector2(p.x, p.z);
      });
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
      const plainPts = pts.map((p) => ({ x: p.x, y: p.y }));
      if (way.tags.bridge) {
        bridges.push({ pts: plainPts, width: Math.max(width, 6), isRail: false });
      } else {
        roadPaths.push({
          pts: plainPts,
          color,
          width,
          id: `${way.type}/${way.id}`,
          tags: way.tags,
        });
      }
      const walkable = !["motorway", "trunk"].includes(way.tags.highway);
      if (walkable)
        for (let i = 0; i < pts.length; i++) {
          const nb = pts[i + 1] || pts[i - 1] || pts[i];
          roadPoints.push({ x: pts[i].x, z: pts[i].y, nx: nb.x, nz: nb.y });
        }
    }
  }

  // ---- merge building batches ----
  const walls = [];
  let tris = 0;
  for (const { color, materialKey, geos } of byColor.values()) {
    if (!geos.length) continue;
    const merged = mergeGeometries(geos, false);
    tris += (merged.index ? merged.index.count : merged.attributes.position.count) / 3;
    walls.push({ color, materialKey, geo: geoToTransfer(merged) });
  }
  const roofCaps = [];
  for (const [color, geos] of roofCapByColor) {
    roofCaps.push({ color, geo: geoToTransfer(mergeGeometries(geos, false)) });
  }
  const pitchedRoofs = [];
  for (const [color, geos] of roofGeosByColor) {
    pitchedRoofs.push({ color, pitched: true, geo: geoToTransfer(mergeGeometries(geos, false)) });
  }
  const clutter = clutterGeos.length
    ? geoToTransfer(mergeGeometries(clutterGeos, false))
    : null;

  // ---- lived-in awnings + furniture ----
  let livedIn = null;
  {
    const AWNING_COLORS = [0xb8433a, 0x2f7a4d, 0x2f5d8a, 0xb8862f, 0x7a3a6e];
    const awningGeos = [];
    const nearestRoadDir = (x, z, maxD) => {
      let best = null;
      for (const rp of roadPaths) {
        for (let i = 0; i < rp.pts.length - 1; i++) {
          const a = rp.pts[i], b = rp.pts[i + 1];
          const ddx = b.x - a.x, ddz = b.y - a.y;
          const L2 = ddx * ddx + ddz * ddz || 1;
          let tt = ((x - a.x) * ddx + (z - a.y) * ddz) / L2;
          tt = Math.max(0, Math.min(1, tt));
          const qx = a.x + ddx * tt, qz = a.y + ddz * tt;
          const d = Math.hypot(x - qx, z - qz);
          if (d < maxD && (!best || d < best.d)) best = { d, ang: Math.atan2(ddx, ddz) };
        }
      }
      return best;
    };
    let ai = 0;
    for (const poi of pois) {
      if (ai >= 60) break;
      const rd = nearestRoadDir(poi.x, poi.z, 18);
      if (!rd) continue;
      const g2 = new THREE.BoxGeometry(3.0, 0.14, 1.3);
      g2.rotateX(0.28);
      const cl = new THREE.Color(AWNING_COLORS[ai % AWNING_COLORS.length]);
      const ca = new Float32Array(g2.attributes.position.count * 3);
      for (let k = 0; k < ca.length; k += 3) { ca[k] = cl.r; ca[k + 1] = cl.g; ca[k + 2] = cl.b; }
      g2.setAttribute("color", new THREE.BufferAttribute(ca, 3));
      const m4a = new THREE.Matrix4().makeRotationY(rd.ang);
      m4a.setPosition(poi.x, groundHeight(poi.x, poi.z) + 2.7, poi.z);
      g2.applyMatrix4(m4a);
      awningGeos.push(g2);
      ai++;
    }
    const furnGeos = [];
    let placed = 0;
    for (const rp of roadPaths) {
      if (placed >= 220) break;
      if ((rp.width || 0) < 6.5 || !rp.id) continue;
      let acc = 30;
      for (let i = 0; i < rp.pts.length - 1 && placed < 220; i++) {
        const a = rp.pts[i], b = rp.pts[i + 1];
        const segL = Math.hypot(b.x - a.x, b.y - a.y);
        acc += segL;
        if (acc < 55) continue;
        acc = 0;
        const tdx = (b.x - a.x) / (segL || 1), tdz = (b.y - a.y) / (segL || 1);
        const sideSign = placed % 2 === 0 ? 1 : -1;
        const off = (rp.width / 2 + 1.1) * sideSign;
        const fx = a.x + -tdz * off, fz = a.y + tdx * off;
        const gy2 = groundHeight(fx, fz);
        let fg;
        const colF = new THREE.Color(placed % 3 === 0 ? 0x3a3d42 : 0x7a5a38);
        if (placed % 3 === 0) {
          fg = new THREE.CylinderGeometry(0.32, 0.28, 0.85, 8);
          fg.translate(fx, gy2 + 0.42, fz);
        } else {
          fg = new THREE.BoxGeometry(1.7, 0.1, 0.5);
          const back = new THREE.BoxGeometry(1.7, 0.45, 0.08);
          back.translate(0, 0.28, -0.24);
          fg = mergeGeometries([fg, back], false);
          const m4f = new THREE.Matrix4().makeRotationY(Math.atan2(tdx, tdz));
          m4f.setPosition(fx, gy2 + 0.5, fz);
          fg.applyMatrix4(m4f);
        }
        const cf = new Float32Array(fg.attributes.position.count * 3);
        for (let k = 0; k < cf.length; k += 3) { cf[k] = colF.r; cf[k + 1] = colF.g; cf[k + 2] = colF.b; }
        fg.setAttribute("color", new THREE.BufferAttribute(cf, 3));
        furnGeos.push(fg);
        placed++;
      }
    }
    const lived = [...awningGeos, ...furnGeos];
    if (lived.length) {
      livedIn = {
        geo: geoToTransfer(mergeGeometries(lived, false)),
        awnings: awningGeos.length,
        furniture: furnGeos.length,
      };
    }
  }

  // ---- road decals (arc-length UVs → proper asphalt markings) ----
  const roadDecals = [];
  {
    const decalByKey = new Map();
    for (const rp of roadPaths) {
      const pts = [];
      for (let i = 0; i < rp.pts.length; i++) {
        pts.push(new THREE.Vector2(rp.pts[i].x, rp.pts[i].y));
        if (i < rp.pts.length - 1) {
          const a = pts[pts.length - 1];
          const b = new THREE.Vector2(rp.pts[i + 1].x, rp.pts[i + 1].y);
          const d = a.distanceTo(b);
          // denser samples → smoother terrain follow, less "stretched map" look
          const steps = Math.min(32, Math.floor(d / 5.5));
          for (let k = 1; k <= steps; k++)
            pts.push(new THREE.Vector2().lerpVectors(a, b, k / (steps + 1)));
        }
      }
      if (pts.length < 2) continue;
      const half = rp.width / 2;
      const hw = rp.tags?.highway || "";
      const v = [];
      const uv = [];
      const idx = [];
      let cum = 0;
      for (let i = 0; i < pts.length; i++) {
        if (i > 0) cum += pts[i].distanceTo(pts[i - 1]);
        const dir = new THREE.Vector2();
        if (i === 0) dir.subVectors(pts[1], pts[0]);
        else if (i === pts.length - 1) dir.subVectors(pts[i], pts[i - 1]);
        else dir.subVectors(pts[i + 1], pts[i - 1]);
        dir.normalize();
        const nx = -dir.y * half, nz = dir.x * half;
        const lx = pts[i].x + nx, lz = pts[i].y + nz;
        const rx = pts[i].x - nx, rz = pts[i].y - nz;
        // lift a bit more so OSM raster doesn't bleed through
        const ly = groundHeight(lx, lz) + 0.14;
        const ry = groundHeight(rx, rz) + 0.14;
        v.push(lx, ly, lz, rx, ry, rz);
        // V = meters along centerline (texture repeat ≈ 1/12 → ~12 m dash cycle)
        uv.push(0, cum, 1, cum);
        if (i > 0) {
          const a = (i - 1) * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const key = `${rp.color}|${hw}`;
      if (!decalByKey.has(key)) decalByKey.set(key, { color: rp.color, highway: hw, geos: [] });
      decalByKey.get(key).geos.push(geo);
    }
    for (const { color, highway, geos } of decalByKey.values()) {
      const merged = mergeGeometries(geos, false);
      merged.computeVertexNormals();
      roadDecals.push({ color, highway, geo: geoToTransfer(merged) });
    }
  }

  // ---- flat polys ----
  const flats = [];
  for (const fp of flatPolys) {
    try {
      const ring = fp.geometry.map((g) => toLocal(g.lat, g.lon));
      if (ring.length < 3) continue;
      const shape = new THREE.Shape();
      shape.moveTo(ring[0].x, -ring[0].z);
      for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i].x, -ring[i].z);
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      let cy = 0;
      for (const r of ring) cy = Math.max(cy, groundHeight(r.x, r.z));
      geo.translate(0, cy + fp.lift, 0);
      flats.push({ color: fp.color, geo: geoToTransfer(geo) });
    } catch { /* skip */ }
  }

  // ---- trees as instance matrices ----
  let trees = null;
  if (treeSpots.length) {
    const count = Math.min(treeSpots.length, 500);
    const matrices = new Float32Array(count * 16);
    const m4 = new THREE.Matrix4();
    const tmp = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const t = treeSpots[i];
      const sc = 0.8 + (i % 5) * 0.15;
      m4.makeScale(sc, sc, sc);
      tmp.makeTranslation(t.x, groundHeight(t.x, t.z), t.z);
      m4.premultiply(tmp);
      m4.toArray(matrices, i * 16);
    }
    trees = { count, matrices };
  }

  const result = {
    walls,
    roofCaps,
    pitchedRoofs,
    clutter,
    livedIn,
    roadDecals,
    flats,
    trees,
    tris,
    buildingCount: footprints.length,
    pitchedCount: pitchedRoofs.reduce((n, b) => n + 1, 0),
    meta: {
      roadPaths,
      buildingRings,
      roadPoints,
      props,
      stations,
      bridges,
      rails,
      barrierWays,
      powerLines,
      waterways,
      crossings,
      pois,
      footprints,
    },
  };

  return { result, transfers: collectTransfers(result) };
}

export { collectTransfers, geoToTransfer };
