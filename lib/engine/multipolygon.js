const COORDINATE_PRECISION = 7;

function coordinateKey(point) {
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) return null;
  return `${point.lat.toFixed(COORDINATE_PRECISION)},${point.lon.toFixed(COORDINATE_PRECISION)}`;
}

function validMember(member) {
  return member?.type === "way" &&
    (member.role === "outer" || member.role === "inner" || member.role === "") &&
    Array.isArray(member.geometry) && member.geometry.length >= 2 &&
    member.geometry.every((point) => coordinateKey(point) !== null);
}

/**
 * Join an OSM multipolygon's member ways into closed outer and inner rings.
 * Incomplete chains are discarded instead of being closed across a missing
 * segment, which would paint a false area.
 */
export function stitchMultipolygonMemberRings(members) {
  if (!Array.isArray(members) || !members.length) return [];
  const rings = [];

  for (const role of ["outer", "inner"]) {
    const segments = members
      .filter((member) => validMember(member) && (member.role === role || (role === "outer" && member.role === "")))
      .map((member) => member.geometry.map((point) => ({ lat: point.lat, lon: point.lon })));
    const unused = new Set(segments.map((_, index) => index));

    while (unused.size) {
      const firstIndex = unused.values().next().value;
      unused.delete(firstIndex);
      const chain = segments[firstIndex].slice();
      const startKey = coordinateKey(chain[0]);
      let endKey = coordinateKey(chain[chain.length - 1]);
      let joins = 0;

      while (startKey !== endKey && joins < segments.length) {
        let match = -1;
        let reversed = false;
        for (const index of unused) {
          const segment = segments[index];
          if (coordinateKey(segment[0]) === endKey) {
            match = index;
            break;
          }
          if (coordinateKey(segment[segment.length - 1]) === endKey) {
            match = index;
            reversed = true;
            break;
          }
        }
        if (match < 0) break;

        unused.delete(match);
        const segment = reversed ? segments[match].slice().reverse() : segments[match];
        chain.push(...segment.slice(1));
        endKey = coordinateKey(chain[chain.length - 1]);
        joins++;
      }

      if (startKey === endKey && chain.length >= 4) {
        rings.push({ role, geometry: chain });
      }
    }
  }

  return rings;
}
