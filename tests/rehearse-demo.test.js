import { describe, expect, it } from 'vitest';
import { percentile, filterConsoleErrors, formatTable, parseArgs, slugify } from '../scripts/rehearse-demo.mjs';

describe('rehearse-demo helpers', () => {
  it('computes percentiles', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 95)).toBe(95);
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
  });

  it('filters CORS and ERR_FAILED noise', () => {
    const out = filterConsoleErrors([
      'Access to fetch blocked by CORS policy',
      'Failed to load resource: net::ERR_FAILED',
      'TypeError: boom',
    ]);
    expect(out).toEqual(['TypeError: boom']);
  });

  it('formats a table', () => {
    const t = formatTable([{ a: 'x', b: 12 }, { a: 'long', b: null }], ['a', 'b']);
    expect(t.split(String.fromCharCode(10))).toEqual(['a     b', '----  --', 'x     12', 'long  -']);
  });

  it('parses args and slugs', () => {
    expect(parseArgs([]).base).toBe('https://walk-the-world-delta.vercel.app');
    const a = parseArgs(['http://x/', '--headed', '--out=o']);
    expect(a).toMatchObject({ base: 'http://x', headed: true, out: 'o', frames: 300, r2NodeProxy: false });
    expect(parseArgs(['--r2-node-proxy', '--frames=500'])).toMatchObject({ r2NodeProxy: true, frames: 500 });
    expect(slugify('New York')).toBe('new-york');
  });
});
