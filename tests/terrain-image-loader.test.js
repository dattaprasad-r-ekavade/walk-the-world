import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCorsImage, loadTerrainImageSource, releaseImage } from '@/lib/engine/street/terrain-prefetch';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('terrain image loader', () => {
  it('decodes through createImageBitmap without colour conversion when available', async () => {
    const bitmap = { close: vi.fn() };
    const blob = new Blob(['png']);
    const fetchImpl = vi.fn(async () => ({ ok: true, blob: async () => blob }));
    const createImageBitmap = vi.fn(async () => bitmap);
    vi.stubGlobal('fetch', fetchImpl);
    vi.stubGlobal('createImageBitmap', createImageBitmap);

    await expect(loadCorsImage('https://tiles.test/1.png')).resolves.toBe(bitmap);
    expect(fetchImpl).toHaveBeenCalledWith('https://tiles.test/1.png', expect.objectContaining({ mode: 'cors' }));
    expect(createImageBitmap).toHaveBeenCalledWith(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });

    releaseImage(bitmap);
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(() => releaseImage({})).not.toThrow();
  });

  it('prefetches terrain bytes without decoding before the sampled-grid cache lookup', async () => {
    const blob = new Blob(['png']);
    const fetchImpl = vi.fn(async () => ({ ok: true, blob: async () => blob }));
    const createImageBitmap = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    vi.stubGlobal('createImageBitmap', createImageBitmap);

    await expect(loadTerrainImageSource('https://tiles.test/terrain.png'))
      .resolves.toEqual({ blob, image: null });
    expect(fetchImpl).toHaveBeenCalledWith('https://tiles.test/terrain.png', expect.objectContaining({ mode: 'cors' }));
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('rejects HTTP errors and cancellation', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn());
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(loadCorsImage('https://tiles.test/missing.png')).rejects.toThrow('Terrain image failed');

    vi.stubGlobal('fetch', vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const controller = new AbortController();
    const pending = loadCorsImage('https://tiles.test/slow.png', controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('Terrain image cancelled');
  });

  it('times out a stalled request after 10 s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('createImageBitmap', vi.fn());
    vi.stubGlobal('fetch', vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const pending = loadCorsImage('https://tiles.test/stalled.png');
    const outcome = expect(pending).rejects.toThrow('Terrain image cancelled');
    await vi.advanceTimersByTimeAsync(10000);
    await outcome;
  });
});
