import { describe, expect, it } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import {
  computeTerrainRevision,
  decodeTerrariumHeightGrid,
  terrainRevisionChunks,
  terrainTileKeysForCell,
  terrainTileLocalBounds,
} from "@/lib/engine/street/terrain-grid";

describe("terrain grid helpers", () => {
  it("matches the runtime Terrarium pixel sampling and height formula", () => {
    const pixels = new Uint8Array([
      128, 0, 0, 255, 129, 0, 0, 255,
      127, 128, 0, 255, 128, 0, 128, 255,
    ]);
    expect([...decodeTerrariumHeightGrid(pixels, 2, 2, 2)]).toEqual([0, 256, -128, 0.5]);
  });

  it("maps tile bounds into the caller's local frame", () => {
    const bounds = terrainTileLocalBounds(0, 0, 0, (lat, lon) => ({ x: lon, z: -lat }));
    expect(bounds.tl).toEqual({ x: -180, z: -85.0511287798066 });
    expect(bounds.br).toEqual({ x: 180, z: 85.0511287798066 });
    expect(bounds.sizeX).toBeCloseTo(360);
    expect(bounds.sizeZ).toBeCloseTo(170.1023, 3);
  });

  it("returns the covering tile lattice with an optional safety margin", () => {
    expect(terrainTileKeysForCell(0, 0, 0.0055, 0)).toEqual(["0/0"]);
    expect(terrainTileKeysForCell(0, 0, 0.0055, 0, 1)).toHaveLength(9);
  });

  it("hashes sorted height grids using the baker's canonical bytes", async () => {
    const tiles = new Map([
      ["2/1", { heights: new Float32Array([12.5, -3]) }],
      ["1/1", { heights: new Float32Array([0, 44.25]) }],
    ]);
    const expected = createHash("sha256");
    for (const chunk of terrainRevisionChunks([...tiles].map(([key, tile]) => ({ key, ...tile })))) {
      expected.update(chunk);
    }
    await expect(computeTerrainRevision(tiles, ["2/1", "1/1"], webcrypto))
      .resolves.toBe(expected.digest("hex"));
    await expect(computeTerrainRevision(tiles, ["missing"], webcrypto)).resolves.toBeNull();
  });
});
