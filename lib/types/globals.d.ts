// Ambient types for `npm run typecheck` (tsconfig.check.json).

/** Globals the Playwright harnesses set and poll (see lib/bench.js). */
interface Window {
  __BENCH_MODE?: boolean;
  __BENCH_CITY_DATA_COPY_MODE?: "readonly" | "clone";
  __BENCH_PROFILE_CITY_QUERIES?: boolean;
  __BENCH_ROAD_QUERY_MODE?: "indexed" | "scan";
  __BENCH_GEOMETRY_WORKERS?: number;
  __BENCH_RENDER_SCALE?: number;
  __BENCH_SHADOW_TARGETS?: boolean;
  __BENCH_START_POSE?: { x: number; z: number; heading: number } | null;
  __BENCH_SEED?: number;
  __BENCH_FREEZE_POPULATION?: boolean;
  __BENCH_HIDE_INACTIVE_STREET_LIGHTS?: boolean;
  __BENCH_POSE_APPLIED?: boolean;
  __BENCH_FIXTURE?: unknown;
  __engineReady?: boolean;
  __streetTriangles?: number;
  __streetDebug?: Record<string, unknown>;
  __perfCounters?: { diagnosticsEnabled?: boolean } & Record<string, unknown>;
}

/** Next.js inlines NEXT_PUBLIC_* and NODE_ENV at build time. */
declare const process: { env: Record<string, string | undefined> };
