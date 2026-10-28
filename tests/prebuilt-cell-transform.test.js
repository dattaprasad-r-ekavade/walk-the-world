import { describe, expect, it } from "vitest";
import { makeLocalFrame } from "@/lib/engine/geo";
import { rebasePrebuiltCityResult } from "@/lib/engine/prebuilt-cell-transform";

describe("prebuilt cell frame transform", () => {
  it("rebases geometry, instances, rings and streamed metadata into the active ENU frame", () => {
    const bakedOrigin = { lat: 35.66, lon: 139.701 };
    const runtimeOrigin = { lat: 35.6595, lon: 139.7005 };
    const runtimeFrame = makeLocalFrame(runtimeOrigin.lat, runtimeOrigin.lon);
    const offset = runtimeFrame.toLocal(bakedOrigin.lat, bakedOrigin.lon);
    const result = {
      walls: [{ geo: {
        position: { array: new Float32Array([1, 2, 3]), itemSize: 3 },
        normal: { array: new Float32Array([0.6, 0.8, 0]), itemSize: 3 },
      } }],
      trees: { matrices: new Float32Array([
        1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 0, 5, 1,
      ]) },
      meta: {
        footprints: [{ ring: [[0, 0], [2, 0], [2, 3]], id: "way/7" }],
        roadPaths: [{ pts: [{ x: 0, y: 0 }, { x: 4, y: 6 }] }],
        roadPoints: [{ x: 1, z: 2, nx: 3, nz: 4 }],
      },
    };

    rebasePrebuiltCityResult(result, bakedOrigin, runtimeOrigin);
    const sx = runtimeFrame.cosLat / makeLocalFrame(bakedOrigin.lat, bakedOrigin.lon).cosLat;
    expect(result.walls[0].geo.position.array).toEqual(new Float32Array([sx + offset.x, 2, 3 + offset.z]));
    expect(Math.hypot(...result.walls[0].geo.normal.array)).toBeCloseTo(1, 6);
    expect(result.trees.matrices[12]).toBeCloseTo(4 * sx + offset.x, 5);
    expect(result.trees.matrices[14]).toBeCloseTo(5 + offset.z, 5);
    expect(result.meta.footprints[0].ring[0]).toEqual([offset.x, offset.z]);
    expect(result.meta.roadPaths[0].pts[1]).toEqual({ x: 4 * sx + offset.x, y: 6 + offset.z });
    expect(result.meta.roadPoints[0]).toMatchObject({
      x: 1 * sx + offset.x,
      z: 2 + offset.z,
      nx: 3 * sx + offset.x,
      nz: 4 + offset.z,
    });
  });

  it("rejects missing geographic origins", () => {
    expect(() => rebasePrebuiltCityResult({}, null, { lat: 0, lon: 0 })).toThrow("origin is invalid");
  });
});
