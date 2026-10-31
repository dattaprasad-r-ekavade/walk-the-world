import * as THREE from "three";
import { lon2tx, lat2ty } from "@/lib/engine/geo";
import { createGroundHeight, createTerrainPatcher } from "./ground-height";
import { drawGroundTileImage, groundTileUrl } from "@/lib/engine/ground-tiles";
import { decodeTerrariumHeightGrid, terrainTileLocalBounds, TERRARIUM_GRID_SIZE } from "./terrain-grid";
import { STREET } from "./constants";
import { recordPerfTiming } from "@/lib/perf";
import { decodeTerrainImageBlob, loadCorsImage, loadTerrainImageSource, releaseImage, takeSpawnTerrainPrefetch, terrariumTileUrl } from "./terrain-prefetch";
import { resolveTerrainGrid } from "./terrain-grid-cache";

/** Owns terrain data, image requests, and editor height patches for one scene. */

let _groundDetailTex = null;
function getGroundDetailTex() {
  if (_groundDetailTex || typeof document === "undefined") return _groundDetailTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const im = g.createImageData(128, 128);
  for (let i = 0; i < im.data.length; i += 4) {
    const v = 175 + Math.random() * 80; // mean ~1 after /215
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
    im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  _groundDetailTex = t;
  return t;
}

/** Near-field grain: multiplies diffuse by a world-space tiled noise (~2 m), faded by 80 m. */
function applyGroundDetail(mat) {
  let tex = null;
  try { tex = getGroundDetailTex(); } catch { /* no canvas: stock material */ }
  if (!tex) return;
  mat.onBeforeCompile = (shader) => {
    try {
      shader.uniforms.uDetail = { value: tex };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>
varying vec3 vGWorld;`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>
vGWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
varying vec3 vGWorld;
uniform sampler2D uDetail;`)
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          {
            float gd = texture2D(uDetail, vGWorld.xz * 0.5).r * 1.16 * 0.5
                     + texture2D(uDetail, vGWorld.xz * 0.07).r * 1.16 * 0.5;
            float gf = 1.0 - smoothstep(30.0, 80.0, length(vViewPosition));
            diffuseColor.rgb *= mix(1.0, gd, gf);
          }`
        );
    } catch {
      /* keep stock shader */
    }
  };
  mat.customProgramCacheKey = () => "ground-detail-v1";
}

export function createTerrainSystem({ scene, lat0, lon0, toLocal, groundSource, signal, onStage, onProgress }) {
  const Z = STREET.TERRAIN_Z;
  const terrainTiles = new Map(), tileMeshes = [], tileCanvases = [];
  let groundHeight = () => 0, patchTerrain = () => {};
    const terrainHeightJobs = new Map();
    const terrainVisualJobs = new Map();
    const terrainVisualized = new Set();
    const loadTerrain = async () => {
      onStage("Streaming terrain…"); onProgress(15);
      const ctx = Math.floor(lon2tx(lon0, Z));
      const cty = Math.floor(lat2ty(lat0, Z));
      // Only the center tile is on the critical path. The surrounding eight
      // tiles are visual/terrain upgrades and can stream after the player is
      // already walking; waiting for their 36 imagery requests made cold
      // starts look like a frozen game on slower browsers.
      // Elevation is also non-critical for first paint. Start the center
      // request, but let the flat fallback carry the player until it arrives.
      const centerJob = loadTerrainTile(ctx, cty, true);
      // Give elevation a short head start for accurate building placement, but
      // never let a slow tile CDN block the world indefinitely.
      await Promise.race([centerJob, new Promise((resolve) => setTimeout(resolve, 2000))]);
      if (signal.aborted) return;
      groundHeight = createGroundHeight(terrainTiles);

      patchTerrain = createTerrainPatcher(terrainTiles, tileMeshes);
      onProgress(55);
      // Start one surrounding visual tile per browser frame. These meshes each
      // carry a canvas texture; adding all eight together can make the first
      // rendered frame upload several large canvases at once on weak GPUs.
      // Cardinal neighbours are useful first while the diagonals stream in.
      const streamNeighbors = async () => {
        const jobs = [centerJob];
        const offsets = [
          [1, 0], [-1, 0], [0, 1], [0, -1],
          [1, 1], [1, -1], [-1, 1], [-1, -1],
        ];
        for (const [dx, dy] of offsets) {
          if (signal.aborted) break;
          jobs.push(loadTerrainTile(ctx + dx, cty + dy, false));
          await new Promise((resolve) => {
            if (typeof requestAnimationFrame === "function") requestAnimationFrame(resolve);
            else setTimeout(resolve, 16);
          });
        }
        await Promise.all(jobs);
        if (signal.aborted) return;
        groundHeight = createGroundHeight(terrainTiles);
      };
      streamNeighbors().catch(() => {});
    };

    const loadImage = (url) => loadCorsImage(url, signal);

    const loadTerrainHeights = (tx, ty) => {
      const tKey = `${tx}/${ty}`;
      if (terrainTiles.has(tKey)) return Promise.resolve(true);
      if (terrainHeightJobs.has(tKey)) return terrainHeightJobs.get(tKey);
      const job = (async () => {
        try {
        const sourceStartedAt = performance.now();
        // The /street page may already have this request in flight (terrain-prefetch.js).
        // If that early attempt failed, ask once more as before.
        const url = terrariumTileUrl(Z, tx, ty);
        const early = takeSpawnTerrainPrefetch(tKey);
        const source = await (early ? early.catch(() => loadTerrainImageSource(url, signal)) : loadTerrainImageSource(url, signal));
        recordPerfTiming("terrain.height-source", performance.now() - sourceStartedAt, { key: tKey });
        if (signal.aborted) { releaseImage(source?.image); return false; }
        // Downsample the source tile to a stable terrain grid. Keeping one
        // topology across tiers avoids seam/patch mismatches while pixel
        // density is reduced through renderer quality and DPR caps.
        const N = TERRARIUM_GRID_SIZE;
        let heights;
        if (source?.blob) {
          const resolveStartedAt = performance.now();
          const resolved = await resolveTerrainGrid(source.blob, N, async (blob) => {
            const imageStartedAt = performance.now();
            const img = await decodeTerrainImageBlob(blob);
            recordPerfTiming("terrain.height-image-decode", performance.now() - imageStartedAt, { key: tKey });
            if (signal.aborted) { releaseImage(img); throw new Error("Terrain image cancelled"); }
            const pixelsStartedAt = performance.now();
            const c = document.createElement("canvas");
            c.width = c.height = 256;
            const g = c.getContext("2d", { willReadFrequently: true });
            g.drawImage(img, 0, 0);
            releaseImage(img);
            const d = g.getImageData(0, 0, 256, 256).data;
            recordPerfTiming("terrain.height-pixels", performance.now() - pixelsStartedAt, { key: tKey });
            const gridStartedAt = performance.now();
            const grid = decodeTerrariumHeightGrid(d, 256, 256, N);
            recordPerfTiming("terrain.height-grid", performance.now() - gridStartedAt, { key: tKey, gridSize: N });
            return grid;
          });
          heights = resolved.heights;
          recordPerfTiming("terrain.height-grid-resolve", performance.now() - resolveStartedAt, {
            key: tKey,
            gridSize: N,
            cacheHit: resolved.cacheHit,
          });
        } else {
          const img = source?.image;
          if (!img) return false;
          const pixelsStartedAt = performance.now();
          const c = document.createElement("canvas");
          c.width = c.height = 256;
          const g = c.getContext("2d", { willReadFrequently: true });
          g.drawImage(img, 0, 0);
          releaseImage(img);
          const d = g.getImageData(0, 0, 256, 256).data;
          recordPerfTiming("terrain.height-pixels", performance.now() - pixelsStartedAt, { key: tKey });
          const gridStartedAt = performance.now();
          heights = decodeTerrariumHeightGrid(d, 256, 256, N);
          recordPerfTiming("terrain.height-grid", performance.now() - gridStartedAt, { key: tKey, gridSize: N });
        }
        if (signal.aborted) return false;
        const { x0, z0, sizeX, sizeZ } = terrainTileLocalBounds(tx, ty, Z, toLocal);
        terrainTiles.set(tKey, { heights, n: N, x0, z0, sizeX, sizeZ });
        return true;
        } catch {
          /* tile failed; callers may use the flat fallback */
          return false;
        } finally {
          terrainHeightJobs.delete(tKey);
        }
      })();
      terrainHeightJobs.set(tKey, job);
      return job;
    };

    const loadTerrainTile = (tx, ty, isCenter) => {
      const tKey = `${tx}/${ty}`;
      if (terrainVisualized.has(tKey)) return Promise.resolve(true);
      if (terrainVisualJobs.has(tKey)) return terrainVisualJobs.get(tKey);
      const job = (async () => {
        try {
        if (!await loadTerrainHeights(tx, ty) || signal.aborted) return false;
        const tile = terrainTiles.get(tKey);
        const { tl, sizeX, sizeZ } = terrainTileLocalBounds(tx, ty, Z, toLocal);
        const { heights } = tile;
        const N = tile.n;

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

        // Ground imagery (OSM map or Esri satellite) — 2x2 z15 subtiles
        const W = isCenter ? 2048 : 1024; // sharp where the player walks
        const half = W / 2;
        const tex = document.createElement("canvas");
        tex.width = tex.height = W;
        const tg = tex.getContext("2d");
        let overlayCanvas = null;
        let overlayG = null;
        const ensureOverlay = () => {
          if (overlayCanvas) return;
          overlayCanvas = document.createElement("canvas");
          overlayCanvas.width = overlayCanvas.height = W;
          overlayG = overlayCanvas.getContext("2d");
        };
        tg.fillStyle = groundSource === "satellite" ? "#3a4a3a" : "#8d9582";
        tg.fillRect(0, 0, W, W);
        const paintImagery = async (src) => {
          const subs = [];
          for (let sy = 0; sy < 2; sy++)
            for (let sx = 0; sx < 2; sx++)
              subs.push(
                loadImage(groundTileUrl(src, Z + 1, tx * 2 + sx, ty * 2 + sy))
                  .then((im) => {
                    if (!signal.aborted && !entry.disposed) drawGroundTileImage(tg, im, sx * half, sy * half, half, groundSource);
                    releaseImage(im);
                  })
                  .catch(() => {})
              );
          await Promise.all(subs);
          if (!signal.aborted && !entry.disposed) {
            // Imagery can finish after city paint. Restore the retained
            // overlay so roads, shadows and B3 land use stay above the map.
            if (overlayCanvas) tg.drawImage(overlayCanvas, 0, 0);
            texture.needsUpdate = true;
          }
        };
        const texture = new THREE.CanvasTexture(tex);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = isCenter ? 4 : 1;
        const entry = {
          key: tKey,
          disposed: false,
          g: tg,
          texture,
          x0: tl.x,
          z0: tl.z,
          sizeX,
          sizeZ,
          w: W,
          beginOverlayBatch() {
            const batchCanvas = document.createElement("canvas");
            batchCanvas.width = batchCanvas.height = W;
            const batchG = batchCanvas.getContext("2d");
            let finished = false;
            return {
              g: batchG,
              commit() {
                if (finished) return;
                finished = true;
                if (!entry.disposed) {
                  ensureOverlay();
                  overlayG.drawImage(batchCanvas, 0, 0);
                  tg.drawImage(batchCanvas, 0, 0);
                  texture.needsUpdate = true;
                }
                batchCanvas.width = batchCanvas.height = 1;
              },
              discard() {
                if (finished) return;
                finished = true;
                batchCanvas.width = batchCanvas.height = 1;
              },
            };
          },
        };
        tileCanvases.push(entry);
        // Painting imagery is progressive too: the solid fallback texture is
        // immediately renderable and the map tiles replace it when available.
        paintImagery(groundSource).catch(() => {});
        const terrMat = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.95,
          metalness: 0,
          envMapIntensity: 0.3,
        });
        applyGroundDetail(terrMat);
        const mesh = new THREE.Mesh(geo, terrMat);
        mesh.receiveShadow = true;
        const rec = { key: tKey, mesh, skirtMesh: null };
        tileMeshes.push(rec);
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
          rec.skirtMesh = skirtMesh;
        }
        terrainVisualized.add(tKey);
        return true;
        } catch {
          /* visual tile failed; height samples can still support geometry */
          return false;
        } finally {
          terrainVisualJobs.delete(tKey);
        }
      })();
      terrainVisualJobs.set(tKey, job);
      return job;
    };

    // Revision checks need heights only; defer meshes and imagery to normal streaming.
    const ensureHeightTiles = async (keys) => {
      if (!Array.isArray(keys) || !keys.length) return false;
      const results = await Promise.all(keys.map((key) => {
        const [tx, ty] = String(key).split("/").map(Number);
        if (!Number.isInteger(tx) || !Number.isInteger(ty)) return Promise.resolve(false);
        return loadTerrainHeights(tx, ty);
      }));
      groundHeight = createGroundHeight(terrainTiles);
      patchTerrain = createTerrainPatcher(terrainTiles, tileMeshes);
      return results.every(Boolean);
    };

    const ensureTiles = async (keys) => {
      if (!Array.isArray(keys) || !keys.length) return false;
      const results = await Promise.all(keys.map((key) => {
        const [tx, ty] = String(key).split("/").map(Number);
        if (!Number.isInteger(tx) || !Number.isInteger(ty)) return Promise.resolve(false);
        return loadTerrainTile(tx, ty, false);
      }));
      groundHeight = createGroundHeight(terrainTiles);
      patchTerrain = createTerrainPatcher(terrainTiles, tileMeshes);
      return results.every(Boolean);
    };


    /**
     * Unload tiles more than `rings` tiles (Chebyshev) from the player's tile:
     * frees the 1-4 MP ground canvas + GPU texture, geometry and heightmap.
     * groundHeight falls back to 0 over an evicted tile; walking back re-creates
     * it via loadTile (painted roads return as the cells stream back in).
     */
    const evictFar = (ctx, cty, rings = 2) => {
      for (const key of [...terrainTiles.keys()]) {
        const [tx, ty] = key.split("/").map(Number);
        if (Math.max(Math.abs(tx - ctx), Math.abs(ty - cty)) <= rings) continue;
        terrainTiles.delete(key);
        terrainVisualized.delete(key);
        const mi = tileMeshes.findIndex((m) => m.key === key);
        if (mi >= 0) {
          const { mesh, skirtMesh } = tileMeshes[mi];
          tileMeshes.splice(mi, 1);
          scene.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
          if (skirtMesh) {
            scene.remove(skirtMesh);
            skirtMesh.geometry.dispose();
            skirtMesh.material.dispose();
          }
        }
        const ci = tileCanvases.findIndex((c) => c.key === key);
        if (ci >= 0) {
          const c = tileCanvases[ci];
          tileCanvases.splice(ci, 1);
          c.disposed = true;
          c.texture.dispose();
          c.g.canvas.width = c.g.canvas.height = 1; // release the backing store
          if (c.overlayG) c.overlayG.canvas.width = c.overlayG.canvas.height = 1;
        }
      }
    };

  return {
    terrainTiles, tileCanvases, load: loadTerrain, loadTile: loadTerrainTile,
    ensureHeightTiles, ensureTiles, evictFar,
    height: (x,z) => groundHeight(x,z), patch: (...args) => patchTerrain(...args),
    dispose() {
      terrainTiles.clear();
      terrainHeightJobs.clear();
      terrainVisualJobs.clear();
      terrainVisualized.clear();
      tileMeshes.length = 0;
      tileCanvases.length = 0;
    },
  };
}
