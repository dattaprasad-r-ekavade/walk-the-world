import { describe, expect, it } from "vitest";
import {
  applyCellEnrichment,
  deriveOvertureBuildingPatches,
} from "../lib/engine/cell-enrichment.js";

describe("Overture building attribute patches", () => {
  it("normalizes all supported attributes and applies them to the matching OSM way", () => {
    const city = {
      elements: [{ type: "way", id: 101, tags: { building: "apartments" } }],
    };
    const overture = [{
      osmWayIds: [101],
      height: 12.34,
      numFloors: 4,
      roofShape: "half_hipped",
      roofColor: "#ABC",
      facadeColor: "#A1B2C3",
      facadeMaterial: "timber_framing",
    }];

    const result = deriveOvertureBuildingPatches(city, overture);

    expect(result).toEqual({
      patches: {
        "way/101": {
          height: "12.3",
          "building:levels": "4",
          "roof:shape": "half-hipped",
          "roof:colour": "#abc",
          "building:colour": "#a1b2c3",
          "building:material": "timber_framing",
        },
      },
      matched: 1,
      fields: 6,
    });

    const enriched = applyCellEnrichment({
      ...city,
      enrichment: { version: 1, patches: result.patches },
    });
    expect(enriched.elements[0].tags).toEqual({
      building: "apartments",
      height: "12.3",
      "building:levels": "4",
      "roof:shape": "half-hipped",
      "roof:colour": "#abc",
      "building:colour": "#a1b2c3",
      "building:material": "timber_framing",
    });
    expect(city.elements[0].tags).toEqual({ building: "apartments" });
  });

  it("preserves existing OSM and enrichment values and ignores non-building ways", () => {
    const city = {
      elements: [
        {
          type: "way",
          id: 201,
          tags: {
            building: "yes",
            height: "14",
            "roof:shape": "gabled",
            "building:color": "#445566",
          },
        },
        { type: "way", id: 202, tags: { building: "no" } },
        { type: "way", id: 203, tags: { highway: "residential" } },
      ],
    };
    const existingPatches = {
      "way/201": {
        "building:levels": "8",
        "roof:colour": "#123abc",
        "building:material": "stone",
      },
    };
    const overture = [{
      osmWayIds: [201, 202, 203, 999],
      height: 25,
      numFloors: 12,
      roofShape: "mansard",
      roofColor: "#abcdef",
      facadeColor: "#fff",
      facadeMaterial: "glass",
    }];

    expect(deriveOvertureBuildingPatches(city, overture, existingPatches)).toEqual({
      patches: {},
      matched: 1,
      fields: 0,
    });
  });

  it("drops invalid or unsupported Overture values instead of writing tags", () => {
    const city = {
      elements: [{ type: "way", id: 301, tags: { building: "yes" } }],
    };
    const overture = [{
      osmWayIds: [301],
      height: 0,
      numFloors: 2.5,
      roofShape: "unknown-roof",
      roofColor: "blue",
      facadeColor: "#12",
      facadeMaterial: "unknown-material",
    }];

    expect(deriveOvertureBuildingPatches(city, overture)).toEqual({
      patches: {},
      matched: 1,
      fields: 0,
    });
  });
});
