import { useQuery } from '@tanstack/react-query';
import { fetchCityData, cityCacheKey } from '@/lib/engine/cityData';

export function useCityData(lat, lon, enabled = true) {
  return useQuery({
    queryKey: ['city', cityCacheKey(lat, lon)],
    queryFn: () => fetchCityData(lat, lon),
    enabled: enabled && Number.isFinite(lat) && Number.isFinite(lon),
    staleTime: 7 * 864e5,
  });
}
