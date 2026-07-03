export function createGroundHeight(terrainTiles) {
  let lastKey = '';
  let lastHeight = 0;

  const groundHeight = (x, z) => {
    const fx = Math.floor(x / 100);
    const fz = Math.floor(z / 100);
    const key = `${fx},${fz},${Math.round(x * 4)},${Math.round(z * 4)}`;
    if (key === lastKey) return lastHeight;

    for (const t of terrainTiles.values()) {
      if (x >= t.x0 && x < t.x0 + t.sizeX && z >= t.z0 && z < t.z0 + t.sizeZ) {
        const N = t.n;
        const lfx = ((x - t.x0) / t.sizeX) * (N - 1);
        const lfz = ((z - t.z0) / t.sizeZ) * (N - 1);
        const ix = Math.min(N - 2, Math.floor(lfx));
        const iz = Math.min(N - 2, Math.floor(lfz));
        const dx = lfx - ix;
        const dz = lfz - iz;
        const h = (a, b) => t.heights[b * N + a];
        lastKey = key;
        lastHeight =
          h(ix, iz) * (1 - dx) * (1 - dz) +
          h(ix + 1, iz) * dx * (1 - dz) +
          h(ix, iz + 1) * (1 - dx) * dz +
          h(ix + 1, iz + 1) * dx * dz;
        return lastHeight;
      }
    }
    return 0;
  };

  return groundHeight;
}
