import { describe, expect, it } from "vitest";
import { applyCityFeatureEdits, hasGeometryEdits } from "@/lib/engine/city-edits";

const elements = [
  { type: "way", id: 1, tags: { building: "yes" } },
  { type: "way", id: 2, tags: { building: "yes", height: "8" } },
];

describe("cell geometry edits", () => {
  it("selects raw rebuilds for hidden, tag, and terrain edits but not placed assets", () => {
    expect(hasGeometryEdits({ assets: [{ name: "lamp.glb" }] })).toBe(false);
    expect(hasGeometryEdits({ hidden: ["way/1"] })).toBe(true);
    expect(hasGeometryEdits({ tagOverrides: { "way/1": { height: "12" } } })).toBe(true);
    expect(hasGeometryEdits({ terrain: [{ lat: 1, lon: 2, height: 4 }] })).toBe(true);
  });

  it("applies feature edits without changing cached elements", () => {
    const edited = applyCityFeatureEdits(elements, {
      hidden: ["way/1"],
      tagOverrides: { "way/2": { height: "14" } },
    });
    expect(edited).toEqual([{ type: "way", id: 2, tags: { building: "yes", height: "14" } }]);
    expect(elements).toHaveLength(2);
    expect(elements[1].tags.height).toBe("8");
  });
});
