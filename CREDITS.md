# Asset Credits

3D models served from the R2 asset library (`assets/` prefix) and used by the
populated-world system (`lib/engine/population.js`):

| Asset | Model | Author | License | Source |
|---|---|---|---|---|
| `car.glb` | Vehicle Truck (red) | Kenney | CC0 1.0 | [Starter Kit Racing](https://github.com/KenneyNL/Starter-Kit-Racing) |
| `bird.glb` | Stork | three.js examples (mirada / ro.me) | CC-BY | [three.js repo](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf) |
| `test-cube.glb` | Test cube | generated in-repo | — | — |

Pedestrians use a procedural walk-cycle vertex shader (`lib/engine/ped-walk.js`)
so built-in instances animate without a Blender VAT bake. Optional
`pedestrian.glb` still overrides geometry (static material). Full VAT textures
from OpenVAT remain a drop-in upgrade later.

To replace any of these: upload a `.glb` with the same name at `/editor`
(models should face +Z; sideways-authored vehicles are auto-rotated).

## Audio

Ambient music uses a synthesized day/night pad by default (no external files).
Optional CC0 loops can be dropped at `public/audio/day.ogg` and
`public/audio/night.ogg` — the ambience system picks them up automatically.

| Asset | Notes | License | Suggested sources |
|---|---|---|---|
| `day.ogg` / `night.ogg` (optional) | Loopable exploration beds | Prefer CC0 | [Pixabay Music](https://pixabay.com/music/search/cc0/), [OpenGameArt CC0](https://opengameart.org/content/cc0-music-0), Kenney audio packs |

## Imagery

| Layer | Provider | License / terms |
|---|---|---|
| Street ground (default) | OpenStreetMap raster tiles | © OpenStreetMap contributors |
| Street ground (satellite toggle) | Esri World Imagery | Free for non-commercial apps; attribution required |
| Elevation | AWS Terrarium (Mapzen) | Open data |

## Materials & lighting (17.1 / 17.2)

Street materials are procedural PBR (`lib/engine/materials.js`) with optional
CC0 photoscanned maps later (Poly Haven / ambientCG → R2 or `/public/textures`).
IBL uses a procedural equirect sky → PMREM (`lib/engine/env-map.js`); swap in
Poly Haven HDRIs when hosted.
