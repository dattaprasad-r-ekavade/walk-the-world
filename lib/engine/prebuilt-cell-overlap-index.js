const FEATURE_ID = /^[a-z]+\/-?\d+$/u;
export const MAX_PREBUILT_CELL_OVERLAP_KEYS = 64;

/** Build bounded positive overlap hints; missed edges are checked after artifact decode. */
export function buildPrebuiltCellOverlapIndex(rows) {
  const overlaps = new Map();
  const ownersByFeatureId = new Map();
  for (const row of rows || []) {
    if (typeof row?.key === "string") overlaps.set(row.key, new Set());
  }

  for (const row of rows || []) {
    const key = row?.key;
    const ownedIds = new Set((row?.featureIds || []).filter((id) => typeof id === "string" && FEATURE_ID.test(id)));
    if (!overlaps.has(key)) continue;
    for (const id of ownedIds) {
      let owners = ownersByFeatureId.get(id);
      if (!owners) {
        ownersByFeatureId.set(id, { keys: [key], overflow: false });
        continue;
      }
      if (owners.overflow || owners.keys.includes(key)) continue;
      const currentOverlaps = overlaps.get(key);
      for (const otherKey of owners.keys) {
        if (otherKey === key) continue;
        const otherOverlaps = overlaps.get(otherKey);
        if (!currentOverlaps || !otherOverlaps || currentOverlaps.has(otherKey) ||
            currentOverlaps.size >= MAX_PREBUILT_CELL_OVERLAP_KEYS ||
            otherOverlaps.size >= MAX_PREBUILT_CELL_OVERLAP_KEYS) continue;
        currentOverlaps.add(otherKey);
        otherOverlaps.add(key);
      }
      owners.keys.push(key);
      if (owners.keys.length > MAX_PREBUILT_CELL_OVERLAP_KEYS) {
        owners.keys = [];
        owners.overflow = true;
      }
    }
  }

  return new Map([...overlaps.entries()].map(([key, values]) => [key, [...values].sort()]));
}

export function prebuiltCellOverlapsOwnedCell(entry, key, ownedCellKeys) {
  const values = entry?.featureOverlapKeys;
  if (!Array.isArray(values) || values.length === 0 || values.length > 512) return false;
  const validKey = /^wtw_city\d+_-?\d+\.\d{3}_-?\d+\.\d{3}$/u;
  if (values.some((value) => typeof value !== "string" || !validKey.test(value))) return false;
  const overlapKeys = new Set(values);
  for (const ownerKey of ownedCellKeys || []) {
    if (ownerKey !== key && overlapKeys.has(ownerKey)) return true;
  }
  return false;
}
