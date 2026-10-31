import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  hashTerrainImage,
  resolveTerrainGrid,
  terrainGridCacheKey,
} from "@/lib/engine/street/terrain-grid-cache";

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
});
