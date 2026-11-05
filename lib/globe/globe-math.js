// @ts-check
// Pure helpers for the Cesium globe: no Cesium, DOM or React access.
import { EARTH_R } from "@/lib/engine/geo";

export const EARTH_RADIUS = EARTH_R; // metres

/** Moves (lat, lon) in radians by metres north/east on a spherical Earth. */
export function offsetRadians(lat, lon, northMeters, eastMeters) {
  return {
    lat: lat + northMeters / EARTH_RADIUS,
    lon: lon + eastMeters / (EARTH_RADIUS * Math.cos(lat)),
  };
}

/** Heading-relative walk step: forward/right input to metres north/east. */
export function walkDelta(heading, f, r, distance) {
  const sin = Math.sin(heading), cos = Math.cos(heading);
  return { east: (f * sin + r * cos) * distance, north: (f * cos - r * sin) * distance };
}

/**
 * The UTC instant at which local solar time is `hour` at longitude `lonDeg`,
 * on today's UTC date. The globe's time slider is local solar time at the
 * camera, so noon puts the sun overhead wherever you are looking.
 */
export function solarHourToDate(hour, lonDeg, now = new Date()) {
  const utcHour = hour - lonDeg / 15;
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnight + utcHour * 3600 * 1000);
}

/** Fog and atmosphere shifts for weather 0 (clear) .. 100 (heavy overcast). */
export function weatherAtmosphere(weather) {
  const w = weather / 100;
  return {
    fogDensity: 0.0002 + w * w * 0.0038,
    skyBrightnessShift: -0.5 * w,
    skySaturationShift: -0.55 * w,
    globeBrightnessShift: -0.35 * w,
  };
}

/**
 * Adaptive resolution: drop render scale when the frame rate struggles,
 * restore it when there is headroom. Returns the new scale.
 */
export function nextResolutionScale(fps, scale) {
  if (fps > 0 && fps < 40 && scale > 0.7) return Math.max(0.7, scale - 0.1);
  if (fps > 55 && scale < 1.0) return Math.min(1.0, scale + 0.05);
  return scale;
}

/** Renderer settings per quality preset. */
export function globeQualityProfile(tier) {
  if (tier === "low") return { resolutionScale: 0.65, maximumScreenSpaceError: 3.5, fxaa: false };
  if (tier === "medium") return { resolutionScale: 0.85, maximumScreenSpaceError: 2.5, fxaa: false };
  return { resolutionScale: 1.0, maximumScreenSpaceError: 2.0, fxaa: true };
}

/** Free-flight camera speed (m per frame) scaled by height above the ellipsoid. */
export function flySpeed(height) {
  return Math.max(1.5, Math.min(height * 0.04, 50000));
}

/** Ground heights outside Dead Sea .. Everest are treated as bad samples. */
export function saneHeight(h) {
  return h !== undefined && h !== null && Number.isFinite(h) && h > -450 && h < 8900 ? h : undefined;
}

/** Sample points on rings around a spot, nearest first (for open-ground search). */
export function* ringSamples(lat, lon, radii = [15, 30, 50, 80, 120], perRing = 8) {
  for (const radius of radii) {
    for (let i = 0; i < perRing; i++) {
      const a = (i / perRing) * Math.PI * 2;
      yield offsetRadians(lat, lon, Math.cos(a) * radius, Math.sin(a) * radius);
    }
  }
}
