/**
 * Count the OSM way footprints handled by city-builder-core as buildings.
 * Building parts are rendered too, including ways reclassified from building.
 */
export function countRefreshBuildings(data) {
  return (data?.elements || []).filter((element) =>
    element.type === "way" && (element.tags?.building || element.tags?.["building:part"]),
  ).length;
}
