# Walk the World — Game Roadmap

Research-backed plan for evolving the demo into a real game. Ordered so each
phase ships something playable.

---

## The core architectural decision

Photogrammetry (Google 3D Tiles) will always look "melted" up close — it's
scanned mesh, not authored geometry, and it can't be relit, restyled, or made
collision-clean. Every successful map-based game (untethered from Google's
look) solves this the same way: **keep real-world *data*, replace real-world
*visuals***.

Proposed split:

- **Planet / fly mode** — keep CesiumJS as-is: globe, satellite imagery,
  terrain. It's the world map and travel layer.
- **Street / walk mode** — a **Three.js scene generated from open geo data**
  (building footprints + heights, road centerlines, land use, tree points),
  rendered with a consistent stylized art direction. Hand-off happens on
  landing, reusing the current fly-down transition.

A deliberate low-poly / stylized look (think Fortnite map or Monopoly Go, not
GTA) is the correct target: it reads as "designed" rather than "bad photoreal",
renders fast on the web, and never looks melted.

---

## 1. Realistic game-type environment

- **Lighting & atmosphere first** — a day/night cycle (sun position from real
  local time), fog, bloom, and ambient occlusion do more for perceived quality
  than any geometry upgrade. Three.js post-processing gives all of this;
  Cesium's `CustomShader` covers the interim.
- **Ground detail** — procedural sidewalks/curbs from road widths, street
  props (lamps, benches, signs) auto-placed along roads, grass/scatter on
  green land-use polygons.
- **Sound** — ambient loops by land use (traffic in cities, birds in forests,
  waves near coasts). Cheap and hugely immersive.
- **Interim quick win (current app):** swap Google tiles for **Cesium OSM
  Buildings** styled with a CustomShader (per-building colors from metadata,
  emissive windows at night). Ships in days, kills the melted look now.

## 2. Cleanest data without high cost

| Layer | Source | Cost |
|---|---|---|
| Terrain (elevation) | AWS Open Data **Terrarium tiles** (S3, no key) or **Re:Earth** quantized-mesh (free, no signup) | $0 |
| Buildings (footprint + height) | **Overture Maps** GeoParquet dumps (OSM + Microsoft ML footprints conflated, CC-BY-ish licensing) | $0 (one-time processing) |
| Roads / land use / water | Overture or OSM extracts → **PMTiles** (single static file, serve from any CDN/R2 — no tile server) | ~$0 hosting |
| Tree/vegetation points | OSM `natural=tree`, forest polygons → instanced placement | $0 |
| Satellite imagery (globe only) | Sentinel-2 cloudless (EOX, free w/ attribution); keep ion free tier for dev | $0 |
| Google P3DT (optional "photo mode") | $6/1,000 sessions after 1k free/month | keep off by default |

Pipeline: preprocess Overture into per-cell (geohash) binary chunks once,
host statically. Runtime streams cells around the player — no paid APIs in
the hot path. Cesium ion commercial ($149/mo) only becomes relevant if you
keep ion assets in production.

## 3. Replacing melted assets

Generate geometry from data + dress it with CC0 asset packs:

- **Buildings**: extrude Overture footprints by height/levels; procedural
  facade shader (window grids, per-type palettes). Landmark buildings can get
  hand-made models over time (id-keyed overrides).
- **Roads**: ribbon meshes from centerlines with class-based width/markings
  (motorway vs residential vs footpath).
- **Mountains/terrain**: DEM heightmap meshes with tri-planar stylized
  texturing by slope/altitude (grass → rock → snow).
- **Trees/props**: instanced low-poly models — **Kenney.nl** and
  **Quaternius** packs are CC0 (free, no attribution, commercial OK).
- One consistent palette + toon/gradient shading ties it all together.

## 4. Third-person view & customizable character

- **Avatar format: VRM** (open standard, `three-vrm` library). Note: Ready
  Player Me shut down its developer platform Jan 2026 — avoid depending on
  avatar SaaS. Ship 3–5 base CC0 characters with color/outfit swaps
  (material tints + mesh toggles) stored in the player profile.
- **Animation**: Mixamo clips (idle/walk/run/jump) retargeted once; blend by
  speed.
- **Camera**: chase cam (4–6 m behind, shoulder offset, collision raycast so
  walls don't clip), V to toggle first/third person. Straightforward in the
  Three.js street mode; the existing walker logic (position + heading +
  terrain clamp) already drives it — the avatar just renders at the walker's
  position.

## 5. Multiplayer & chat

- **Server: Colyseus** (Node, MIT) — authoritative rooms, delta-compressed
  state sync, built-in patterns for join/leave/chat. Mature and self-hostable
  (~$5–10/mo VM to start). Alternative: PartyKit/Cloudflare Durable Objects
  if you prefer edge serverless.
- **World sharding**: one room per geohash cell (~1–2 km); players see others
  in their cell + neighbors. This scales globally without a mega-server.
- **Net model**: client sends input at ~10 Hz; server broadcasts positions;
  clients interpolate. Avatar + name + chat bubble above head; cell-local
  text chat channel to start (voice later via WebRTC if wanted).
- **Identity**: anonymous guest IDs first; add auth (e.g. Clerk/Supabase)
  when persistence matters.

## 6. GeoGuessr-style mission system

- **Image source: Mapillary** (Meta) — free API, openly licensed street-level
  photos worldwide; it's what open-source GeoGuessr clones (StreetSeekr,
  MapillaryGeoGuessr) use. Google Street View imagery is paid and its license
  effectively forbids this use.
- **Loop**: mission gives a Mapillary photo taken within X km of the player
  (or in a chosen city) → player walks/navigates to it → arrival detected by
  haversine distance (< 30 m) → score = f(distance walked, time, hints used).
- **Design**: daily missions, difficulty = photo radius (500 m / 5 km /
  city-wide), hint system (compass warmth, minimap circle shrink), shared
  leaderboard on the multiplayer backend. Co-op: first-to-reach races in a
  cell.

---

## Suggested phases

1. **Style pass (1–2 weeks)** — Cesium OSM Buildings + CustomShader, day/night,
   fog, free terrain sources. Current app, immediate visual payoff.
2. **Street renderer (the big one)** — Three.js cell-streaming world from
   Overture/OSM, stylized assets, third-person avatar.
3. **Multiplayer** — Colyseus rooms per cell, presence + chat.
4. **Missions** — Mapillary integration, scoring, daily rotation, leaderboard.

Each phase is independently shippable; 1 and 4 don't depend on 2/3.
