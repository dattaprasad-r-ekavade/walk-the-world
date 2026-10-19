export function createGroundHeight(terrainTiles) {
  // Tiles are keyed "tx/ty" but queried in local meters, so there is no direct
  // index; callers sample the same tile for long runs, so remember the last
  // hit (validated against the live map: tiles can be evicted) before scanning.
  let lastKey = null, lastTile = null;
  const contains = (t, x, z) => x >= t.x0 && x < t.x0 + t.sizeX && z >= t.z0 && z < t.z0 + t.sizeZ;
  const findTile = (x, z) => {
    if (lastTile && terrainTiles.get(lastKey) === lastTile && contains(lastTile, x, z)) return lastTile;
    for (const [k, t] of terrainTiles) {
      if (contains(t, x, z)) { lastKey = k; lastTile = t; return t; }
    }
    return null;
  };
  const groundHeight = (x, z) => {
    {
      const t = findTile(x, z);
      if (t) {
        const N = t.n;
        const lfx = ((x - t.x0) / t.sizeX) * (N - 1);
        const lfz = ((z - t.z0) / t.sizeZ) * (N - 1);
        const ix = Math.min(N - 2, Math.floor(lfx));
        const iz = Math.min(N - 2, Math.floor(lfz));
        const dx = lfx - ix;
        const dz = lfz - iz;
        const H = t.heights;
        return (
          H[iz * N + ix] * (1 - dx) * (1 - dz) +
          H[iz * N + ix + 1] * dx * (1 - dz) +
          H[(iz + 1) * N + ix] * (1 - dx) * dz +
          H[(iz + 1) * N + ix + 1] * dx * dz
        );
      }
    }
    return 0;
  };

  return groundHeight;
}

// Flatten a circular patch of terrain to `height` (smooth falloff at edge).
// Mutates the heightmap arrays; if tile meshes are registered, their
// geometry Y values are updated in place.
export function createTerrainPatcher(terrainTiles, tileMeshes = []) {
  return function patchTerrain(cx, cz, radius, height) {
    for (const [key, t] of terrainTiles) {
      const N = t.n;
      let touched = false;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const wx = t.x0 + (i / (N - 1)) * t.sizeX;
          const wz = t.z0 + (j / (N - 1)) * t.sizeZ;
          const d = Math.hypot(wx - cx, wz - cz);
          if (d > radius) continue;
          const f = 1 - (d / radius) ** 2; // smooth falloff
          t.heights[j * N + i] = t.heights[j * N + i] * (1 - f) + height * f;
          touched = true;
        }
      }
      if (touched) {
        const rec = tileMeshes.find((m) => m.key === key);
        if (rec) {
          const pos = rec.mesh.geometry.attributes.position;
          for (let j = 0; j < N; j++)
            for (let i = 0; i < N; i++) pos.setY(j * N + i, t.heights[j * N + i]);
          pos.needsUpdate = true;
          rec.mesh.geometry.computeVertexNormals();
        }
      }
    }
  };
}
