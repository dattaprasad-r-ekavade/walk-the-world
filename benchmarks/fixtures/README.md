# Benchmark fixtures

The five `synthetic-*.json` files are deterministic test data. They
are generated locally by `npm run fixtures:build`; they do not contain real
street or building locations and are released as data under CC0 1.0. They are
useful for repeatable geometry, density and load tests, but they do not establish
visual fidelity against a real city.

| Fixture | Intended coverage |
| --- | --- |
| `synthetic-showcase.json` | Mixed building types, streets, park, POIs, lamps and signals |
| `synthetic-dense.json` | High building and road count in a compact area |
| `synthetic-sparse.json` | Few buildings with longer connected streets |
| `synthetic-difficult-polygons.json` | Concave outlines and a 96-vertex footprint |
| `synthetic-prop-heavy.json` | 256 repeated static street props for material and draw-call comparisons |
| `synthetic-material-families.json` | Canonical, alias and unknown `building:material` names for family-key coverage |
| `rome-showcase-osm.json` | Real OpenStreetMap features near the Colosseum; ODbL 1.0 |
| `rome-minimal.json` | Existing small smoke-test fixture; not capacity evidence |

The existing minimal Rome fixture has no recorded external source or license
metadata. Treat it as a smoke fixture until that provenance is verified.
The real-city fixture was extracted from the Rome Colosseum area on 27 October
2026 using a bbox of 12.48799,41.88676 to 12.49701,41.89424. It contains 326
building-tagged ways (319 unique footprints after the production deduplication
rule), 1,122 highway ways and 1,176 tagged nodes, including 170
highway-tagged nodes. It uses the engine's existing node/way geometry path;
relations and ways without complete node geometry are not represented. It is
visual/city-shape data, not a capacity-maximizing extract for all of Rome.

The retained source archive is
`source/rome-colosseum-2026-10-27.osm.gz`; it has been stripped of OSM
contributor account/version attributes while preserving IDs, coordinates,
feature tags and way geometry. The adjacent `.provenance.json` records the
provider URL, downloaded-file timestamp, area, original and sanitized archive
SHA-256 hashes and attribution. Regenerate the app-schema JSON with
`npm run fixtures:build:rome`. OSM data is licensed under ODbL 1.0 and requires
attribution; derived databases that are publicly distributed must follow the
applicable share-alike terms. See the [OpenStreetMap copyright and license page](https://www.openstreetmap.org/copyright)
and [BBBike extract service guidance](https://extract.bbbike.org/extract.html).
