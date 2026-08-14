# Mission — Open-World City Simulator

> **Every real city on Earth, rebuilt as a living open world you can walk and
> drive through.**

The reference feel is the open-world city-sim genre: dense streets, traffic
that behaves, pedestrians with somewhere to be, a drivable car, day/night and
weather, and a camera that makes it look good. We build the *genre*, with our
own art and our own systems, on top of real OpenStreetMap geography — that is
the thing no existing game does.

## What "maximum looks, optimally" actually means here

Be honest about the target. We are not chasing photoreal AAA — that is a
150-person art team. We are chasing **a stylized open world that reads as
deliberate and polished**, where every frame looks intentional. Stylized-but-
coherent beats realistic-but-broken every time, and it is achievable by one
person because it trades art budget for systems.

Three rules that follow from that:

1. **Coherence over fidelity.** One consistent art direction (palette, light,
   material response) makes low-poly look designed. Mixed fidelity makes it
   look unfinished. Never add a detailed asset next to an untextured one.
2. **The corridor is the product.** A city sim is experienced from the street.
   Spend the budget on the ~30 m around the road — surfaces, furniture,
   lighting, life — and let distance fall to silhouettes and fog.
3. **Motion sells more than polygons.** Traffic flowing, pedestrians walking,
   lights changing, cloth/foliage moving. A moving low-poly city reads as more
   alive than a static detailed one, and costs less.

## Ordered roadmap (impact / effort)

### Tier 1 — Unlocks everything else
- [x] **M0. The opening shot.** Not on the original roadmap, found by measuring
      the deployed site: the spawn rule was "nearest walkable road vertex to
      the cell origin, face along the segment". The direction it faced was the
      order OSM happened to *digitise* the way — arbitrary — so the first frame
      was a coin flip between "down a street" and "out at empty ground". Across
      the 18 fast-travel cities, **5 opened on a frame with zero buildings in
      the view cone** (Pune, Seoul, Istanbul, San Francisco, Sydney).
      `lib/engine/street/spawn.js` now ray-marches the view cone against
      building footprints and scores candidate poses on *coverage* (buildings
      in frame) × *openness* (a clear line down the street), plus a road-class
      bonus and a superlinear distance penalty so we don't drift far from the
      requested point. Measured with `scripts/diag-spawn.mjs`:
      **framing 42.3% → 89.7%, empty frames 5 → 1**, median drift 33 m.
      Resume-from-saved-position fixes heading only — relocating there would
      nudge the saved point further every session.
      The one remaining empty frame is Sydney, which is a data bug, not a
      framing one → see the partial-cell note below.
- [x] **M0b. Poisoned cache cells.** Overpass can answer the later statements
      of the combined query while dropping the first, returning a cell with
      every road and no buildings; we only rejected a `remark` when elements
      were *also* empty, so that got written to R2 — which is authoritative,
      so it never healed. **3 of 89 seeded cells were affected** (Sydney had 0
      buildings cached against 678 in OSM; also Nagpur, Panaji). Now detected
      on both write and read (`looksPartial`), never cached, and re-fetchable
      via `GET /api/city/<key>?refresh=1` with the editor key.
      Scan with `scripts/scan-partial-cells.mjs [--all] [--fix --key=...]`.
- [x] **M1. Roads that respond to light.** CORRECTION: the original premise
      here was wrong. Roads were already lit PBR meshes (road decal ribbons
      with MeshStandardMaterial + normal/roughness maps) *in addition to* the
      painted ground canvas. The real blocker was the tuning: the asphalt
      roughness map was baked at 0.92 with `roughness: 1` on top, i.e. almost
      perfectly matte, so no light could leave a specular streak — which is
      why night roads read as flat paint. Fixed: asphalt roughness 0.92 ->
      0.62, envMapIntensity 0.2 -> 0.55, and a `setRoadWetness(0..1)` driven
      by the live weather value that takes roughness down to ~0.28 and pushes
      env reflection to 1.4 for rain-slick mirror streaks (this also delivers
      the road half of M7). Verify the specular on real hardware.
- [ ] **M2. Frame budget headroom.** Confirm the shadow-map fix on real
      hardware, then LOD rings (full detail <150 m, merged silhouettes beyond)
      and frustum culling per merged batch. Target a stable 60 FPS on mid
      hardware *before* adding more content, or every addition feels worse.

### Tier 2 — The look
- [ ] **M3. Street-level surface pass.** Kerbs as geometry (not paint), lane
      markings on the road mesh, crossings, manholes/drains, pavement joints.
      This is what makes a street read as a street.
- [ ] **M4. Corridor furniture, instanced.** Traffic lights on real poles,
      signage, bollards, bins, benches, bus shelters, guardrails, utility
      poles + wires. All from tags we already parse.
- [~] **M5. Night lighting — pooled real streetlights shipped (high tier).**
      `lib/engine/street-lights.js`: a pool of 4 SpotLights re-targeted to the
      nearest lamp posts as the player moves (re-assign only after >12 m, so
      it costs nothing per frame), intensity driven by the same night factor
      as the emissive windows. This is what M1 unlocked — asphalt at 0.62
      roughness can finally show a specular pool under each lamp.
      **Gated to the "high" quality tier**: dynamic lights cost shading on
      every lit fragment and the cost is not yet measured on real GPU
      hardware. Medium/low keep the free fake lighting (glow sprites +
      additive ground pools). Remaining in M5: shopfront light spill,
      brighter vehicle head/taillights, bloom tuning.
- [ ] **M6. Vegetation.** Instanced trees with 2–3 species per climate,
      wind in the vertex shader, hedges and planters. Current cone-trees are
      the most visible remaining "brick game" tell.
- [ ] **M7. Weather + surface state.** Wet roads (roughness drop → mirror
      streaks), puddles, rain splash, fog banks. Cheap, dramatic.

### Tier 3 — The life
- [ ] **M8. Animated pedestrians (VAT).** Bake walk cycles to a vertex
      animation texture; thousands of instances, one draw call. Replaces the
      current procedural bob. Add idle/sit/queue variants at POIs.
- [ ] **M9. Traffic that behaves.** Lane discipline, car-following distance,
      turning at junctions, yielding, horns. Traffic AI is the strongest
      "this city is alive" signal after pedestrians.
- [ ] **M10. Vehicle variety + feel.** 6–8 CC0 vehicle models, per-class
      handling, suspension lean, brake lights, skid marks, engine audio tied
      to load. Currently one truck model for every car.
- [ ] **M11. Crowd behaviour.** Peds react: step aside, cross at crossings,
      cluster at POIs, thin out at night, shelter in rain.

### Tier 4 — The game layer
- [ ] **M12. Objective loop.** Taxi/delivery jobs using real POIs as pickups
      and destinations, timer, earnings, a simple progression. Turns a
      sandbox into something people finish a session in.
- [ ] **M13. Player systems.** Money, unlockable vehicles, stat tracking,
      photo mode, replays.
- [ ] **M14. Radio.** CC0/licensed music channels with station identity —
      swappable, and legally clean (see CREDITS.md rules).
- [ ] **M15. Multiplayer presence.** Ghost players via Cloudflare Durable
      Objects. "3 people driving Tokyo right now" is the demo line.

## Non-negotiables

- **All assets CC0 or explicitly licensed**, recorded in `CREDITS.md`. No
  ripped game assets, no trademarked names, brands, characters or logos —
  ours is an original world built on open map data.
- **Every visual addition ships with its perf cost measured.** Merged or
  instanced by default; a new draw call needs a reason.
- **Nothing gates first paint.** Terrain-walkable in ~2 s stays sacred; the
  city streams in behind it.
- **Verify on real hardware.** The dev sandbox is a software renderer —
  FPS, bloom and z-fighting claims must be confirmed on a real GPU.

## Sequencing

M1 → M2 → M5 → M6 → M3/M4 → M8 → M9/M10 → M12.

Rationale: M1 unlocks the lighting work; M2 buys the frame budget everything
else spends; M5+M6 are the biggest visual deltas per hour; the life layer
lands on a world that can finally show it off; the game layer last, because
it is worthless if the world underneath looks amateur.
