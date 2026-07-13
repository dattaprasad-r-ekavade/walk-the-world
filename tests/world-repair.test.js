import { describe, expect, it } from 'vitest';
import { deterministicWorldRepair, isValidWorldRepair, summarizeCityElements } from '../lib/world-repair';

describe('world repair audit', () => {
  it('summarizes only evidence present in map elements', () => {
    const summary = summarizeCityElements([
      { type: 'way', tags: { building: 'yes', 'building:levels': '4' } },
      { type: 'way', tags: { building: 'retail', 'building:material': 'brick' } },
      { type: 'way', tags: { highway: 'residential', bridge: 'yes' } },
      { type: 'node', tags: { amenity: 'cafe', name: 'Example' } },
    ]);
    expect(summary).toMatchObject({ elements: 4, buildings: 2, roads: 1, bridges: 1, namedPlaces: 1, shopsAndAmenities: 1 });
    expect(summary.heightCoverage).toBe(0.5);
    expect(summary.materialCoverage).toBe(0.5);
  });

  it('produces a valid, provenance-bearing fallback', () => {
    const result = deterministicWorldRepair({ buildings: 80, roads: 20, bridges: 0, water: 0, shopsAndAmenities: 2, heightCoverage: 0.1, materialCoverage: 0.05 });
    expect(isValidWorldRepair(result)).toBe(true);
    expect(result.engine).toBe('rules');
    expect(result.findings.some((finding) => finding.id === 'height-coverage')).toBe(true);
    expect(result.provenance.length).toBeGreaterThan(0);
  });
});

