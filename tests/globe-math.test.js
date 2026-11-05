import { describe, expect, it } from 'vitest';
import {
  EARTH_RADIUS, flySpeed, globeQualityProfile, nextResolutionScale, offsetRadians, ringSamples,
  saneHeight, solarHourToDate, walkDelta, weatherAtmosphere,
} from '@/lib/globe/globe-math';
import { roadCorridors } from '@/lib/globe/road-overlay';

describe('globe math', () => {
  it('offsets by metres north and east', () => {
    const p = offsetRadians(0, 0, EARTH_RADIUS * 0.01, 0);
    expect(p.lat).toBeCloseTo(0.01);
    const east = offsetRadians(Math.PI / 3, 0, 0, 100);
    // a degree of longitude is half as long at 60 degrees latitude
    expect(east.lon).toBeCloseTo((100 / EARTH_RADIUS) * 2);
  });

  it('walks along the heading', () => {
    const north = walkDelta(0, 1, 0, 5);
    expect(north.north).toBeCloseTo(5);
    expect(north.east).toBeCloseTo(0);
    const strafe = walkDelta(0, 0, 1, 5);
    expect(strafe.east).toBeCloseTo(5);
  });

  it('converts local solar time to a UTC instant', () => {
    const now = new Date(Date.UTC(2026, 5, 1, 8));
    expect(solarHourToDate(12, 0, now).toISOString()).toBe('2026-06-01T12:00:00.000Z');
    // 90 degrees east is 6 hours ahead of UTC in solar time
    expect(solarHourToDate(12, 90, now).toISOString()).toBe('2026-06-01T06:00:00.000Z');
  });

  it('maps weather onto fog and atmosphere', () => {
    expect(weatherAtmosphere(0)).toMatchObject({ fogDensity: 0.0002, skyBrightnessShift: -0 });
    expect(weatherAtmosphere(100).fogDensity).toBeCloseTo(0.004);
  });

  it('steps the adaptive resolution within 0.7..1', () => {
    expect(nextResolutionScale(30, 1)).toBeCloseTo(0.9);
    expect(nextResolutionScale(30, 0.7)).toBe(0.7);
    expect(nextResolutionScale(60, 0.9)).toBeCloseTo(0.95);
    expect(nextResolutionScale(60, 1)).toBe(1);
    expect(nextResolutionScale(48, 0.8)).toBe(0.8);
    expect(nextResolutionScale(0, 1)).toBe(1);
  });

  it('has a profile per quality tier', () => {
    expect(globeQualityProfile('low')).toEqual({ resolutionScale: 0.65, maximumScreenSpaceError: 3.5, fxaa: false });
    expect(globeQualityProfile('high').fxaa).toBe(true);
  });

  it('bounds fly speed and rejects impossible heights', () => {
    expect(flySpeed(0)).toBe(1.5);
    expect(flySpeed(1e9)).toBe(50000);
    expect(saneHeight(100)).toBe(100);
    expect(saneHeight(-1000)).toBeUndefined();
    expect(saneHeight(NaN)).toBeUndefined();
    expect(saneHeight(null)).toBeUndefined();
  });

  it('samples rings nearest first', () => {
    const samples = [...ringSamples(0, 0, [10, 20], 4)];
    expect(samples).toHaveLength(8);
    expect(samples[0].lat).toBeCloseTo(10 / EARTH_RADIUS);
    expect(samples[4].lat).toBeCloseTo(20 / EARTH_RADIUS);
  });
});

describe('globe road overlay', () => {
  it('keeps styled ways with geometry', () => {
    const corridors = roadCorridors([
      { tags: { highway: 'primary' }, geometry: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] },
      { tags: { highway: 'proposed' }, geometry: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] },
      { tags: { highway: 'footway' }, geometry: [{ lat: 1, lon: 2 }] },
    ]);
    expect(corridors).toEqual([{ positions: [2, 1, 4, 3], color: '#5a6474', width: 14 }]);
  });
});
