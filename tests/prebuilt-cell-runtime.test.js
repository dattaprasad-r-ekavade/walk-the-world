import { describe, expect, it, vi } from "vitest";
import { fetchPrebuiltCell } from "@/lib/engine/prebuilt-cell-runtime";

const key = "wtw_city6_35.660_139.701";
const entry = {
  file: `${key}.s123456789012.babcdef123456.mdeadbeef.t789012345678.e1.wtwc.gz`,
  sourceHash: "a".repeat(64),
  builderRevision: "b".repeat(64),
  materialRevision: "c".repeat(16),
  terrainRevision: "d".repeat(64),
  editorRevision: "unmodified",
  origin: { lat: 35.66, lon: 139.701 },
};
const metadata = {
  key,
  ...entry,
  clipMode: "spawn-cell-v1",
  terrainZoom: 14,
  terrainTileKeys: ["8724/5840"],
  elementCount: 2,
  clippedElementCount: 2,
  featureIds: ["way/1", "node/2"],
  summary: { buildings: 1 },
};
const result = {
  walls: [], roofCaps: [], pitchedRoofs: [], roadDecals: [], flats: [],
  meta: Object.fromEntries(["roadPaths", "buildingRings", "roadPoints", "props", "stations", "bridges", "rails",
    "barrierWays", "powerLines", "waterways", "crossings", "pois", "footprints"].map((key) => [key, []])),
};

function response(body) {
  return { ok: true, json: async () => body };
}

describe("prebuilt cell runtime loader", () => {
  it("loads only entries matching the app's builder/material revisions", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({
        format: "walk-the-world-prebuilt-cell-index",
        version: 1,
        builderRevision: "b".repeat(64),
        materialRevision: "c".repeat(16),
        cells: { [key]: entry },
      }))
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer });
    const decode = vi.fn(async () => ({ metadata, result }));

    await expect(fetchPrebuiltCell(key, {
      base: "/compiled-cells/",
      expectedBuilderRevision: "b".repeat(64),
      expectedMaterialRevision: "c".repeat(16),
      fetchImpl,
      decode,
    })).resolves.toEqual({ kind: "prebuilt", metadata, result, file: entry.file });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "/compiled-cells/index.json",
      `/compiled-cells/${entry.file}`,
    ]);
  });

  it("falls back when app revisions differ or an index entry points outside the base", async () => {
    const mismatchFetch = vi.fn().mockResolvedValueOnce(response({
      format: "walk-the-world-prebuilt-cell-index",
      version: 1,
      builderRevision: "e".repeat(64),
      materialRevision: "c".repeat(16),
      cells: { [key]: entry },
    }));
    await expect(fetchPrebuiltCell(key, {
      expectedBuilderRevision: "b".repeat(64),
      expectedMaterialRevision: "c".repeat(16),
      fetchImpl: mismatchFetch,
    })).resolves.toBeNull();
    expect(mismatchFetch).toHaveBeenCalledTimes(1);

    const unsafeFetch = vi.fn().mockResolvedValueOnce(response({
      format: "walk-the-world-prebuilt-cell-index",
      version: 1,
      builderRevision: "b".repeat(64),
      materialRevision: "c".repeat(16),
      cells: { [key]: { ...entry, file: "../outside.wtwc.gz" } },
    }));
    await expect(fetchPrebuiltCell(key, {
      expectedBuilderRevision: "b".repeat(64),
      expectedMaterialRevision: "c".repeat(16),
      fetchImpl: unsafeFetch,
    })).resolves.toBeNull();
    expect(unsafeFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a binary whose embedded metadata disagrees with the index", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({
        format: "walk-the-world-prebuilt-cell-index",
        version: 1,
        builderRevision: "b".repeat(64),
        materialRevision: "c".repeat(16),
        cells: { [key]: entry },
      }))
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer });
    await expect(fetchPrebuiltCell(key, {
      expectedBuilderRevision: "b".repeat(64),
      expectedMaterialRevision: "c".repeat(16),
      fetchImpl,
      decode: async () => ({ metadata: { ...metadata, sourceHash: "stale" }, result }),
    })).resolves.toBeNull();
  });
});
