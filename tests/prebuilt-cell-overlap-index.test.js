import { describe, expect, it } from "vitest";
import {
  buildPrebuiltCellOverlapIndex,
  MAX_PREBUILT_CELL_OVERLAP_KEYS,
  prebuiltCellOverlapsOwnedCell,
} from "@/lib/engine/prebuilt-cell-overlap-index";

describe("prebuilt cell overlap index", () => {
  it("builds symmetric exact overlap hints from feature ownership", () => {
    const a = "wtw_city6_35.660_139.701";
    const b = "wtw_city6_35.665_139.701";
    const c = "wtw_city6_35.665_139.706";
    const overlaps = buildPrebuiltCellOverlapIndex([
      { key: a, featureIds: ["way/1", "node/2", "way/1"] },
      { key: b, featureIds: ["way/1", "way/3"] },
      { key: c, featureIds: ["way/4"] },
    ]);

    expect(overlaps.get(a)).toEqual([b]);
    expect(overlaps.get(b)).toEqual([a]);
    expect(overlaps.get(c)).toEqual([]);
  });

  it("bounds overlap hints when a feature spans many cells", () => {
    const rows = Array.from({ length: 1024 }, (_, index) => ({
      key: `cell-${index}`,
      featureIds: ["way/999"],
    }));
    const overlaps = buildPrebuiltCellOverlapIndex(rows);
    const lists = [...overlaps.values()];
    const edgeCount = lists.reduce((sum, values) => sum + values.length, 0);

    expect(overlaps.size).toBe(rows.length);
    expect(Math.max(...lists.map((values) => values.length))).toBe(MAX_PREBUILT_CELL_OVERLAP_KEYS);
    expect(edgeCount).toBe((MAX_PREBUILT_CELL_OVERLAP_KEYS + 1) * MAX_PREBUILT_CELL_OVERLAP_KEYS);
    expect(overlaps.get("cell-1023")).toEqual([]);
  });

  it("skips only when a valid indexed overlap is currently owned", () => {
    const key = "wtw_city6_35.660_139.701";
    const owner = "wtw_city6_35.665_139.701";
    const entry = { featureOverlapKeys: [owner] };

    expect(prebuiltCellOverlapsOwnedCell(entry, key, new Set([owner]))).toBe(true);
    expect(prebuiltCellOverlapsOwnedCell(entry, key, new Set([key]))).toBe(false);
    expect(prebuiltCellOverlapsOwnedCell({ featureOverlapKeys: ["../outside"] }, key, new Set(["../outside"]))).toBe(false);
  });
});
