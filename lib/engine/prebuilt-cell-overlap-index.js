const FEATURE_ID = /^[a-z]+\/-?\d+$/u;

/** Build exact cell-to-cell overlap hints from feature IDs in one bake batch. */
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
      if (!owners) ownersByFeatureId.set(id, owners = []);
      for (const otherKey of owners) {
        if (otherKey === key) continue;
        overlaps.get(key).add(otherKey);
        overlaps.get(otherKey)?.add(key);
      }
      owners.push(key);
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
