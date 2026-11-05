// Current local time and weather from Open-Meteo (keyless).

/** Local solar-ish hour (0..24) at a UTC offset. */
export function localHourAt(utcOffsetSeconds, nowMs = Date.now()) {
  const local = new Date(nowMs + (utcOffsetSeconds || 0) * 1000);
  return local.getUTCHours() + local.getUTCMinutes() / 60;
}

/**
 * Maps an Open-Meteo `current` block onto the engine's controls.
 * @returns {{ hour: number, weather: number, precip: "rain" | "snow" | null, temp: number, rain: number }}
 */
export function mapOpenMeteo(data, nowMs = Date.now()) {
  const c = data.current;
  const hour = localHourAt(data.utc_offset_seconds, nowMs);
  const weather = Math.min(100, (c.cloud_cover || 0) * 0.8 + (c.precipitation > 0 ? 30 : 0));
  const precip = c.precipitation > 0.05 ? (c.temperature_2m <= 0.5 ? "snow" : "rain") : null;
  return { hour, weather, precip, temp: c.temperature_2m, rain: c.precipitation };
}

export async function fetchLiveWeather(lat, lon, { signal } = {}) {
  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,cloud_cover,is_day,weather_code&timezone=auto`,
    { signal },
  );
  return mapOpenMeteo(await response.json());
}
