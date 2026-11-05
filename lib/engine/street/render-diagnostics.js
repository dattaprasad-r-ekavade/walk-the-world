// Diagnostics-only helpers for attributing newly linked shader programs to
// the scene objects and materials that caused them. Only called while perf
// diagnostics are collecting; every failure is swallowed because this is
// best-effort debug data, never something rendering depends on.

/** Ids of the shader programs the renderer currently holds. */
export function programIdSet(renderer) {
  return new Set((renderer.info.programs || []).map((program) => program.id));
}

const materialsOf = (object) => (Array.isArray(object.material)
  ? object.material
  : object.material ? [object.material] : []);

/**
 * Walks `root` and records, per new program id, how many object/material
 * pairs use it plus a small sample of them.
 *
 * @param {object} renderer  three.js WebGLRenderer
 * @param {object} root      Object3D to traverse
 * @param {Set<number>} newProgramIds
 * @param {{ sampleLimit?: number, dedupe?: boolean, cellKeyRoot?: object | null }} [options]
 *   dedupe counts each object/material pair once; cellKeyRoot tags samples with
 *   the enclosing `wtw_city…` group found below that root.
 */
export function attributeProgramOwners(renderer, root, newProgramIds, {
  sampleLimit = 4,
  dedupe = false,
  cellKeyRoot = null,
} = {}) {
  const owners = new Map();
  try {
    if (!newProgramIds.size ||
        typeof renderer.properties?.has !== "function" ||
        typeof renderer.properties?.get !== "function" ||
        typeof root.traverse !== "function") return owners;
    root.traverse((object) => {
      for (const material of materialsOf(object)) {
        if (!renderer.properties.has(material)) continue;
        const materialPrograms = renderer.properties.get(material).programs;
        if (!materialPrograms?.values) continue;
        for (const program of materialPrograms.values()) {
          if (!newProgramIds.has(program.id)) continue;
          let entry = owners.get(program.id);
          if (!entry) {
            entry = { seen: dedupe ? new Set() : null, count: 0, sample: [] };
            owners.set(program.id, entry);
          }
          if (entry.seen) {
            const signature = `${object.uuid}:${material.uuid}`;
            if (entry.seen.has(signature)) continue;
            entry.seen.add(signature);
          }
          entry.count += 1;
          if (entry.sample.length >= sampleLimit) continue;
          const sample = {
            objectType: object.type,
            objectName: object.name || null,
            materialType: material.type,
            materialName: material.name || null,
            materialFamily: material.userData?.materialFamily || null,
          };
          if (cellKeyRoot) sample.cellKey = enclosingCellKey(object, cellKeyRoot);
          entry.sample.push(sample);
        }
      }
    });
  } catch { /* owner attribution is best-effort debug data */ }
  return owners;
}

function enclosingCellKey(object, stopAt) {
  for (let parent = object; parent && parent !== stopAt; parent = parent.parent) {
    if (parent.name?.startsWith("wtw_city")) return parent.name;
  }
  return null;
}

/** Serializable summary of up to 32 new programs and their owners. */
export function describeNewPrograms(newPrograms, owners) {
  return newPrograms.slice(0, 32).map((program) => {
    const cacheKey = String(program.cacheKey || "");
    return {
      id: program.id,
      name: program.name,
      type: program.type,
      usedTimes: program.usedTimes,
      cacheKeyLength: cacheKey.length,
      cacheKeyPrefix: cacheKey.slice(0, 320),
      ownerCount: owners.get(program.id)?.count || 0,
      owners: owners.get(program.id)?.sample || [],
    };
  });
}

/** Programs present now that were not in `before`. */
export function newProgramsSince(renderer, before) {
  return (renderer.info.programs || []).filter((program) => !before.has(program.id));
}
