# Asset Credits

3D models served from the R2 asset library (`assets/` prefix) and used by the
populated-world system (`lib/engine/population.js`):

| Asset | Model | Author | License | Source |
|---|---|---|---|---|
| `car.glb` | Vehicle Truck (red) | Kenney | CC0 1.0 | [Starter Kit Racing](https://github.com/KenneyNL/Starter-Kit-Racing) |
| `bird.glb` | Stork | three.js examples (mirada / ro.me) | CC-BY | [three.js repo](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf) |
| `test-cube.glb` | Test cube | generated in-repo | — | — |

Pedestrians currently use the built-in low-poly walker: rigged character GLBs
(e.g. KayKit's CC0 Adventurers) merge into their T/A bind pose when instanced
statically, which reads as broken. Swapping them in properly needs the skinned
instancing planned in Phase 13.1 follow-up. Any *static-posed* character GLB
uploaded as `pedestrian.glb` will work today.

To replace any of these: upload a `.glb` with the same name at `/editor`
(models should face +Z; sideways-authored vehicles are auto-rotated).
