import { describe, it, expect } from "vitest";
import { hashSeed, wallTintJitter, wantsStorefront } from "@/lib/engine/facade-uv";

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
});
