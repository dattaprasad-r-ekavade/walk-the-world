# Walk the World — Active Roadmap

The portfolio transformation is defined in [`plan2.md`](plan2.md). Historical
feature work is summarized in [`CHANGELOG.md`](CHANGELOG.md) and preserved in git.

## North star

> Pick any place on Earth and explore a living 3D interpretation
> of its real streets.

## Product pillars

1. A real place should be recognizable within five seconds.
2. Time, weather, movement, sound, and population should make it feel alive.
3. Reconstruction assistance must be evidence-bound, reversible, and transparent.

## Current release gate

- [x] Preserve desktop/mobile baseline screenshots.
- [x] Replace generic branding and expose a guided portfolio route.
- [x] Separate normal exploration from developer/editor controls.
- [x] Add an evidence-bound AI World Repair audit with safe fallback.
- [x] Add PWA metadata, world-repair tests, and clear streaming states.
- [x] Pass the production build and unit-test workflow.
- [x] Capture matched after screenshots and publish the comparison.
- [x] Remove paid-model dependencies and GitHub workflow automation.
- [x] Keep the free-tier R2 and Overture caching pipeline for Vercel.
- [ ] Deploy and validate the public URL on real mobile devices.

## Performance budgets

- Menu usable in under 2 seconds on a mid-range phone over fast 4G.
- Warm showcase terrain visible in under 2 seconds and interactive in under 4.
- Cold terrain navigable in under 5 seconds while buildings stream.
- 60 FPS target on mid-tier desktop; protected 30 FPS tier on mobile.
- No cell-streaming main-thread hitch over 100 ms.
- No unbounded memory growth during a 15-minute continuous walk.

## External release work

Deployment, production credentials, real-device thermal testing, user interviews,
and third-party monitoring account setup require the owner's accounts or hardware.
See [`RELEASE-CHECKLIST.md`](RELEASE-CHECKLIST.md).
