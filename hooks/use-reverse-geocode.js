'use client';

import { useEffect, useRef, useState } from 'react';

function formatPlace(data) {
  return [data.locality || data.city, data.principalSubdivision, data.countryName]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 2)
    .join(', ');
}

export function useReverseGeocode(lat, lon, enabled = true, minDist = 0.003) {
  const [place, setPlace] = useState(null);
  const lastGeo = useRef({ lat: null, lon: null, t: 0 });
  const lastPlace = useRef(null);

  useEffect(() => {
    if (!enabled || lat === undefined || lon === undefined) return;
    const prev = lastGeo.current;
    const moved =
      prev.lat === null ||
      Math.hypot(lat - prev.lat, lon - prev.lon) > minDist ||
      Date.now() - prev.t > 60000;
    if (!moved) return;
    lastGeo.current = { lat, lon, t: Date.now() };

    const ctrl = new AbortController();
    fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      { signal: ctrl.signal }
    )
      .then((r) => r.json())
      .then((d) => {
        const line = formatPlace(d);
        if (line) {
          lastPlace.current = line;
          setPlace({ text: line, key: Date.now() });
        }
      })
      .catch(() => {});

    return () => ctrl.abort();
  }, [lat, lon, enabled, minDist]);

  const replayPlace = () => {
    if (lastPlace.current) setPlace({ text: lastPlace.current, key: Date.now() });
  };

  return { place, replayPlace, lastPlace };
}
