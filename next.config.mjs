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
  experimental: {
    // DuckDB is a native server dependency used only by the Overture API.
    serverComponentsExternalPackages: ["duckdb"],
  },
};

export default nextConfig;
