# OSM Tag Catalog — candidate features for the Street Engine

Every entry is real, queryable via our existing Overpass pipeline. Legend:
**Geo** = node (point) / way (line) / area (polygon) · **Effort** S/M/L ·
**Impact** = how much it changes game feel (1–5) · ✅ = already implemented.

## 1. Roads & movement
| Tag | What | Geo | Render idea | Effort | Impact |
|---|---|---|---|---|---|
| `highway=*` ✅ | all road classes | way | decal ribbons + texture paint | — | — |
| `bridge=yes` ✅ | bridges | way | deck + railings + pillars, walkable | — | — |
| `highway=steps` | staircases | way | stepped geometry, walkable | M | 3 |
| `highway=crossing` | zebra/pelican crossings | node | stripes painted on road | S | 3 |
| `highway=traffic_signals` | traffic lights | node | signal pole asset | S | 3 |
| `highway=stop` / `give_way` | stop signs | node | sign post | S | 2 |
| `highway=bus_stop` | bus stops | node | shelter + sign + name | S | 3 |
| `tunnel=yes` | tunnels (currently skipped) | way | portal entrance + darkened bore | L | 3 |
| `highway=turning_circle` | cul-de-sac circles | node | round asphalt patch | S | 1 |
| `junction=roundabout` | roundabouts | way | center island + curb | M | 2 |
| `surface=*` | asphalt/cobble/gravel/dirt | tag on way | per-road texture variant | M | 3 |
| `oneway=yes` | one-way streets | tag on way | arrow markings on asphalt | S | 2 |

## 2. Rail & transit
| Tag | What | Geo | Render idea | Effort | Impact |
|---|---|---|---|---|---|
| `railway=rail/tram` ✅ | tracks | way | ballast + sleepers + rails | — | — |
| `railway=station` ✅ | stations | node | platform + canopy + sign | — | — |
| `railway=platform` | actual platform outlines | way/area | replace guessed platform box | M | 2 |
| `railway=level_crossing` | road/rail crossings | node | barriers + warning signs | S | 2 |
| `railway=subway_entrance` | metro entrances | node | stair portal + M sign | S | 3 |
| `aerialway=cable_car/gondola` | cable cars | way | cables + moving cabins | L | 4 |
| `route=ferry` | ferry routes | way | dashed water route + dock | M | 2 |

## 3. Aviation & water transport
| Tag | What | Geo | Render idea | Effort | Impact |
|---|---|---|---|---|---|
| `aeroway=runway/taxiway` | airports | way/area | wide marked concrete | M | 4 |
| `aeroway=terminal` | terminals | area | (already a building) label | S | 1 |
| `man_made=pier` | piers/boardwalks | way | wooden deck over water (bridge tech) | S | 3 |
| `leisure=marina` | marinas | area | moored boat boxes | M | 2 |
| `waterway=dam/weir` | dams | way | concrete wall across water | M | 2 |
| `man_made=lighthouse` | lighthouses | node | striped tower + rotating light | S | 3 |

## 4. Street furniture & city detail
| Tag | What | Geo | Render idea | Effort | Impact |
|---|---|---|---|---|---|
| `highway=street_lamp` | street lamps | node | lamp post, GLOWS at night (time slider!) | S | **5** |
| `amenity=bench` | benches | node | bench asset | S | 2 |
| `amenity=fountain` | fountains | node | basin + animated water jet | M | 3 |
| `amenity=waste_basket` | bins | node | small bin | S | 1 |
| `advertising=billboard` | billboards | node | panel on posts | S | 2 |
| `amenity=telephone` | phone boxes | node | red box (iconic in UK) | S | 1 |
| `barrier=wall/fence/hedge` | linear barriers | way | low wall/fence lines + collision | M | **4** |
| `barrier=gate/bollard` | gates, bollards | node | small blockers | S | 2 |
| `man_made=flagpole` | flagpoles | node | pole + waving flag | S | 2 |
| `amenity=parking` | parking lots | area | painted bays + parked car boxes | M | 3 |
| `amenity=fuel` | petrol stations | area/node | canopy + pumps + price sign | M | 3 |
| `amenity=charging_station` | EV chargers | node | charger unit | S | 1 |

## 5. Shops & POIs (the "living city" layer)
| Tag | What | Geo | Render idea | Effort | Impact |
|---|---|---|---|---|---|
| `shop=*` + `name` | every shop, with names | node/area | storefront sign on facade | M | **5** |
| `amenity=restaurant/cafe/bar` | eateries | node/area | sign + awning + outdoor tables | M | **5** |
| `amenity=pharmacy/bank/atm` | services | node | icon signs (green cross, etc.) | S | 3 |
| `amenity=hospital/school/police/fire_station` | civic buildings | area | roof icon + label + tint | S | 3 |
| `amenity=place_of_worship` + `religion` | churches/mosques/temples | area | spire/dome/minaret hint on roof | M | 4 |
| `tourism=hotel/attraction/viewpoint` | tourist POIs | node | label markers | S | 2 |
| `amenity=marketplace` | markets | area | stall clusters | M | 3 |
| `craft=*` / `office=*` | workshops, offices | node | door plaques | S | 1 |

## 6. Nature & land cover
| Tag | What | Geo | Render idea | Effort | Impact |
|---|---|---|---|---|---|
| `natural=tree` ✅ | individual trees | node | instanced low-poly trees | — | — |
| `natural=water` ✅ / parks ✅ | water/green areas | area | colored polygons | — | — |
| `natural=beach` / `natural=sand` | beaches | area | sand texture paint | S | 3 |
| `natural=cliff` | cliffs | way | rock wall strip | M | 2 |
| `natural=bare_rock/scree` | rock fields | area | rock texture paint | S | 2 |
| `landuse=farmland/orchard/vineyard` | agriculture | area | field-row textures / vine rows | M | 3 |
| `natural=tree_row` | tree lines | way | instanced trees along line | S | 3 |
| `leisure=garden` | gardens | area | flowerbed color patches | S | 2 |
| `natural=peak` + `name` + `ele` | mountain summits | node | summit cross + name/elevation sign | S | 3 |
| `natural=spring/geyser` | springs | node | small water feature | S | 1 |
| `waterway=waterfall` | waterfalls | node | particle water sheet | M | 3 |

## 7. Sports & recreation
| Tag | What | Geo | Render idea | Effort | Impact |
|---|---|---|---|---|---|
| `leisure=pitch` + `sport=*` | sports fields | area | correct court lines (soccer/tennis/basket) | M | **4** |
| `leisure=swimming_pool` | pools | area | blue water + tile edge | S | 3 |
| `leisure=playground` | playgrounds | area | swing/slide assets | M | 2 |
| `leisure=stadium` | stadiums | area | ring stand geometry | L | 3 |
| `leisure=golf_course` | golf courses | area | green/fairway/bunker paint | M | 2 |
| `piste:type=*` | ski runs | way | white run + difficulty color poles | M | 2 |
| `leisure=track` | running tracks | area | red oval with lanes | M | 2 |

## 8. Landmarks & industry
| Tag | What | Geo | Render idea | Effort | Impact |
|---|---|---|---|---|---|
| `man_made=tower` + `tower:type` | comms/observation towers | node | lattice mast / tower | S | 3 |
| `man_made=chimney` | industrial chimneys | node | tall cylinder + smoke particles | S | 2 |
| `man_made=water_tower` | water towers | node | mushroom tank | S | 2 |
| `man_made=windmill` | windmills | node | classic windmill | S | 2 |
| `generator:source=wind` | wind turbines | node | turbine with SPINNING blades | M | **4** |
| `power=tower` + `power=line` | pylons + cables | node+way | pylon chain with hanging wires | M | 4 |
| `man_made=silo/storage_tank` | tanks, silos | node/area | cylinders | S | 1 |
| `man_made=crane` | harbor/construction cranes | node | crane arm | M | 2 |
| `historic=monument/memorial` | monuments | node | plinth + label | S | 2 |
| `historic=castle/ruins/fort` | castles, ruins | area | crenellated walls / broken walls | M | 3 |
| `historic=city_gate/citywalls` | old walls & gates | way | stone wall run + arch | M | 3 |
| `man_made=obelisk` | obelisks | node | obelisk | S | 1 |

## 9. Building detail (tags ON buildings we already draw)
| Tag | What | Render idea | Effort | Impact |
|---|---|---|---|---|
| `building:levels` ✅ | floor count | height calc | — | — |
| `roof:shape=gabled/hipped/pyramidal` | roof forms | real roof geometry instead of flat | L | **4** |
| `building:colour` / `roof:colour` | mapped colors | use the actual colors | S | 3 |
| `building=church/mosque/temple` | worship types | spire/dome/minaret add-on | M | 4 |
| `building=greenhouse/garage/shed` | small types | glass/simple variants | S | 1 |
| `addr:housenumber` | house numbers | tiny door plaques | S | 2 |

## 10. Ambient / gameplay hooks (data, not geometry)
| Tag | What | Use idea | Effort | Impact |
|---|---|---|---|---|
| `opening_hours` | shop hours | lit shopfronts only when open (time slider!) | M | 3 |
| `maxspeed` | speed limits | speed-limit signs | S | 1 |
| `name:*` | multilingual names | local-script signs (adds authenticity) | S | 3 |
| `wikipedia`/`wikidata` | encyclopedia links | "inspect" a landmark → info card | M | 3 |
| `population` (on place nodes) | city sizes | richer location toast | S | 1 |
| `capital=yes` | capitals | special label on globe | S | 1 |

## Suggested bundles (pick one per session)
- **A. Night city**: street_lamp + traffic_signals + lit windows by `opening_hours` — transforms the time slider into a feature.
- **B. Living streets**: shop/restaurant signs with real names + awnings + benches + bus stops.
- **C. Countryside**: farmland textures + tree_row + wind turbines + power pylons + peaks with summit signs.
- **D. Real buildings v2**: roof shapes + building:colour + worship-building silhouettes.
- **E. Sports & leisure**: pitches with court lines + pools + playgrounds.
- **F. Industrial waterfront**: piers + cranes + silos + lighthouse + marinas.
