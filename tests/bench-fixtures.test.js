import { describe, expect, it } from 'vitest';
import { recordedCityKeyForUrl, selectRecordedCityPayload } from '../scripts/bench-fixtures.mjs';

describe('recorded benchmark cell fixtures', () => {
  it('keeps legacy single-payload fixtures unchanged', () => {
    const fixture = { elements: [{ type: 'node', id: 1 }] };
    expect(selectRecordedCityPayload(fixture, 'wtw_city6_41.890_12.492')).toBe(fixture);
  });

  it('selects the payload assigned to a requested cell key', () => {
    const origin = { elements: [{ type: 'node', id: 1 }] };
    const east = { elements: [{ type: 'node', id: 2 }] };
    const fixture = { cellPayloads: { 'wtw_city6_41.890_12.492': origin, 'wtw_city6_41.890_12.498': east } };

    expect(selectRecordedCityPayload(fixture, 'wtw_city6_41.890_12.498')).toBe(east);
  });

  it('uses a default cell key, explicit default, or empty payload for unmapped cells', () => {
    const fallback = { elements: [] };
    const origin = { elements: [{ type: 'way', id: 1 }] };
    expect(selectRecordedCityPayload({ cellPayloads: { origin }, defaultPayloadKey: 'origin' }, 'missing')).toBe(origin);
    expect(selectRecordedCityPayload({ cellPayloads: {}, defaultPayload: fallback }, 'missing')).toBe(fallback);
    expect(selectRecordedCityPayload({ cellPayloads: {} }, 'missing')).toEqual({ elements: [] });
  });

  it('routes recorded local API and public cache URLs by city key', () => {
    const key = 'wtw_city6_41.890_12.492';
    expect(recordedCityKeyForUrl(`http://127.0.0.1:3456/api/city/${key}`, 'http://127.0.0.1:3456')).toBe(key);
    expect(recordedCityKeyForUrl(`https://cache.example.test/${key}.json`, 'http://127.0.0.1:3456')).toBe(key);
    expect(recordedCityKeyForUrl(`http://127.0.0.1:3456/api/assets`, 'http://127.0.0.1:3456')).toBeNull();
    expect(recordedCityKeyForUrl('not a URL', 'http://127.0.0.1:3456')).toBeNull();
  });
});
