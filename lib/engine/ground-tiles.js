/** Ground imagery tile URL for a slippy z/x/y. */
export function groundTileUrl(source, z, x, y) {
  if (source === "satellite") {
    // Esri World Imagery — free for non-commercial use with attribution
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  }
  // Carto Voyager *without labels* — OSM standard tiles bake street names into
  // the raster and they show through asphalt ribbons. Nolabels keeps parks/
  // water/blocks readable with no text on roads.
  const s = ["a", "b", "c", "d"][(x + y) & 3];
  return `https://${s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/${z}/${x}/${y}.png`;
}
