#!/usr/bin/env node
/**
 * Production build with benchmark hooks enabled (?bench=1 is ignored on normal
 * production builds). Usage: npm run build:bench, then npm run start, npm run bench.
 */
import { spawnSync } from "node:child_process";

const result = spawnSync("npm", ["run", "build"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_PUBLIC_ENABLE_BENCH: "1" },
});
process.exit(result.status ?? 1);
