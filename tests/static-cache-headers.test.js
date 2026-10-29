import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import nextConfig from "../next.config.mjs";
import { BASIS_TRANSCODER_PATH, RUNTIME_LAYOUT_URL, RUNTIME_TEXTURE_URLS } from "../lib/engine/runtime-texture-assets.js";

const require = createRequire(import.meta.url);
const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match");

async function cacheControlFor(pathname) {
  const rules = await nextConfig.headers();
  const hit = rules.find((rule) => getPathMatch(rule.source, { strict: true, removeUnnamedParams: true })(pathname));
  return hit?.headers.find((h) => h.key === "Cache-Control")?.value ?? null;
}

describe("static asset cache headers", () => {
  it("marks every content-hashed runtime asset immutable", async () => {
    const hashed = [
      ...Object.values(RUNTIME_TEXTURE_URLS),
      RUNTIME_LAYOUT_URL,
      `${BASIS_TRANSCODER_PATH}basis_transcoder.js`,
      `${BASIS_TRANSCODER_PATH}basis_transcoder.wasm`,
    ];
    for (const url of hashed) expect(await cacheControlFor(url), url).toMatch(/immutable/);
  });

  it("leaves unversioned public files on the revalidating default", async () => {
    for (const url of ["/textures/ktx2/runtime-manifest.json", "/audio/day.ogg", "/sw.js", "/icon.svg",
      "/decoders/basis/basis_transcoder.wasm", "/textures/ktx2/facade-basecolor.ktx2"]) {
      expect(await cacheControlFor(url), url).toBeNull();
    }
  });
});
