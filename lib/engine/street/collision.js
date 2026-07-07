export function createCollision(GRID = 60) {
  const footprintGrid = new Map();

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
    for (let gx = Math.floor(minX / GRID); gx <= Math.floor(maxX / GRID); gx++) {
      for (let gz = Math.floor(minZ / GRID); gz <= Math.floor(maxZ / GRID); gz++) {
        const k = `${gx},${gz}`;
        if (!footprintGrid.has(k)) footprintGrid.set(k, []);
        footprintGrid.get(k).push(fp);
      }
    }
  };

  // debug helper: which footprint (with meta) contains this point?
  const footprintAt = (x, z) => {
    const list = footprintGrid.get(gridKey(x, z));
    if (!list) return null;
    for (const fp of list) {
      if (x < fp.minX || x > fp.maxX || z < fp.minZ || z > fp.maxZ) continue;
      let inside = false;
      const p = fp.poly;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        if (
          p[i][1] > z !== p[j][1] > z &&
          x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]
        ) {
          inside = !inside;
        }
      }
      if (inside) return fp;
    }
    return null;
  };

  const insideBuilding = (x, z) => {
    const list = footprintGrid.get(gridKey(x, z));
    if (!list) return false;
    for (const fp of list) {
      if (x < fp.minX || x > fp.maxX || z < fp.minZ || z > fp.maxZ) continue;
      let inside = false;
      const p = fp.poly;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        if (
          p[i][1] > z !== p[j][1] > z &&
          x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]
        ) {
          inside = !inside;
        }
      }
      if (inside) return true;
    }
    return false;
  };

  return { addFootprint, insideBuilding, footprintAt, footprintGrid };
}
