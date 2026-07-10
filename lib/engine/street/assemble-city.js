// Main-thread assembly of worker-built city geometry (plan 19.1).
// Canvas road paint, bridges, stations, props, and scene.add stay here.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { placeProps } from "@/lib/engine/props";
import { makeRailTexture } from "@/lib/engine/textures";
import {
  getBuildingMaterial,
  getRoofMaterial,
  getRoadMaterial,
  getRailMaterial,
  getSimpleStandard,
} from "@/lib/engine/materials";
import { geometryFromTransfer } from "@/lib/engine/city-builder";
import { placeOutsideBuilding } from "@/lib/engine/population";

function toV2(pts) {
  return pts.map((p) => new THREE.Vector2(p.x, p.y));
}

/**
 * @param {object} built — result from runCityBuilder / buildCityGeometry
 * @param {object} ctx
 */
export async function assembleCityFromBuild(built, ctx) {
  const {
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
  } = ctx;
  // Streamed neighbor cells: parent meshes under `root`, append meta, don't
  // teleport the player onto that cell's nearest road.
  const root = ctx.root || scene;
  const appendMeta = !!ctx.appendMeta;
  const cellKey = ctx.cellKey || null;
  const skipOverture = !!ctx.skipOverture;
  const skipPlayerSpawn = !!ctx.skipPlayerSpawn || appendMeta;

  const {
    walls, roofCaps, pitchedRoofs, clutter, livedIn, roadDecals, flats, trees,
    tris, buildingCount, meta,
  } = built;
  const {
    roadPaths, buildingRings, roadPoints, props, stations, bridges, rails,
    barrierWays, powerLines, waterways, crossings, footprints,
  } = meta;

  for (const fp of footprints) addFootprint(fp.ring, { id: fp.id, tags: fp.tags, cellKey });

  if (!appendMeta) engineRef.current.buildingMats = [];
  else if (!engineRef.current.buildingMats) engineRef.current.buildingMats = [];
  for (const batch of walls) {
    const geo = geometryFromTransfer(batch.geo);
    const bMat = getBuildingMaterial({ color: batch.color, materialKey: batch.materialKey });
    engineRef.current.buildingMats.push(bMat);
    const bMesh = new THREE.Mesh(geo, bMat);
    bMesh.castShadow = true;
    bMesh.receiveShadow = true;
    root.add(bMesh);
  }
  for (const batch of roofCaps) {
    const capMesh = new THREE.Mesh(geometryFromTransfer(batch.geo), getRoofMaterial(batch.color, false));
    capMesh.castShadow = true;
    capMesh.receiveShadow = true;
    root.add(capMesh);
  }
  let pitchedCount = 0;
  for (const batch of pitchedRoofs) {
    pitchedCount++;
    const rMesh = new THREE.Mesh(geometryFromTransfer(batch.geo), getRoofMaterial(batch.color, true));
    rMesh.castShadow = true;
    rMesh.receiveShadow = true;
    root.add(rMesh);
  }
  if (pitchedCount) console.log(`[roofs] ${pitchedCount} pitched roof batches`);
  if (clutter) {
    const cMesh = new THREE.Mesh(
      geometryFromTransfer(clutter),
      getSimpleStandard(0xb8bcc2, { roughness: 0.8 })
    );
    cMesh.castShadow = true;
    root.add(cMesh);
  }
  if (livedIn?.geo) {
    const liMesh = new THREE.Mesh(
      geometryFromTransfer(livedIn.geo),
      getSimpleStandard(0xffffff, { roughness: 0.75 })
    );
    // vertex colors carry awning/furniture tint
    liMesh.material.vertexColors = true;
    liMesh.castShadow = true;
    root.add(liMesh);
    console.log(`[lived-in] ${livedIn.awnings} awnings, ${livedIn.furniture} furniture`);
  }

  for (const batch of roadDecals) {
    const merged = geometryFromTransfer(batch.geo);
    const mesh = new THREE.Mesh(
      merged,
      getRoadMaterial(batch.color, false, batch.highway)
    );
    mesh.material.side = THREE.DoubleSide;
    mesh.renderOrder = 1;
    root.add(mesh);
  }

  for (const batch of flats) {
    root.add(new THREE.Mesh(
      geometryFromTransfer(batch.geo),
      getSimpleStandard(batch.color, {
        roughness: batch.color === 0x6fa8d8 || batch.color === 0x39a0e0 ? 0.15 : 0.85,
        metalness: batch.color === 0x6fa8d8 || batch.color === 0x39a0e0 ? 0.05 : 0,
      })
    ));
  }

  if (trees?.count) {
    const canopy = new THREE.ConeGeometry(1.6, 3.6, 6);
    canopy.translate(0, 4.2, 0);
    const trunk = new THREE.CylinderGeometry(0.22, 0.28, 2.6, 5);
    trunk.translate(0, 1.3, 0);
    const cCol = new Float32Array(canopy.attributes.position.count * 3).fill(0);
    for (let i = 0; i < cCol.length; i += 3) { cCol[i] = 0.28; cCol[i + 1] = 0.52; cCol[i + 2] = 0.25; }
    const tCol = new Float32Array(trunk.attributes.position.count * 3);
    for (let i = 0; i < tCol.length; i += 3) { tCol[i] = 0.42; tCol[i + 1] = 0.30; tCol[i + 2] = 0.20; }
    canopy.setAttribute("color", new THREE.BufferAttribute(cCol, 3));
    trunk.setAttribute("color", new THREE.BufferAttribute(tCol, 3));
    const treeGeo = mergeGeometries([trunk, canopy], false);
    const inst = new THREE.InstancedMesh(
      treeGeo,
      getSimpleStandard(0xffffff, { roughness: 0.9 }),
      trees.count
    );
    inst.material.vertexColors = true;
    inst.material.flatShading = true;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < trees.count; i++) {
      m4.fromArray(trees.matrices, i * 16);
      inst.setMatrixAt(i, m4);
    }
    root.add(inst);
  }
  window.__streetTriangles = Math.round(tris || 0);

  // ---- ROAD MASK: hide OSM raster roads under 3D asphalt ribbons ----
  // Do NOT paint yellow dashes / decorative fills here — ribbons own the look.
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
    // Building contact shadows
    tc.g.save();
    tc.g.shadowColor = "rgba(0,0,0,0.55)";
    tc.g.shadowBlur = 7;
    tc.g.fillStyle = "rgba(20,22,26,0.30)";
    for (const ring of buildingRings) {
      tc.g.beginPath();
      for (let i = 0; i < ring.length; i++) {
        const px = (ring[i][0] - tc.x0) * sx;
        const py = (ring[i][1] - tc.z0) * sz;
        if (i === 0) tc.g.moveTo(px, py);
        else tc.g.lineTo(px, py);
      }
      tc.g.closePath();
      tc.g.fill();
    }
    tc.g.restore();
    // Solid asphalt underpaint — covers OSM map roads so they don't bleed through
    for (const rp of roadPaths) {
      const hw = rp.tags?.highway || "";
      const isPath = /^(footway|path|pedestrian|track|cycleway)$/.test(hw);
      trace(tc, rp.pts, sx, sz);
      tc.g.strokeStyle = isPath ? "rgba(138,126,98,0.95)" : "rgba(58,62,70,0.97)";
      // Slightly wider than the ribbon so no basemap edge (or leftover glyphs) peeks out
      tc.g.lineWidth = Math.max(3, rp.width * sx * 1.35);
      tc.g.stroke();
    }
    // Zebra crossings stay on the ground canvas (no mesh yet)
    for (const cr of crossings) {
      let best = null;
      for (const rp of roadPaths) {
        for (let i = 0; i < rp.pts.length - 1; i++) {
          const a = rp.pts[i], b = rp.pts[i + 1];
          const ddx = b.x - a.x, ddz = b.y - a.y;
          const L2 = ddx * ddx + ddz * ddz || 1;
          let tt = ((cr.x - a.x) * ddx + (cr.z - a.y) * ddz) / L2;
          tt = Math.max(0, Math.min(1, tt));
          const qx = a.x + ddx * tt, qz = a.y + ddz * tt;
          const d = Math.hypot(cr.x - qx, cr.z - qz);
          if (d < 12 && (!best || d < best.d))
            best = { d, ang: Math.atan2(ddz, ddx), width: rp.width || 6 };
        }
      }
      if (!best) continue;
      const px = (cr.x - tc.x0) * sx, py = (cr.z - tc.z0) * sz;
      if (px < -20 || py < -20 || px > tc.w + 20 || py > tc.w + 20) continue;
      tc.g.save();
      tc.g.translate(px, py);
      tc.g.rotate(best.ang);
      tc.g.fillStyle = "rgba(245,245,240,0.92)";
      const wpx = best.width * sx * 0.92;
      const bar = Math.max(1.2, 0.55 * sx);
      const gap = bar * 1.1;
      for (let k = -2; k <= 2; k++) {
        tc.g.fillRect(k * (bar + gap) - bar / 2, -wpx / 2, bar, wpx);
      }
      tc.g.restore();
    }
    tc.texture.needsUpdate = true;
  }

  // ---- RAILS ----
  if (rails.length) {
    const geos = [];
    for (const r of rails) {
      const raw = toV2(r.pts);
      const pts = [];
      for (let i = 0; i < raw.length; i++) {
        pts.push(raw[i]);
        if (i < raw.length - 1) {
          const d = raw[i].distanceTo(raw[i + 1]);
          const steps = Math.min(24, Math.floor(d / 9));
          for (let k = 1; k <= steps; k++)
            pts.push(new THREE.Vector2().lerpVectors(raw[i], raw[i + 1], k / (steps + 1)));
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
      const railMat = getRailMaterial();
      railMat.side = THREE.DoubleSide;
      railMat.polygonOffset = true;
      railMat.polygonOffsetFactor = -4;
      railMat.polygonOffsetUnits = -4;
      const m = new THREE.Mesh(merged, railMat);
      m.renderOrder = 1;
      root.add(m);
    }
  }

  // ---- WATERWAY RIBBONS ----
  if (waterways.length) {
    const geos = [];
    for (const wline of waterways) {
      const raw = toV2(wline.pts);
      const pts = [];
      for (let i = 0; i < raw.length; i++) {
        pts.push(raw[i]);
        if (i < raw.length - 1) {
          const d = raw[i].distanceTo(raw[i + 1]);
          const steps = Math.min(24, Math.floor(d / 10));
          for (let k = 1; k <= steps; k++)
            pts.push(new THREE.Vector2().lerpVectors(raw[i], raw[i + 1], k / (steps + 1)));
        }
      }
      if (pts.length < 2) continue;
      const half = wline.width / 2;
      const v = [], idx = [];
      for (let i = 0; i < pts.length; i++) {
        const dir = new THREE.Vector2();
        if (i === 0) dir.subVectors(pts[1], pts[0]);
        else if (i === pts.length - 1) dir.subVectors(pts[i], pts[i - 1]);
        else dir.subVectors(pts[i + 1], pts[i - 1]);
        dir.normalize();
        const nx = -dir.y * half, nz = dir.x * half;
        const lx = pts[i].x + nx, lz = pts[i].y + nz;
        const rx = pts[i].x - nx, rz = pts[i].y - nz;
        v.push(lx, groundHeight(lx, lz) - 0.4, lz, rx, groundHeight(rx, rz) - 0.4, rz);
        if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
      g2.setIndex(idx);
      geos.push(g2);
    }
    if (geos.length) {
      const merged = mergeGeometries(geos, false);
      merged.computeVertexNormals();
      const m = new THREE.Mesh(
        merged,
        getSimpleStandard(0x5fa0d4, { roughness: 0.2, metalness: 0.05 })
      );
      m.material.side = THREE.DoubleSide;
      m.material.polygonOffset = true;
      m.material.polygonOffsetFactor = -3;
      m.material.polygonOffsetUnits = -3;
      m.renderOrder = 1;
      root.add(m);
    }
  }

  // ---- BRIDGES ----
  const bridgeDecks = [];
  {
    const deckMat = getRoadMaterial(0x6d737c, true);
    deckMat.transparent = false;
    deckMat.depthWrite = true;
    const railMat = getSimpleStandard(0x8b939e, { roughness: 0.7, metalness: 0.2 });
    const pillarMat = getSimpleStandard(0x9aa0a8, { roughness: 0.85 });
    const railTex2 = makeRailTexture();
    for (const br of bridges) {
      if (br.pts.length < 2) continue;
      const P = toV2(br.pts);
      const cum = [0];
      for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + P[i].distanceTo(P[i - 1]));
      const len = cum[cum.length - 1] || 1;
      const e0 = groundHeight(P[0].x, P[0].y);
      const e1 = groundHeight(P[P.length - 1].x, P[P.length - 1].y);
      const deckLevel = Math.max(e0, e1) + 2.5;
      const y0 = deckLevel;
      const y1 = deckLevel;
      const halfW = br.width / 2;
      const deckY = (t) => y0 + (y1 - y0) * t;
      const v = [], uv = [], idx = [];
      const rv = [], ridx = [];
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
      const deck = new THREE.Mesh(
        dg,
        br.isRail
          ? new THREE.MeshStandardMaterial({ map: railTex2, roughness: 0.85, metalness: 0.15 })
          : deckMat
      );
      deck.material.side = THREE.DoubleSide;
      root.add(deck);
      const rg = new THREE.BufferGeometry();
      rg.setAttribute("position", new THREE.Float32BufferAttribute(rv, 3));
      rg.setIndex(ridx);
      rg.computeVertexNormals();
      railMat.side = THREE.DoubleSide;
      root.add(new THREE.Mesh(rg, railMat));
      {
        const gv = [], gidx = [];
        for (let i = 0; i < P.length; i++) {
          const t = cum[i] / len;
          const dir = new THREE.Vector2();
          if (i === 0) dir.subVectors(P[1], P[0]);
          else if (i === P.length - 1) dir.subVectors(P[i], P[i - 1]);
          else dir.subVectors(P[i + 1], P[i - 1]);
          dir.normalize();
          const nx = -dir.y * halfW, nz = dir.x * halfW;
          const y = deckY(t);
          gv.push(P[i].x + nx, y, P[i].y + nz, P[i].x + nx, y - 1.1, P[i].y + nz);
          gv.push(P[i].x - nx, y, P[i].y - nz, P[i].x - nx, y - 1.1, P[i].y - nz);
          if (i > 0) {
            const b2 = (i - 1) * 4;
            gidx.push(b2, b2 + 1, b2 + 4, b2 + 1, b2 + 5, b2 + 4);
            gidx.push(b2 + 2, b2 + 3, b2 + 6, b2 + 3, b2 + 7, b2 + 6);
          }
        }
        const gg = new THREE.BufferGeometry();
        gg.setAttribute("position", new THREE.Float32BufferAttribute(gv, 3));
        gg.setIndex(gidx);
        gg.computeVertexNormals();
        root.add(new THREE.Mesh(gg, getSimpleStandard(0x4a5058, { roughness: 0.8 })));
      }
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
        root.add(pil);
      }
      bridgeDecks.push({ pts: P, halfW: halfW + 0.3, y0, y1, len, cum });
    }
  }
  engineRef.current.bridgeDecks = bridgeDecks;

  // ---- STATIONS ----
  {
    const platMat = getSimpleStandard(0xb9b2a4, { roughness: 0.85 });
    const roofMat = getRoofMaterial(0x7c4a3a, true);
    const postMat = getSimpleStandard(0x555b64, { roughness: 0.7, metalness: 0.15 });
    for (const st of stations.slice(0, 6)) {
      const gy2 = groundHeight(st.x, st.z);
      const plat = new THREE.Mesh(new THREE.BoxGeometry(26, 0.9, 6), platMat);
      plat.position.set(st.x, gy2 + 0.45, st.z);
      root.add(plat);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(24, 0.3, 5), roofMat);
      roof.position.set(st.x, gy2 + 4.3, st.z);
      root.add(roof);
      for (const [ox, oz] of [[-10, -2], [10, -2], [-10, 2], [10, 2]]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 3.4, 6), postMat);
        post.position.set(st.x + ox, gy2 + 2.5, st.z + oz);
        root.add(post);
      }
      const c2 = document.createElement("canvas");
      const label = "🚉 " + String(st.name || "Station");
      const font = "bold 42px system-ui, sans-serif";
      const mctx = document.createElement("canvas").getContext("2d");
      mctx.font = font;
      const tw = Math.ceil(mctx.measureText(label).width);
      c2.width = Math.min(720, Math.max(200, tw + 48));
      c2.height = 96;
      const g3 = c2.getContext("2d");
      g3.fillStyle = "rgba(18,42,80,0.92)";
      g3.fillRect(0, 0, c2.width, 96);
      g3.strokeStyle = "#ffd75e";
      g3.lineWidth = 5;
      g3.strokeRect(4, 4, c2.width - 8, 88);
      g3.fillStyle = "#ffffff";
      g3.font = font;
      g3.textAlign = "center";
      g3.textBaseline = "middle";
      g3.fillText(label, c2.width / 2, 50);
      const tex = new THREE.CanvasTexture(c2);
      tex.colorSpace = THREE.SRGBColorSpace;
      const placed = placeOutsideBuilding(st.x, st.z, insideBuilding, {
        roadPaths: roadPaths || [],
      });
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const worldW = Math.min(28, 10 + label.length * 0.45);
      const worldH = worldW * (96 / c2.width);
      const sp = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH), mat);
      const gySign = groundHeight(placed.x, placed.z);
      sp.position.set(placed.x, gySign + 6.5, placed.z);
      const fx = placed.faceX ?? 0;
      const fz = placed.faceZ ?? 1;
      sp.rotation.y = Math.atan2(fx, fz);
      sp.renderOrder = 2;
      root.add(sp);
    }
  }

  // ---- OVERTURE FALLBACK ----
  console.info(`[street] OSM buildings: ${buildingCount}`);
  if (!skipOverture && buildingCount < 120) {
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
          if (insideBuilding(cx2, cz2)) continue;
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
          const oMat = getBuildingMaterial({ color: 0xded6c6, materialKey: "concrete" });
          engineRef.current.buildingMats.push(oMat);
          root.add(new THREE.Mesh(merged2, oMat));
          console.info(`[overture] added ${geos2.length} buildings`);
        }
      }
    } catch { /* optional */ }
  }

  placeProps(props, { scene: root, groundHeight, spinners, lampGlows });
  if (appendMeta) {
    engineRef.current.spinners = [...(engineRef.current.spinners || []), ...spinners];
    engineRef.current.roadPaths = [...(engineRef.current.roadPaths || []), ...roadPaths];
    engineRef.current.propMarkers = [...(engineRef.current.propMarkers || []), ...props];
    engineRef.current.pois = [...(engineRef.current.pois || []), ...(meta.pois || [])];
    engineRef.current.lampGlows = [...(engineRef.current.lampGlows || []), ...lampGlows];
  } else {
    engineRef.current.spinners = spinners;
    engineRef.current.roadPaths = roadPaths;
    engineRef.current.propMarkers = props;
    engineRef.current.pois = meta.pois;
    engineRef.current.lampGlows = lampGlows;
  }

  const lampPts = props.filter((p) => p.kind === "lamp");
  if (lampPts.length) {
    const pc = document.createElement("canvas");
    pc.width = pc.height = 128;
    const pg2 = pc.getContext("2d");
    const grad = pg2.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, "rgba(255,214,130,0.55)");
    grad.addColorStop(0.5, "rgba(255,205,110,0.22)");
    grad.addColorStop(1, "rgba(255,200,100,0)");
    pg2.fillStyle = grad;
    pg2.fillRect(0, 0, 128, 128);
    const poolTex = new THREE.CanvasTexture(pc);
    const poolMat = new THREE.MeshBasicMaterial({
      map: poolTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const poolGeo = new THREE.CircleGeometry(4.2, 20).rotateX(-Math.PI / 2);
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, Math.min(lampPts.length, 400));
    const pm = new THREE.Matrix4();
    for (let i = 0; i < pools.count; i++) {
      const lp = lampPts[i];
      pm.setPosition(lp.x, groundHeight(lp.x, lp.z) + 0.08, lp.z);
      pools.setMatrixAt(i, pm);
    }
    pools.renderOrder = 5;
    root.add(pools);
    engineRef.current.lampPools = poolMat;
  }

  // ---- BARRIERS ----
  {
    const mats = {
      wall: getSimpleStandard(0xb0a894, { roughness: 0.9 }),
      city_wall: getSimpleStandard(0xa89a80, { roughness: 0.9 }),
      fence: getSimpleStandard(0x8a7f6e, { roughness: 0.8 }),
      hedge: getSimpleStandard(0x4b7a45, { roughness: 0.95 }),
    };
    mats.wall.side = THREE.DoubleSide;
    mats.city_wall.side = THREE.DoubleSide;
    mats.fence.side = THREE.DoubleSide;
    mats.fence.transparent = true;
    mats.fence.opacity = 0.75;
    mats.hedge.side = THREE.DoubleSide;
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
      root.add(new THREE.Mesh(g2, mats[bw.kind] || mats.wall));
    }
  }

  // ---- POWER LINES ----
  {
    const wireMat = new THREE.LineBasicMaterial({ color: 0x30343a });
    for (const pl of powerLines) {
      const P = pl.pts;
      if (P.length < 2) continue;
      for (const dy of [-1.2, 0, 1.2]) {
        const pts3 = [];
        for (const q2 of P) pts3.push(new THREE.Vector3(q2.x + dy * 0.3, groundHeight(q2.x, q2.z) + 20.5, q2.z + dy * 0.3));
        const g3 = new THREE.BufferGeometry().setFromPoints(pts3);
        root.add(new THREE.Line(g3, wireMat));
      }
    }
  }

  if (!skipPlayerSpawn) {
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
  }
}
