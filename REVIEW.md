# Project Review — Walk the World

An honest assessment after ~50 shipped features. Grouped by what makes the
project (a) nicer to use, (b) more impressive as a portfolio piece, (c) safer
to keep building on. Each item: effort S/M/L and payoff 1–5.

## Where the project stands

Strong: two rendering engines with a measured 7× benchmark between them; a
write-through R2 cache architecture used three ways (city cells, Overture
cells, Overture index); live external data (weather, Overture); ~30 OSM
feature types rendered; complete game UI. That's a genuinely unusual breadth
for a solo project and demos well.

Weak: one 1,800-line file carries half the product; zero tests; no deployed
URL; first-load of an uncached cell still takes 5–15 s with a silent screen;
visual quality is "good stylized" but uneven (flat roofs, empty streets).

## A. Better to USE (user experience)

1. **Deploy it** (S, 5). A portfolio project without a URL is a code sample.
   Vercel free tier runs everything except cold Overture cells (which degrade
   gracefully). Nothing on this list matters more.
2. **Loading feedback for slow cells** (S, 4). Uncached cells sit on a bare
   progress bar for up to 15 s. Show *what* is loading ("streaming Rome —
   1,240 buildings…"), and show the world as it streams in rather than
   gating on everything.
3. **Session persistence** (S, 4). Remember last position, settings, and
   view mode in localStorage. Opening the app should resume your walk, not
   reset to the menu.
4. **In-world search** (M, 4). A search box (Nominatim, free) so users can
   type "Eiffel Tower" or their home address instead of clicking a globe.
   This is how everyone will actually want to travel.
5. **Seamless cell streaming** (L, 5). The single biggest UX ceiling: walking
   ~650 m hits the edge of the loaded world. Neighbor data is already
   prefetched into R2 — the engine just doesn't *render* it. Streaming
   neighboring cells into the scene (and evicting behind you) makes the world
   feel infinite and is the feature that turns a demo into a product.
6. **Mobile/touch controls** (M, 3). Virtual joystick + drag look. Recruiters
   open links on phones.
7. **Share links** (S, 3). "📤 Share this spot" copying /street?lat&lon —
   free virality, trivial to add.

## B. More VALUABLE (portfolio impact)

8. **A 60-second demo video / GIF in the README** (S, 5). Nobody runs your
   code; everybody watches the GIF. Record: globe spin → fly-down → walk
   Paris → rain toggle → night lamps → bridge over Thames.
9. **Write the story down** (S, 5). The repo has the raw material for an
   exceptional engineering blog post: "I benchmarked Cesium at street level,
   rewrote the engine in Three.js, measured 7×, and built a write-through R2
   cache so the whole planet costs $6/month." Recruiters remember narratives
   with numbers, not feature lists.
10. **CI + a smoke test** (S, 4). One GitHub Action: `next build` + the
    existing Playwright flow (menu → travel → engine ready, zero pageerrors).
    Cheap signal that says "this person ships responsibly."
11. **Architecture diagram in the README** (S, 3). Browser ⇄ Next API ⇄
    R2 ⇄ Overpass/Overture/Open-Meteo. One image explains the system faster
    than any prose.

## C. Safer to BUILD ON (code health)

12. **Split StreetEngine.js** (M, 4). 1,804 lines, one useEffect. Natural
    seams already exist: `engine/terrain.js`, `engine/city.js` (parse+build),
    `engine/props.js`, `engine/player.js`, `engine/sky.js`, `engine/hud.jsx`.
    Do this before the next feature, not after — every future change gets
    cheaper.
13. **Extract shared HUD components** (S, 3). Settings panel, travel panel,
    pause menu are duplicated between page.js and StreetEngine with drift
    already visible (Cesium settings has an engine toggle; street's doesn't).
14. **TypeScript on lib/ + API routes** (M, 3). The server boundary (R2,
    Overture, key parsing) is where types pay for themselves. The engine can
    stay JS.
15. **Error boundaries + telemetry hooks** (S, 2). A React error boundary
    around the engines with a "reload world" button; count cache hit/miss to
    console for tuning.
16. **Dead code sweep** (S, 2). `AVATAR_URL`/GLTF remnants in Globe.js,
    `makeRoadTexture(false)` unused path, ovt_test/batch scripts in /tmp
    only — quick tidy.

## Suggested order

Week 1 (all small): deploy → GIF + story in README → session persistence →
share links → CI smoke test. This converts existing work into visible value.

Week 2: split StreetEngine (12) *then* seamless streaming (5) — the refactor
makes the flagship feature tractable. Search (4) rounds it out.

Skip for now: multiplayer, missions (already descoped), photoreal modes —
they dilute the "fast stylized world from open data" identity that makes
this project distinctive.
