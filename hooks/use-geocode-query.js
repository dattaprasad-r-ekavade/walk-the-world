import { useQuery } from '@tanstack/react-query';

async function reverseGeocode(lat, lon) {
  const r = await fetch(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
  );
  const d = await r.json();
  return [d.locality || d.city, d.principalSubdivision, d.countryName]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 2)
    .join(', ');
}

export function useGeocodeQuery(lat, lon, enabled = true) {
  const key =
    lat !== undefined && lon !== undefined
      ? `${lat.toFixed(3)},${lon.toFixed(3)}`
      : null;
  return useQuery({
    queryKey: ['geocode', key],
    queryFn: () => reverseGeocode(lat, lon),
    enabled: enabled && !!key,
    staleTime: 60_000,
  });
}
