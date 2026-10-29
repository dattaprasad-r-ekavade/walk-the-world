import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computePrebuiltBuilderRevision,
  readMaterialRevision,
  readThreeVersion,
} from "./scripts/prebuilt-cell-revision.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const threeVersion = readThreeVersion(root);
const materialRevision = readMaterialRevision(root);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_PREBUILT_CELL_BUILDER_REVISION: computePrebuiltBuilderRevision(root, threeVersion),
    NEXT_PUBLIC_PREBUILT_CELL_MATERIAL_REVISION: materialRevision,
  },
  // The public R2 bucket only allows the production origin. Local previews read
  // cells through this same-origin proxy instead (see lib/engine/cityData.js).
  async rewrites() {
    const base = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE;
    return base ? [{ source: "/r2-public/:path*", destination: `${base}/:path*` }] : [];
  },
  // public/ files default to "max-age=0", so every visit revalidates the
  // multi-MB facade textures and the Basis decoder. These paths carry a content
  // hash (scripts/build-runtime-ktx2.mjs), so a changed file always gets a new
  // URL and the old one can be cached forever. Unhashed public files (audio,
  // runtime-manifest.json, sw.js, icon.svg) keep the revalidating default.
  async headers() {
    const immutable = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
    return [
      { source: "/textures/ktx2/:file([^/]+\\.[0-9a-f]{16}\\.(?:ktx2|json))", headers: immutable },
      { source: "/decoders/basis/:revision([0-9a-f]{16})/:file*", headers: immutable },
    ];
  },
  experimental: {
    // DuckDB is a native server dependency used only by the Overture API.
    serverComponentsExternalPackages: ["duckdb"],
  },
};

export default nextConfig;
