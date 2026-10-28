export function hasGeometryEdits(edits) {
  return !!(
    (Array.isArray(edits?.hidden) && edits.hidden.length) ||
    (edits?.tagOverrides && Object.keys(edits.tagOverrides).length) ||
    (Array.isArray(edits?.terrain) && edits.terrain.length)
  );
}

/** Apply per-cell feature edits without mutating a cached city response. */
export function applyCityFeatureEdits(elements, edits) {
  if (!Array.isArray(elements) || !hasGeometryEdits(edits)) return elements || [];
  const hidden = new Set(Array.isArray(edits.hidden) ? edits.hidden : []);
  const overrides = edits.tagOverrides && typeof edits.tagOverrides === "object" ? edits.tagOverrides : {};
  return elements.reduce((out, element) => {
    const id = `${element.type}/${element.id}`;
    if (hidden.has(id)) return out;
    const override = overrides[id];
    out.push(override ? { ...element, tags: { ...(element.tags || {}), ...override } } : element);
    return out;
  }, []);
}
