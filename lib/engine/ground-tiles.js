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

/** Carto/OSM water is a pale blue-grey. Recolour only those pixels so ocean
 * remains visibly blue after Three.js lighting and tone mapping. */
export function isMapWaterRgb(r, g, b) {
  return b >= 175 && g >= 155 && r <= 205 && b - r >= 18 && g - r >= 8;
}

export function drawGroundTileImage(ctx, image, dx, dy, size, source = "osm") {
  if (source === "satellite" || typeof document === "undefined") {
    ctx.drawImage(image, dx, dy, size, size);
    return;
  }
  try {
    const sample = document.createElement("canvas");
    sample.width = sample.height = 256;
    const sg = sample.getContext("2d", { willReadFrequently: true });
    sg.drawImage(image, 0, 0, 256, 256);
    const pixels = sg.getImageData(0, 0, 256, 256);
    const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
      if (!isMapWaterRgb(data[i], data[i + 1], data[i + 2])) continue;
      // Retain some source variation while establishing an unmistakable sea hue.
      const shade = Math.max(-12, Math.min(12, data[i + 2] - 205));
      data[i] = 55 + shade;
      data[i + 1] = 145 + shade;
      data[i + 2] = 195 + shade;
    }
    sg.putImageData(pixels, 0, 0);
    ctx.drawImage(sample, dx, dy, size, size);
  } catch {
    // Cross-origin or canvas failures must never block terrain rendering.
    ctx.drawImage(image, dx, dy, size, size);
  }
}
