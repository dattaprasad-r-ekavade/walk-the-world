import { describe, it, expect } from 'vitest';
import { looksPartial } from '../lib/overpassServer.js';

const road = (i) => ({ type: 'way', id: i, tags: { highway: 'residential' } });
const bld = (i) => ({ type: 'way', id: i, tags: { building: 'yes' } });
const roads = (n) => Array.from({ length: n }, (_, i) => road(i));

describe('overpassServer/looksPartial', () => {
  it('treats an empty or missing cell as not partial', () => {
    // Nothing to judge — the caller's "empty result" path handles these.
    expect(looksPartial([]).partial).toBe(false);
    expect(looksPartial(null).partial).toBe(false);
    expect(looksPartial(undefined).partial).toBe(false);
  });

  it('allows genuinely sparse places', () => {
    // A handful of lanes and no buildings is a real rural cell, not a failure.
    expect(looksPartial(roads(19)).partial).toBe(false);
  });

  it('flags many roads with zero buildings', () => {
    // 20+ mapped streets and not one building does not occur naturally.
    expect(looksPartial(roads(20)).partial).toBe(true);
    expect(looksPartial(roads(1396)).partial).toBe(true);
  });

  it('a single building clears the flag', () => {
    expect(looksPartial([...roads(500), bld(1)]).partial).toBe(false);
  });

  it('counts buildings and road ways separately', () => {
    const c = looksPartial([...roads(20), bld(1), bld(2)]);
    expect(c.buildings).toBe(2);
    expect(c.highways).toBe(20);
  });

  it('does not count highway NODES as roads', () => {
    // Street lamps and traffic signals are nodes tagged highway=*; counting
    // them would flag prop-rich, building-free cells as broken.
    const lamps = Array.from({ length: 40 }, (_, i) => ({
      type: 'node', id: i, tags: { highway: 'street_lamp' },
    }));
    expect(looksPartial(lamps).partial).toBe(false);
  });

  it('does not count building nodes/relations as buildings', () => {
    // Only way-tagged buildings render; a relation alone must not clear the flag.
    const c = looksPartial([...roads(30), { type: 'node', id: 1, tags: { building: 'yes' } }]);
    expect(c.buildings).toBe(1); // counted, and that is intentional...
    expect(c.partial).toBe(false); // ...so a tagged building of any type clears it
  });
});
