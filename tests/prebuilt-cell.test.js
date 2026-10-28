import { describe, expect, it } from "vitest";
import { gunzipSync, gzipSync } from "node:zlib";
import { encodePrebuiltCell } from "@/lib/engine/prebuilt-cell-encoder";
import { decodePrebuiltCell } from "@/lib/engine/prebuilt-cell-decoder";

const sample = {
  walls: [{
    color: 0xc3b99e,
    geo: {
      position: {
        array: new Float32Array([-120.125, 0, -90.5, 120.125, 42.25, 90.5, 0.25, 12.5, 4.75]),
        itemSize: 3,
        normalized: false,
      },
      normal: {
        array: new Float32Array([0, 1, 0, 0.6, 0.8, 0, -1, 0, 0]),
        itemSize: 3,
        normalized: false,
      },
      color: {
        array: new Float32Array([0.2, 0.4, 0.8, 0.9, 0.5, 0.1, 0.4, 0.7, 0.3]),
        itemSize: 3,
        normalized: false,
      },
      uv: {
        array: new Float32Array([0, 0, 1, 0, 0.5, 37.25]),
        itemSize: 2,
        normalized: false,
      },
      index: new Uint16Array([0, 1, 2]),
    },
  }],
  trees: { count: 1, matrices: new Float32Array(16).fill(0).map((_, i) => i % 5 === 0 ? 1 : 0) },
  meta: { footprints: [{ id: 42, tags: { building: "yes" }, ring: [{ x: 2.5, z: -1.25 }] }] },
};

function maxError(actual, expected) {
  return Math.max(...actual.map((value, index) => Math.abs(value - expected[index])));
}

describe("prebuilt cell binary format", () => {
  it("round-trips metadata, typed arrays, and meshopt-compressed indices", async () => {
    const metadata = { key: "wtw_city6_35.660_139.701", origin: { lat: 35.66, lon: 139.701 }, terrainRevision: "terrarium-z15-v1" };
    const bytes = await encodePrebuiltCell({ metadata, result: sample });
    const decoded = await decodePrebuiltCell(bytes);

    expect(decoded.metadata).toEqual(metadata);
    expect(decoded.result.meta).toEqual(sample.meta);
    expect(decoded.result.walls[0].geo.index).toBeInstanceOf(Uint16Array);
    expect(decoded.result.walls[0].geo.index).toEqual(sample.walls[0].geo.index);
    expect(decoded.result.walls[0].geo.uv.array).toBeInstanceOf(Float32Array);
    expect(maxError(decoded.result.walls[0].geo.uv.array, sample.walls[0].geo.uv.array)).toBeLessThan(0.0003);
    expect(maxError(decoded.result.walls[0].geo.position.array, sample.walls[0].geo.position.array)).toBeLessThan(0.004);
    expect(maxError(decoded.result.walls[0].geo.color.array, sample.walls[0].geo.color.array)).toBeLessThan(0.00002);
    expect(maxError(decoded.result.walls[0].geo.normal.array, sample.walls[0].geo.normal.array)).toBeLessThan(0.00002);
    expect(decoded.result.trees.matrices).toEqual(sample.trees.matrices);
  });

  it("rejects corrupt signatures, versions, and truncated buffers", async () => {
    const bytes = await encodePrebuiltCell({ metadata: {}, result: sample });
    const raw = gunzipSync(bytes);
    const badMagic = new Uint8Array(raw);
    badMagic[0] = 0;
    await expect(decodePrebuiltCell(gzipSync(badMagic))).rejects.toThrow("signature");

    const badVersion = new Uint8Array(raw);
    new DataView(badVersion.buffer).setUint16(4, 2, true);
    await expect(decodePrebuiltCell(gzipSync(badVersion))).rejects.toThrow("version");
    await expect(decodePrebuiltCell(gzipSync(raw.subarray(0, 14)))).rejects.toThrow();
  });
});
