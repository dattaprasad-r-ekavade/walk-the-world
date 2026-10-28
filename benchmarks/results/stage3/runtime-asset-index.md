# Stage 3.8 — runtime asset indexing and cache revision

## Generated revision

`npm run assets:runtime-index` indexed the checked-in KTX2 outputs without
re-encoding them. Revision `2cabdc7afd0aa7be` hashes all six selected UASTC
textures, the high-atlas layout, and the pinned Basis decoder files. Runtime
textures and layout now use SHA-256-derived filenames; Basis files are under
`public/decoders/basis/27d64d5307fe00de/`. The generated URL module is
`lib/engine/runtime-texture-assets.js`, and
`public/textures/ktx2/runtime-manifest.json` records the full output hashes.

The same revision is embedded in `public/sw.js` as the shell cache key. The
service worker caches versioned assets as immutable, uses network-first caching
for other same-origin GET requests, skips API routes and its own script, and
removes only obsolete `wtw-shell-*` caches.

## Runtime behavior

`createKtx2BuildingTextureLoader` now waits for `input-ready` before initializing
the Basis decoder or fetching either KTX2 tier. The high tier still loads only
when quality is high. Existing failure handling leaves the procedural facade
maps active when shared maps fail, and keeps the current maps when high detail
fails. These maps remain optional to scene creation and walking.

## Verification and remaining gates

- The runtime index command verified the existing selected KTX2 file hashes
  against `assets/manifest.json` and completed using the pinned Three.js decoder
  files. The standalone KTX-Software encoder was not installed in this checkout,
  so this run did not re-encode the maps.
- Repeating `npm run assets:runtime-index` produced the same revision and paths.
  The content-hash generator, generated URL module, runtime loader and service
  worker pass Node syntax checks. `npm run build` completed successfully with
  the generated URL module.
- Browser offline/failure behavior, cold `input-ready` timing, mobile residency,
  low-memory residency and production publication remain release checks.
