# Changelog

## Portfolio transformation — 2026-07-13

- Introduced a custom navigation/trail brand system and application icon.
- Reframed the title screen around a guided 60-second Shibuya demo.
- Added a concise explanation of the open-data, worker, streaming, and AI pipeline.
- Redesigned the HUD for desktop and mobile, including smaller mobile controls.
- Hidden FPS, altitude, editor, and map-tag tools behind Developer Tools settings.
- Added an AI World Repair audit with structured output, provenance, confidence,
  risk levels, strict validation, and a deterministic no-key fallback.
- Added PWA manifest/service worker, reduced-motion handling, focus styles,
  and additional tests.
- Fixed relative GLTF texture URL flattening for nested texture paths.
- Replaced ambiguous “Loading neighborhood” language with non-blocking streaming state.

## Earlier engineering milestones

- Replaced the original Cesium street walker with a custom Three.js street engine.
- Added R2 city caching, Overture fallback, category-aware Overpass queries, and
  progressive terrain-first rendering.
- Added worker-based city geometry construction and seamless neighbor streaming.
- Added procedural PBR materials, facade atlases, weather, time, shadows, SSAO,
  bloom, audio, pedestrians, traffic, birds, and drivable vehicles.
- Added photo mode, walk passport, daily destinations, location guessing, sharing,
  touch controls, editor/debug tooling, and adaptive GPU quality.
- Added benchmark fixtures and unit/smoke coverage.

Detailed historical implementation is available in git history before this
portfolio-focused roadmap consolidation.
