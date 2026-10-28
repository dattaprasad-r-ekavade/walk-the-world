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

/** Resolve local API and public-cache requests to the requested recorded cell. */
export function recordedCityKeyForUrl(requestUrl, baseOrigin) {
  let url;
  try { url = requestUrl instanceof URL ? requestUrl : new URL(requestUrl); }
  catch { return null; }
  const cityKeyPattern = 'wtw_city\\d+_-?\\d+\\.\\d{3}_-?\\d+\\.\\d{3}';
  if (url.origin === baseOrigin) {
    const apiKey = url.pathname.match(new RegExp(`^/api/city/(${cityKeyPattern})$`));
    if (apiKey) return apiKey[1];
  }
  return url.pathname.match(new RegExp(`^/(?:.*?/)?(${cityKeyPattern})\\.json$`))?.[1] || null;
}
