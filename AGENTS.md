# AGENTS.md

## Cursor Cloud specific instructions

This repo is a single **Next.js 14** app ("Walk the World") — a client-side 3D
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
- **`npm run lint` is interactive and will hang.** The repo ships no ESLint
  config, so `next lint` prompts "How would you like to configure ESLint?" and
  waits for TTY input. There is no committed non-interactive lint setup.
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
- Build: `npm run build` (Next.js production build). Cesium is not bundled, so
  builds are fast and don't need network for the build itself.
