import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { getSimpleStandard } from "@/lib/engine/materials";

// Special asset-library names replace the built-in population shapes: upload
// car.glb, bird.glb or pedestrian.glb and traffic/birds/people render with
// those models (instanced, so still one draw call each).
export const POPULATION_MODEL_SPECS = [
  { key: "car", file: "car.glb", target: 4.4, measure: "length" },
  { key: "bird", file: "bird.glb", target: 0.8, measure: "length" },
  { key: "ped", file: "pedestrian.glb", target: 1.75, measure: "height" },
];

/**
 * Merges a loaded GLB into one instancing-ready geometry: skinned meshes are
 * skipped, models longer across X are turned onto +Z, the result is scaled to
 * `target` metres and sat on the ground at its footprint centre.
 * @returns {{ geometry: THREE.BufferGeometry, material: THREE.Material } | null}
 */
export function mergeModelForInstancing(root, { target, measure }) {
  const geometries = [];
  try {
    root.updateMatrixWorld(true);
    const materials = [];
    root.traverse((o) => {
      // InstancedMesh cannot drive skinned/rigged meshes.
      if (!o.isMesh || o.isSkinnedMesh || !o.geometry) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      g.morphAttributes = {};
      g.deleteAttribute("skinIndex");
      g.deleteAttribute("skinWeight");
      geometries.push(g);
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m) materials.push(m);
    });
    if (!geometries.length) return null;
    const merged = mergeGeometries(geometries, false);
    if (!merged) return null;
    const size = new THREE.Vector3();
    merged.computeBoundingBox();
    merged.boundingBox.getSize(size);
    if (measure === "length" && size.x > size.z * 1.15) {
      merged.rotateY(Math.PI / 2);
      merged.computeBoundingBox();
      merged.boundingBox.getSize(size);
    }
    const current = measure === "height" ? size.y : Math.max(size.x, size.z);
    const scale = target / (current || 1);
    merged.scale(scale, scale, scale);
    merged.computeBoundingBox();
    const bb = merged.boundingBox;
    merged.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    // InstancedMesh needs one material; clone so the GLB is not mutated.
    const base = materials[0];
    const material = base?.isMaterial ? base.clone() : getSimpleStandard(0x888888, { roughness: 0.8 });
    return { geometry: merged, material };
  } finally {
    // The merge copied the geometry, so the clones and the GLB's own buffers go.
    for (const g of geometries) g.dispose();
    root.traverse((o) => o.geometry?.dispose?.());
  }
}

/**
 * Loads whichever population override models the asset library offers.
 * Any failure falls back to the built-in shapes for that model.
 */
export async function loadPopulationModels(assetListPromise, loadGLB) {
  const out = {};
  try {
    const list = await assetListPromise;
    const names = new Set((Array.isArray(list) ? list : []).map((a) => a.name));
    for (const spec of POPULATION_MODEL_SPECS) {
      if (!names.has(spec.file)) continue;
      try {
        const model = mergeModelForInstancing(await loadGLB(`/api/assets/${spec.file}`), spec);
        if (!model) continue;
        out[spec.key] = model;
        console.log(`[population] using ${spec.file} for ${spec.key}`);
      } catch (err) {
        console.warn(`[population] ${spec.file}:`, err?.message);
      }
    }
  } catch { /* library unreachable: built-ins */ }
  return out;
}

export function disposePopulationModels(models) {
  for (const model of Object.values(models)) {
    model.geometry?.dispose();
    model.material?.dispose();
  }
}
