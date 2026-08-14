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
- [ ] **M1. Roads as lit PBR meshes.** Roads are currently *painted pixels* in
      the terrain canvas, so no light can ever touch them: no specular under
      streetlights, no wet-road reflections, no headlight pools. This is the
      single biggest ceiling on the look. Promote the road corridor (~300 m
      around the player) to real geometry with roughness/normal maps; keep the
      painted canvas for the far field. Everything in Tier 2 depends on it.
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
- [ ] **M5. Night lighting.** Real (pooled) streetlights on the M1 road mesh,
      shopfront spill, vehicle headlights/taillights, bloom on emissives.
      Night is where stylized worlds look best — darkness hides low-poly.
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
