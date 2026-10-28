function positiveNumber(raw) {
  const value = Number(String(raw ?? "").trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

function widthMeters(raw) {
  const match = String(raw ?? "").trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(m|meters?|metres?|ft|feet|foot|')?$/);
  if (!match) return null;
  const width = Number(match[1]);
  if (!Number.isFinite(width) || width <= 0) return null;
  return ["ft", "feet", "foot", "'"].includes(match[2]) ? width * 0.3048 : width;
}

/** Resolve a bounded lane-marking profile from OSM lane, width and direction tags. */
export function roadMarkingProfile(tags = {}) {
  const explicit = positiveNumber(tags.lanes);
  const forward = positiveNumber(tags["lanes:forward"]);
  const backward = positiveNumber(tags["lanes:backward"]);
  const taggedLanes = explicit || ((forward || backward) ? (forward || 0) + (backward || 0) : null);
  const width = widthMeters(tags.width);
  const inferredLanes = width ? Math.max(1, Math.round(width / 3.25)) : 0;
  const lanes = taggedLanes || inferredLanes;
  const oneWay = /^(?:yes|true|1|-1)$/i.test(String(tags.oneway ?? "").trim());
  return {
    lanes: lanes ? Math.max(1, Math.min(8, Math.round(lanes))) : 0,
    oneWay,
  };
}
