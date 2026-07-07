export function createGroundHeight(terrainTiles) {
  const groundHeight = (x, z) => {
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
        return (
          h(ix, iz) * (1 - dx) * (1 - dz) +
          h(ix + 1, iz) * dx * (1 - dz) +
          h(ix, iz + 1) * (1 - dx) * dz +
          h(ix + 1, iz + 1) * dx * dz
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
