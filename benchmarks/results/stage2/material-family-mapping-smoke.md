# Building material family mapping smoke

Built the production app after adding the Stage 2.2 material-family mapping,
then ran a 12-second medium-quality walk on
`synthetic-material-families.json` in visible Chrome 156. The CC0 fixture
provides 16 material names: seven canonical/alias pairs across plaster, brick,
stone, metal, glass, concrete and wood, plus two unrecognized names. The walk
moved 60.02 m, its measurement window was valid, and it reported zero browser
or local asset errors.

The 16 inputs produced 10 building factory keys:

| Family | Cache keys | Reason |
| --- | ---: | --- |
| Plaster | 1 | `plaster` and `stucco` share a family and tint |
| Brick | 1 | `brick` and `terracotta` share a family and tint |
| Stone | 2 | `stone` and `sandstone` keep their distinct deterministic tints |
| Metal | 1 | `metal` and `steel` share a family and tint |
| Glass | 1 | `glass` and `curtain wall` share a family and tint |
| Concrete | 1 | `concrete` and `reinforced_concrete` share a family and tint |
| Wood | 1 | `wood` and `timber` share a family and tint |
| Other | 2 | Unknown names use one bounded family, with distinct fallback colors |

This confirms alias normalization and bounded unknown keys while retaining the
existing color differences. The two remaining color variants in stone and
other are useful inputs for Stage 2.3's family-batching and vertex-tint work;
this one fixture smoke does not establish a performance or visual-quality gain.
The raw browser report remains in the local temp directory.
