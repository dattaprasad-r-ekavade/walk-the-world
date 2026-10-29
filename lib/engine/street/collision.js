/** Even-odd point-in-polygon over `[[x, z], ...]`. */
export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (
      ring[i][1] > z !== ring[j][1] > z &&
      x < ((ring[j][0] - ring[i][0]) * (z - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]
    )
      inside = !inside;
  }
  return inside;
}

export function createCollision(GRID = 60) {
  const footprintGrid = new Map();
  const byCell = new Map(); // cellKey -> footprints, so unloading never scans the whole grid

  const gridKey = (x, z) => `${Math.floor(x / GRID)},${Math.floor(z / GRID)}`;

  const addFootprint = (poly, meta = null) => {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const [px, pz] of poly) {
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minZ = Math.min(minZ, pz);
      maxZ = Math.max(maxZ, pz);
    }
    const fp = { poly, minX, maxX, minZ, maxZ, meta };
    const ck = meta?.cellKey;
    if (ck) {
      if (!byCell.has(ck)) byCell.set(ck, []);
      byCell.get(ck).push(fp);
    }
    for (let gx = Math.floor(minX / GRID); gx <= Math.floor(maxX / GRID); gx++) {
      for (let gz = Math.floor(minZ / GRID); gz <= Math.floor(maxZ / GRID); gz++) {
        const k = `${gx},${gz}`;
        if (!footprintGrid.has(k)) footprintGrid.set(k, []);
        footprintGrid.get(k).push(fp);
      }
    }
  };

  /** Drop footprints tagged with cellKey (used when streaming cells unload). */
  const removeFootprintsByCell = (cellKey) => {
    if (!cellKey) return;
    const fps = byCell.get(cellKey);
    if (!fps) return;
    byCell.delete(cellKey);
    const drop = new Set(fps);
    const touched = new Set();
    for (const fp of fps) {
      for (let gx = Math.floor(fp.minX / GRID); gx <= Math.floor(fp.maxX / GRID); gx++)
        for (let gz = Math.floor(fp.minZ / GRID); gz <= Math.floor(fp.maxZ / GRID); gz++)
          touched.add(`${gx},${gz}`);
    }
    for (const k of touched) {
      const list = footprintGrid.get(k);
      if (!list) continue;
      const next = list.filter((fp) => !drop.has(fp));
      if (next.length) footprintGrid.set(k, next);
      else footprintGrid.delete(k);
    }
  };

  // debug helper: which footprint (with meta) contains this point?
  const footprintAt = (x, z) => {
    const list = footprintGrid.get(gridKey(x, z));
    if (!list) return null;
    for (const fp of list) {
      if (x < fp.minX || x > fp.maxX || z < fp.minZ || z > fp.maxZ) continue;
      if (pointInRing(x, z, fp.poly)) return fp;
    }
    return null;
  };

  const insideBuilding = (x, z) => {
    const list = footprintGrid.get(gridKey(x, z));
    if (!list) return false;
    for (const fp of list) {
      if (x < fp.minX || x > fp.maxX || z < fp.minZ || z > fp.maxZ) continue;
      if (pointInRing(x, z, fp.poly)) return true;
    }
    return false;
  };

  // unique footprints whose grid buckets overlap the r-radius box around (x, z)
  const footprintsNear = (x, z, r) => {
    const out = new Set();
    for (let gx = Math.floor((x - r) / GRID); gx <= Math.floor((x + r) / GRID); gx++)
      for (let gz = Math.floor((z - r) / GRID); gz <= Math.floor((z + r) / GRID); gz++)
        for (const fp of footprintGrid.get(`${gx},${gz}`) || [])
          if (fp.maxX >= x - r && fp.minX <= x + r && fp.maxZ >= z - r && fp.minZ <= z + r) out.add(fp);
    return [...out];
  };

  return { addFootprint, insideBuilding, footprintAt, footprintsNear, footprintGrid, removeFootprintsByCell };
}
