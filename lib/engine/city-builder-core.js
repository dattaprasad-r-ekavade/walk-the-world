// Pure city-geometry builder (plan 19.1). Runs in a Worker or on the main
// thread. Returns transferable ArrayBuffers + JSON metadata; the caller
// rebuilds THREE.BufferGeometry / InstancedMesh and paints the road canvas.
import * as THREE from "three";
import { roadMarkingProfile } from "@/lib/engine/road-markings";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  ROAD_STYLE,
  roadWidthMeters,
  buildingWallColor,
  buildingRoofColor,
  pitchedRoofColor,
  normalizeBuildingMaterial,
  roofShape,
} from "@/lib/engine/styles";
import { makeLocalFrame } from "@/lib/engine/geo";
import { createGroundHeight } from "@/lib/engine/street/ground-height";
import { remapWallUVs, wantsStorefront, wallTintJitter } from "@/lib/engine/facade-uv";
import { createRoofGeometry } from "@/lib/engine/roof-geometry";

function osmMeters(value) {
  if (value == null) return null;
  const raw = String(value).trim().toLowerCase();
  const feetInches = raw.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*(\d+(?:\.\d+)?)?\s*(?:in|\")?$/);
  if (feetInches) return Number(feetInches[1]) * 0.3048 + Number(feetInches[2] || 0) * 0.0254;
  const match = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  const number = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(number)) return null;
  const unit = match[2].trim();
  if (/^(?:ft|feet|foot|')/.test(unit)) return number * 0.3048;
  if (/^(?:in|inch|\")/.test(unit)) return number * 0.0254;
  if (/^(?:cm|centimet)/.test(unit)) return number / 100;
  return number;
}

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
 *   profileQueries?: boolean,
 *   roadQueryMode?: "scan" | "indexed",
 *   onTerrainTileSample?: (key:string) => void,
 *   onProgress?: (done: number, total: number) => void,
 * }} opts
 */
export function buildCityGeometry({
  elements,
  lat0,
  lon0,
  terrainTiles,
  onProgress,
  onTerrainTileSample,
  profileQueries = false,
  roadQueryMode = "indexed",
}) {
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
  const groundHeight = createGroundHeight(tileMap, onTerrainTileSample);

  // Pre-scan POIs so storefront UVs work even when the building way
  // appears before its shop node in the Overpass element list.
  const earlyPois = [];
  const partFootprints = new Set();
  for (const el of elements || []) {
    if (el.type === "node" && el.tags && (el.tags.shop || el.tags.amenity)) {
      earlyPois.push(toLocal(el.lat, el.lon));
    }
    if (el.tags?.["building:part"] && el.geometry?.length >= 3) {
      const first = toLocal(el.geometry[0].lat, el.geometry[0].lon);
      partFootprints.add(`${first.x.toFixed(1)},${first.z.toFixed(1)},${el.geometry.length}`);
    }
  }

  const byMaterialFamily = new Map();
  const linearTint = new THREE.Color();
  const roofGeosByColor = new Map();
  const seenFootprints = new Set(); // stacked duplicate outlines → z-fighting
  const clutterGeos = [];
  const roofCapByColor = new Map();
  const buildingRings = [];
  const footprints = [];
  const roadPoints = [];
  // Spawn candidates only ever come from within this box of the cell origin
  // (matches MAX_MOVE in lib/engine/street/spawn.js, plus headroom).
  const SPAWN_RADIUS = 150;
  const roadPaths = [];
  const seenRoadPathIds = new Set();
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
        T.amenity === "bicycle_parking" ? "bike_rack" :
        T.amenity === "vending_machine" ? "vending" :
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
      if (T.shop || (T.amenity && T.amenity !== "bench")) {
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
      flatPolys.push({
        geometry: way.geometry,
        color: 0x4b9fd1,
        lift: 0.06,
        fixedY: way.tags?.["wtw:sea_level"] === "0" ? 0 : null,
      });
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

    if (way.tags?.building || way.tags?.["building:part"]) {
      const ring = way.geometry.map((g) => {
        const p = toLocal(g.lat, g.lon);
        return [p.x, p.z];
      });
      if (ring.length < 3) continue;
      // stacked duplicate outlines (re-mapped buildings) z-fight as coplanar
      // walls — keep only the first footprint with this signature
      const fpSig = `${ring[0][0].toFixed(1)},${ring[0][1].toFixed(1)},${ring.length}`;
      if (!way.tags["building:part"] && partFootprints.has(fpSig)) continue;
      if (seenFootprints.has(fpSig)) continue;
      seenFootprints.add(fpSig);
      const minHeight = Math.max(0, osmMeters(way.tags.min_height) || 0);
      const levels = Number.parseFloat(way.tags["building:levels"]) || 0;
      const fallbackHeight = 8 + (Math.abs(Number(way.id) || 0) % 7);
      const h = Math.max(minHeight + 2,
        osmMeters(way.tags.height) || minHeight + levels * 3.2 || minHeight + fallbackHeight);
      const wallHeight = Math.max(2, h - minHeight);
      let base = Infinity;
      for (const [rx, rz] of ring) base = Math.min(base, groundHeight(rx, rz));
      base -= 1.5;
      const wallBase = base + Math.min(minHeight, Math.max(0, h - 2));
      const shape = new THREE.Shape();
      shape.moveTo(ring[0][0], -ring[0][1]);
      for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i][0], -ring[i][1]);
      let geo;
      try {
        geo = new THREE.ExtrudeGeometry(shape, { depth: wallHeight, bevelEnabled: false });
      } catch {
        continue;
      }
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, wallBase, 0);

      const color = buildingWallColor(way.tags, h);
      const materialKey = normalizeBuildingMaterial(way.tags?.["building:material"]);
      if (!byMaterialFamily.has(materialKey)) {
        byMaterialFamily.set(materialKey, { materialKey, geos: [] });
      }

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
        base: wallBase,
        height: wallHeight,
        shopfront,
        seed: way.id || 1,
      });

      {
        const posA = wallGeo.attributes.position;
        const colA = new Float32Array(posA.count * 3);
        // Material tint is moved into linear vertex color for family batching.
        // The white shared material then multiplies the tint exactly once.
        linearTint.setHex(color, THREE.SRGBColorSpace);
        const { r: jr, g: jg, b: jb } = wallTintJitter(way.id);
        const gy0 = wallBase + 4;
        for (let vi = 0; vi < posA.count; vi++) {
          const vy = posA.getY(vi);
          const ao = 0.66 + 0.34 * Math.max(0, Math.min(1, (vy - gy0) / 9));
          colA[vi * 3] = linearTint.r * ao * jr;
          colA[vi * 3 + 1] = linearTint.g * ao * jg;
          colA[vi * 3 + 2] = linearTint.b * ao * jb;
        }
        wallGeo.setAttribute("color", new THREE.BufferAttribute(colA, 3));
      }
      byMaterialFamily.get(materialKey).geos.push(wallGeo);
      if (capGeo) {
        const roofCol = buildingRoofColor(way.tags);
        if (!roofCapByColor.has(roofCol)) roofCapByColor.set(roofCol, []);
        roofCapByColor.get(roofCol).push(capGeo);
      }
      footprints.push({ ring, id: `${way.type}/${way.id}`, tags: way.tags });
      buildingRings.push(ring);

      const roofY = wallBase + wallHeight;
      const shapeName = roofShape(way.tags, area, h);
      if (shapeName) {
        const defaultRoofHeight = Math.min(3.2, 1.6 + Math.sqrt(area) * 0.12);
        const roofHeight = Math.max(0.5, osmMeters(way.tags["roof:height"]) || defaultRoofHeight);
        const rg = createRoofGeometry(ring, roofY, roofHeight, shapeName);
        if (rg) {
          const rCol = pitchedRoofColor(way.tags);
          if (!roofGeosByColor.has(rCol)) roofGeosByColor.set(rCol, []);
          roofGeosByColor.get(rCol).push(rg);
        }
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
      const [color, defaultWidth] = ROAD_STYLE[way.tags.highway];
      const width = roadWidthMeters(way.tags, defaultWidth);
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
        const roadId = way.id == null ? null : `${way.type}/${way.id}`;
        if (!roadId || !seenRoadPathIds.has(roadId)) {
          if (roadId) seenRoadPathIds.add(roadId);
          roadPaths.push({ pts: plainPts, color, width, id: roadId, tags: way.tags });
        }
      }
      const walkable = !["motorway", "trunk"].includes(way.tags.highway);
      if (walkable)
        for (let i = 0; i < pts.length; i++) {
          // roadPoints exist ONLY to choose the player spawn, and the spawn
          // never moves further than SPAWN_RADIUS from the origin — so don't
          // ship the rest across the worker boundary. Streamed neighbour cells
          // share this origin and are 400 m+ out, so they emit none at all.
          if (Math.abs(pts[i].x) > SPAWN_RADIUS || Math.abs(pts[i].y) > SPAWN_RADIUS) continue;
          const nb = pts[i + 1] || pts[i - 1] || pts[i];
          // cls/width feed spawn framing (lib/engine/street/spawn.js): which
          // street is worth standing on, and how far onto the pavement to step.
          roadPoints.push({
            x: pts[i].x, z: pts[i].y, nx: nb.x, nz: nb.y,
            cls: way.tags.highway, width,
          });
        }
    }
  }

  // ---- merge building batches ----
  const walls = [];
  let tris = 0;
  for (const { materialKey, geos } of byMaterialFamily.values()) {
    if (!geos.length) continue;
    const merged = mergeGeometries(geos, false);
    tris += (merged.index ? merged.index.count : merged.attributes.position.count) / 3;
    walls.push({ color: 0xffffff, materialKey, geo: geoToTransfer(merged) });
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
  const ROAD_QUERY_MAX_DISTANCE = 18;
  const ROAD_QUERY_GRID_SIZE = 48;
  const useRoadQueryIndex = roadQueryMode !== "scan" && roadPaths.length > 0 && pois.length > 0;
  const roadIndexStartedAt = profileQueries && useRoadQueryIndex ? performance.now() : 0;
  const roadSegmentGrid = useRoadQueryIndex ? new Map() : null;
  let indexedRoadSegments = 0;
  if (roadSegmentGrid) {
    // Expand each segment's bounds by the fixed query radius so the query's
    // single grid cell contains every segment that could be within 18 metres.
    for (const road of roadPaths) {
      for (let i = 0; i < road.pts.length - 1; i++) {
        const a = road.pts[i], b = road.pts[i + 1];
        const ddx = b.x - a.x, ddz = b.y - a.y;
        const segment = { a, ddx, ddz, lengthSquared: ddx * ddx + ddz * ddz || 1 };
        const minCellX = Math.floor((Math.min(a.x, b.x) - ROAD_QUERY_MAX_DISTANCE) / ROAD_QUERY_GRID_SIZE);
        const maxCellX = Math.floor((Math.max(a.x, b.x) + ROAD_QUERY_MAX_DISTANCE) / ROAD_QUERY_GRID_SIZE);
        const minCellZ = Math.floor((Math.min(a.y, b.y) - ROAD_QUERY_MAX_DISTANCE) / ROAD_QUERY_GRID_SIZE);
        const maxCellZ = Math.floor((Math.max(a.y, b.y) + ROAD_QUERY_MAX_DISTANCE) / ROAD_QUERY_GRID_SIZE);
        for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
          for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
            const key = `${cellX},${cellZ}`;
            let bucket = roadSegmentGrid.get(key);
            if (!bucket) roadSegmentGrid.set(key, (bucket = []));
            bucket.push(segment);
          }
        }
        indexedRoadSegments++;
      }
    }
  }
  const poiRoadQueryProfile = profileQueries ? {
    durationMs: 0,
    queryCount: 0,
    segmentTests: 0,
    segmentsPerQuery: roadPaths.reduce((sum, road) => sum + Math.max(0, (road.pts?.length || 0) - 1), 0),
    roadPathCount: roadPaths.length,
    indexBuildMs: profileQueries && useRoadQueryIndex ? performance.now() - roadIndexStartedAt : 0,
    indexedRoadSegments,
    mode: useRoadQueryIndex ? "indexed" : "scan",
  } : null;
  let livedIn = null;
  {
    const AWNING_COLORS = [0xb8433a, 0x2f7a4d, 0x2f5d8a, 0xb8862f, 0x7a3a6e];
    const awningGeos = [];
    const nearestRoadDir = (x, z, maxD) => {
      const queryStartedAt = poiRoadQueryProfile ? performance.now() : 0;
      let best = null;
      const considerSegment = (a, ddx, ddz, lengthSquared) => {
        let tt = ((x - a.x) * ddx + (z - a.y) * ddz) / lengthSquared;
        tt = Math.max(0, Math.min(1, tt));
        const qx = a.x + ddx * tt, qz = a.y + ddz * tt;
        const d = Math.hypot(x - qx, z - qz);
        if (d < maxD && (!best || d < best.d)) best = { d, ang: Math.atan2(ddx, ddz) };
      };
      let candidateCount = 0;
      if (roadSegmentGrid) {
        const cellX = Math.floor(x / ROAD_QUERY_GRID_SIZE);
        const cellZ = Math.floor(z / ROAD_QUERY_GRID_SIZE);
        const candidates = roadSegmentGrid.get(`${cellX},${cellZ}`) || [];
        candidateCount = candidates.length;
        for (const segment of candidates) {
          considerSegment(segment.a, segment.ddx, segment.ddz, segment.lengthSquared);
        }
      } else {
        for (const rp of roadPaths) {
          for (let i = 0; i < rp.pts.length - 1; i++) {
            const a = rp.pts[i], b = rp.pts[i + 1];
            const ddx = b.x - a.x, ddz = b.y - a.y;
            considerSegment(a, ddx, ddz, ddx * ddx + ddz * ddz || 1);
          }
        }
      }
      if (poiRoadQueryProfile) {
        const queryDurationMs = performance.now() - queryStartedAt;
        poiRoadQueryProfile.durationMs += queryDurationMs;
        poiRoadQueryProfile.queryCount++;
        poiRoadQueryProfile.segmentTests += roadSegmentGrid ? candidateCount : poiRoadQueryProfile.segmentsPerQuery;
      }
      return best;
    };
    let ai = 0;
    for (const poi of pois) {
      if (ai >= 60) break;
      const rd = nearestRoadDir(poi.x, poi.z, ROAD_QUERY_MAX_DISTANCE);
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
      const markingProfile = roadMarkingProfile(rp.tags);
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
        let nx = -dir.y * half, nz = dir.x * half;
        if (i > 0 && i < pts.length - 1) {
          const incoming = new THREE.Vector2().subVectors(pts[i], pts[i - 1]).normalize();
          const outgoing = new THREE.Vector2().subVectors(pts[i + 1], pts[i]).normalize();
          const incomingNormal = new THREE.Vector2(-incoming.y, incoming.x);
          const outgoingNormal = new THREE.Vector2(-outgoing.y, outgoing.x);
          const miter = incomingNormal.clone().add(outgoingNormal);
          if (miter.lengthSq() > 1e-8) {
            miter.normalize();
            const scale = Math.min(half / Math.max(Math.abs(miter.dot(outgoingNormal)), 0.5), half * 2);
            nx = miter.x * scale;
            nz = miter.y * scale;
          } else {
            nx = outgoingNormal.x * half;
            nz = outgoingNormal.y * half;
          }
        }
        const lx = pts[i].x + nx, lz = pts[i].y + nz;
        const rx = pts[i].x - nx, rz = pts[i].y - nz;
        // A 10 cm lift clears the terrain; polygon offset handles depth precision.
        const ly = groundHeight(lx, lz) + 0.1;
        const ry = groundHeight(rx, rz) + 0.1;
        v.push(lx, ly, lz, rx, ry, rz);
        // V = meters along centerline; the asphalt texture repeats every 24 m.
        uv.push(0, cum, 1, cum);
        if (i > 0) {
          const a = (i - 1) * 2;
          // The ribbon vertices are ordered left/right across the road. Use
          // top-facing winding so FrontSide road materials render from above.
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const key = `${rp.color}|${hw}|${markingProfile.lanes}|${markingProfile.oneWay ? 1 : 0}`;
      if (!decalByKey.has(key)) decalByKey.set(key, { color: rp.color, highway: hw, markingProfile, geos: [] });
      decalByKey.get(key).geos.push(geo);
    }
    for (const { color, highway, markingProfile, geos } of decalByKey.values()) {
      const merged = mergeGeometries(geos, false);
      merged.computeVertexNormals();
      roadDecals.push({ color, highway, markingProfile, geo: geoToTransfer(merged) });
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
      let cy = Number.isFinite(fp.fixedY) ? fp.fixedY : 0;
      if (!Number.isFinite(fp.fixedY)) {
        for (const r of ring) cy = Math.max(cy, groundHeight(r.x, r.z));
      }
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

  return {
    result,
    transfers: collectTransfers(result),
    queryMetrics: poiRoadQueryProfile ? {
      roadPoiQueryMs: poiRoadQueryProfile.durationMs,
      roadPoiQueries: poiRoadQueryProfile.queryCount,
      roadSegmentTests: poiRoadQueryProfile.segmentTests,
      roadFullScanSegmentTests: poiRoadQueryProfile.segmentsPerQuery * poiRoadQueryProfile.queryCount,
      roadPathCount: poiRoadQueryProfile.roadPathCount,
      roadIndexBuildMs: poiRoadQueryProfile.indexBuildMs,
      indexedRoadSegments: poiRoadQueryProfile.indexedRoadSegments,
      roadQueryMode: poiRoadQueryProfile.mode,
      poiCount: pois.length,
    } : null,
  };
}

export { collectTransfers, geoToTransfer };
