import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  hashTerrainImage,
  readTerrainGridCache,
  resolveTerrainGrid,
  terrainGridCacheKey,
  writeTerrainGridCache,
} from "@/lib/engine/street/terrain-grid-cache";

function createFakeIndexedDB() {
  const databases = new Map();
  const clone = (value) => structuredClone(value);
  return {
    open(name) {
      const request = {};
      queueMicrotask(() => {
        let database = databases.get(name);
        const isNew = !database;
        if (!database) {
          const stores = new Map();
          database = {
            createObjectStore(storeName) {
              const records = new Map();
              stores.set(storeName, records);
              return { createIndex: vi.fn() };
            },
            transaction(storeName) {
              const records = stores.get(storeName);
              const transaction = { oncomplete: null, onerror: null, onabort: null };
              transaction.objectStore = () => ({
                get(key) {
                  const getRequest = {};
                  queueMicrotask(() => {
                    getRequest.result = clone(records.get(key));
                    getRequest.onsuccess?.();
                    queueMicrotask(() => transaction.oncomplete?.());
                  });
                  return getRequest;
                },
                put(record) { records.set(record.key, clone(record)); },
                delete(key) { records.delete(key); },
                index() {
                  return {
                    openCursor() {
                      const cursorRequest = {};
                      queueMicrotask(() => {
                        cursorRequest.result = null;
                        cursorRequest.onsuccess?.();
                        queueMicrotask(() => transaction.oncomplete?.());
                      });
                      return cursorRequest;
                    },
                  };
                },
              });
              return transaction;
            },
          };
          databases.set(name, database);
        }
        request.result = database;
        if (isNew) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

describe("revision-aware terrain grid cache", () => {
  it("hashes exact image bytes and versions cache entries by format and grid size", async () => {
    const blob = new Blob(["terrarium-png-bytes"]);
    const expected = createHash("sha256").update("terrarium-png-bytes").digest("hex");
    await expect(hashTerrainImage(blob, webcrypto)).resolves.toBe(expected);
    expect(terrainGridCacheKey(expected, 65)).toBe(`terrarium-grid-v1:65:${expected}`);
    expect(terrainGridCacheKey("stale", 65)).toBeNull();
    expect(terrainGridCacheKey(expected, 1)).toBeNull();
  });

  it("uses a matching cached grid without decoding the image", async () => {
    const blob = new Blob(["tile-a"]);
    const sourceHash = await hashTerrainImage(blob, webcrypto);
    const heights = new Float32Array([1, 2, 3, 4]);
    const decode = vi.fn();
    const writeGrid = vi.fn();
    const result = await resolveTerrainGrid(blob, 2, decode, {
      cryptoApi: webcrypto,
      readGrid: vi.fn(async (hash, size) => {
        expect(hash).toBe(sourceHash);
        expect(size).toBe(2);
        return heights;
      }),
      writeGrid,
    });

    expect(result).toEqual({ heights, sourceHash, cacheHit: true });
    expect(result.heights).not.toBe(heights);
    expect(decode).not.toHaveBeenCalled();
    expect(writeGrid).not.toHaveBeenCalled();
  });

  it("decodes and stores a grid on a content-hash miss", async () => {
    const blob = new Blob(["tile-b"]);
    const sourceHash = await hashTerrainImage(blob, webcrypto);
    const heights = new Float32Array([5, 6, 7, 8]);
    const writeGrid = vi.fn(async () => true);
    const result = await resolveTerrainGrid(blob, 2, vi.fn(async () => heights), {
      cryptoApi: webcrypto,
      readGrid: vi.fn(async () => null),
      writeGrid,
    });

    expect(result).toEqual({ heights, sourceHash, cacheHit: false });
    await vi.waitFor(() => expect(writeGrid).toHaveBeenCalledWith(sourceHash, 2, heights));
  });

  it("keeps decoding when a source hash cannot be produced", async () => {
    const heights = new Float32Array([0, 0, 0, 0]);
    const readGrid = vi.fn();
    const writeGrid = vi.fn();
    const result = await resolveTerrainGrid(new Blob(["tile-c"]), 2, async () => heights, {
      cryptoApi: {},
      readGrid,
      writeGrid,
    });

    expect(result).toEqual({ heights, sourceHash: null, cacheHit: false });
    expect(readGrid).not.toHaveBeenCalled();
    expect(writeGrid).not.toHaveBeenCalled();
  });

  it("writes and reads a persistent grid through IndexedDB", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDB());
    const sourceHash = "b".repeat(64);
    const heights = new Float32Array([10, 20, 30, 40]);

    await expect(writeTerrainGridCache(sourceHash, 2, heights)).resolves.toBe(true);
    await expect(readTerrainGridCache(sourceHash, 2)).resolves.toEqual(heights);
  });
});
