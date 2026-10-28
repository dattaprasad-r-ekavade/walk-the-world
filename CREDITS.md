# Asset Credits

3D models served from the R2 asset library (`assets/` prefix) and used by the
populated-world system (`lib/engine/population.js`):

| Asset | Model | Author | License | Source |
|---|---|---|---|---|
| `car.glb` | Vehicle Truck (red) | Kenney | CC0 1.0 | [Starter Kit Racing](https://github.com/KenneyNL/Starter-Kit-Racing) |
| `bird.glb` | Stork | three.js examples (mirada / ro.me) | CC-BY | [three.js repo](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf) |
| `test-cube.glb` | Test cube | generated in-repo | — | — |
| `colormap.png` | Shared texture for the Kenney vehicle GLBs | Kenney | CC0 1.0 | [Starter Kit Racing](https://github.com/KenneyNL/Starter-Kit-Racing) |

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

| Asset | Track | Author | License | Source |
|---|---|---|---|---|
| `day.ogg` | Ambient Relaxing Loop | isaiah658 | CC0 (no attribution required) | [OpenGameArt](https://opengameart.org/content/ambient-relaxing-loop) |
| `night.ogg` | Nighttime Solitude | celestialghost8 | CC0 | [OpenGameArt](https://opengameart.org/content/nighttime-solitude) |

## Imagery

| Layer | Provider | License / terms |
|---|---|---|
| Street ground (default) | Carto Voyager **nolabels** (OSM data) | © CARTO, © OpenStreetMap contributors — no street-name text on roads |
| Street ground (satellite toggle) | Esri World Imagery | Free for non-commercial apps; attribution required |
| Elevation | AWS Terrarium (Mapzen) | Open data |

## Materials & lighting (17.1 / 17.2)

Street materials remain procedural PBR (`lib/engine/materials.js`). The selected
CC0 maps are preserved under `assets/source/ambientcg/` and assembled into
shared atlases under `assets/processed/materials/`; the Kenney props have
normalised GLB outputs under `assets/processed/props/`. These outputs are not
loaded by the runtime yet. No directional sunlight is baked into the source
albedo maps, and the existing procedural lit-window atlas remains separate.

| Set | Publisher / author | License | Source |
|---|---|---|---|
| Plaster004, Bricks060, Rocks025, Concrete034, Asphalt025A, PavingStones036 | ambientCG (individual creator not exposed in its v3 API) | CC0 1.0 | [ambientCG license](https://docs.ambientcg.com/license/) and the per-asset links in the manifest |
| City Kit Roads 2.2: construction cone/barrier, stop sign, traffic light | Kenney | CC0 1.0 | [Kenney City Kit Roads](https://kenney.nl/assets/city-kit-roads) |

The [asset manifest](assets/manifest.json) records source package and extracted
file hashes, map roles, atlas rectangles and gutters, model bounds, pivots and
front-axis corrections. `npm run assets:build` regenerates the offline outputs;
see [the pipeline notes](assets/README.md) for tool pins and remaining work.
IBL uses a procedural equirect sky → PMREM (`lib/engine/env-map.js`); Poly
Haven HDRIs remain a later option when hosted.
