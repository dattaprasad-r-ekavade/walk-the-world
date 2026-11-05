# AGENTS.md

## Cursor Cloud specific instructions

This repo is a single **Next.js 16** app (React 19) ("Walk the World") — a client-side 3D
globe/street-level exploration game. There is one service; no database, no auth,
and no other backing processes are required. Standard commands live in
`package.json` `scripts` and the `README.md`; only non-obvious caveats are noted
here.

### Running the app
- Dev server: `npm run dev` (Turbopack) serves on `http://localhost:3000`. The
  globe is at `/`; the street-level engine is at `/street?lat=..&lon=..`.
- The app runs with **zero config**. All tokens in `.env.local.example`
  (Cesium ion, Google Maps, Cloudflare R2, Overture) are optional — without them
  it falls back to Natural Earth imagery + live Overpass/OSM data, which is
  enough to load the globe, fast-travel to a city, and walk around.

### Network egress is required at runtime
The client and API routes fetch from public services (no keys needed): unpkg CDN
(CesiumJS bundle/workers), Overpass API (`overpass-api.de`, OSM building/road
data), Carto/OSM basemap tiles, AWS Terrarium terrain tiles, and BigDataCloud
(reverse geocoding). If these are blocked, the globe still loads but cities won't
populate with buildings.

### Non-obvious gotchas
- **Lint:** `npm run lint` runs the ESLint 9 CLI with `eslint.config.mjs`
  (Next 16 removed `next lint`) and fails on any warning. The React Compiler
  purity rules are on as errors: keep imperative engine state in
  `lib/engine/street/runtime.js` / `lib/globe/runtime.js`, not in components.
- **Benign dev-log noise:** `Failed to set fetch cache ... items over 2MB cannot
  be cached` appears when large Overpass responses exceed Next.js's 2MB fetch
  cache limit. This is not an error — the `/api/city/*` routes still return 200
  and the city loads normally.
- **Lazy cell loading:** the Street Engine fetches new OSM city cells as you walk
  into new areas, briefly showing the "STREET ENGINE / BUILDING CITY…" loading
  spinner. This is expected, not a crash.
- The optional Overture buildings layer needs a one-time `npm run overture-index`
  (~15–25 min) plus R2 credentials; skip unless specifically working on it.

### Tests / build
- Tests: `npm run test` (Vitest, runs headless, no external deps).
- Types: `npm run typecheck` checks every module that starts with
  `// @ts-check` and is listed in `tsconfig.check.json` (JSDoc types, no build
  step). New modules should opt in.
- End-to-end: `npm run test:e2e -- http://127.0.0.1:3456` against a running
  build (`npm run build && npm start -- -p 3456`). Offline: it loads the Rome
  fixture and aborts all external requests. Set `PLAYWRIGHT_CHROMIUM_PATH` to
  use a preinstalled Chromium.
- Build: `npm run build` (Next.js production build). Cesium is not bundled, so
  builds are fast and don't need network for the build itself.
- `npm run check` runs lint, typecheck, tests and build: what CI's `check`
  job runs. CI's `e2e` job then runs the smoke test on the build.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
