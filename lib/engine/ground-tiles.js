/** Ground imagery tile URL for a slippy z/x/y. */
export function groundTileUrl(source, z, x, y) {
  if (source === 'satellite') {
    // Esri World Imagery — free for non-commercial use with attribution
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  }
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}
