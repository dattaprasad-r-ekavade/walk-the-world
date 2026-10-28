/** Return a cell-specific payload when a recorded benchmark fixture supplies a cell map. */
export function selectRecordedCityPayload(fixture, cityKey) {
  const cellPayloads = fixture?.cellPayloads;
  if (!cellPayloads || typeof cellPayloads !== "object" || Array.isArray(cellPayloads)) {
    return fixture;
  }
  return cellPayloads[cityKey] ||
    cellPayloads[fixture.defaultPayloadKey] ||
    fixture.defaultPayload ||
    { elements: [] };
}
