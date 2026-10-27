import { describe, expect, it } from 'vitest';
import { parseBenchmarkEnvironment } from '../scripts/bench-environment.mjs';

describe('benchmark lighting and weather options', () => {
  it('defaults to a deterministic clear noon scene', () => {
    expect(parseBenchmarkEnvironment([])).toEqual({
      hour: 12,
      weather: 0,
      precipitationMode: null,
    });
  });

  it('accepts night and rain settings and derives precipitation consistently', () => {
    expect(parseBenchmarkEnvironment(['--hour', '21.5', '--weather', '85'])).toEqual({
      hour: 21.5,
      weather: 85,
      precipitationMode: 'rain',
    });
    expect(parseBenchmarkEnvironment(['--hour', '6', '--weather', '84'])).toEqual({
      hour: 6,
      weather: 84,
      precipitationMode: null,
    });
  });

  it('rejects out-of-range and incomplete scenario options', () => {
    expect(() => parseBenchmarkEnvironment(['--hour', '24.1'])).toThrow(/--hour/);
    expect(() => parseBenchmarkEnvironment(['--weather', '101'])).toThrow(/--weather/);
    expect(() => parseBenchmarkEnvironment(['--hour'])).toThrow(/Expected a value/);
  });
});
