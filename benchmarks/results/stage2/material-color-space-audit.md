# Material color-space and output audit

The material audit found these color/data roles in the current renderer:

| Role | Color space | Sources |
| --- | --- | --- |
| Albedo and emissive color | sRGB | Facade/road/rail atlases, terrain tiles, signs, nameplates, environment source, window emissive atlas, sky and lamp glow canvases |
| Normal and roughness data | `NoColorSpace` | Procedural normal and roughness maps |
| Metalness and AO data | Not used by current scene materials | No bindings appeared in the three-tier inventory |
| glTF material maps | glTF-defined | `GLTFLoader` assigns sRGB to base-color and emissive maps; metallic/roughness and normal maps remain data textures |

The emissive facade atlas, the legacy lit-window texture, sky/moon glow
sprites, and lamp glow pools were missing explicit sRGB tags. They now declare
`SRGBColorSpace`. The renderer also sets its drawing-buffer output to sRGB
explicitly and keeps ACES tone mapping. Direct rendering uses that renderer
output path. When post-processing is active, `OutputPass` remains last and
applies the tone/output conversion once after the intermediate passes.

Verification used a production build and two valid 12-second fixture walks:
medium/day exercised direct rendering; high/night exercised the composer.
Both had zero browser or local asset errors. The high/night inventory reported
`srgb` for the albedo and emissive maps and the default no-color-space value for
normal and roughness maps. See the [high/night capture](material-color-space-high-night.png).
