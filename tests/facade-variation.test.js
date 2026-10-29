import { describe, it, expect } from "vitest";
import { hashSeed, INTERIOR_ROOM_ATLAS_LAYOUT, wallTintJitter, wantsStorefront } from "@/lib/engine/facade-uv";
import { patchInteriorMappingShader } from "@/lib/engine/interior-mapping";

describe("facade variation", () => {
  it("hashes deterministically and spreads ids", () => {
    expect(hashSeed(123456789012)).toBe(hashSeed(123456789012));
    expect(hashSeed(1)).not.toBe(hashSeed(2));
  });
  it("keeps tint within tasteful bounds", () => {
    for (let i = 1; i < 200; i++) {
      const t = wallTintJitter(i * 7919);
      for (const v of [t.r, t.g, t.b]) { expect(v).toBeGreaterThan(0.8); expect(v).toBeLessThan(1.2); }
    }
  });
  it("treats amenities and offices as storefronts", () => {
    expect(wantsStorefront({ amenity: "bank" })).toBe(true);
    expect(wantsStorefront({ building: "house" })).toBe(false);
  });
  it("keeps eight room cubes in a compact six-face atlas", () => {
    expect(INTERIOR_ROOM_ATLAS_LAYOUT).toEqual({
      width: 768,
      height: 256,
      rooms: 8,
      faceSize: 64,
      faceColumns: 12,
      faceRows: 4,
    });
  });
  it("patches facade shaders with distance-bounded ray-box interiors and shared lighting uniforms", () => {
    const roomAtlas = {};
    const intensity = { value: 0.6 };
    const shader = {
      uniforms: {},
      vertexShader: "#include <common>\nvoid main() {\n#include <project_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main() {\n#include <map_fragment>\n#include <emissivemap_fragment>\n}",
    };
    patchInteriorMappingShader(shader, roomAtlas, intensity);
    expect(shader.uniforms.wtwRoomAtlas.value).toBe(roomAtlas);
    expect(shader.uniforms.wtwInteriorIntensity).toBe(intensity);
    expect(shader.vertexShader).toContain("vWtwWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
    expect(shader.fragmentShader).toContain("smoothstep(32.0, 40.0");
    expect(shader.fragmentShader).toContain("wtwSampleInteriorRoom( vMapUv");
    expect(shader.fragmentShader).toContain("totalEmissiveRadiance += wtwInteriorSample.rgb");
  });
});
