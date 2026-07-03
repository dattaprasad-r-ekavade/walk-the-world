// Shared palettes: building tint by OSM type, road color+width by class.
export const BUILDING_COLORS = {
  apartments: 0xe8d8c3, house: 0xe3d3b8, residential: 0xe8d8c3,
  office: 0xb8c9dd, commercial: 0xc9bede, industrial: 0xcfc8b8,
  retail: 0xdec3c3, church: 0xd8cbb3, cathedral: 0xd8cbb3,
};

export const ROAD_STYLE = {
  // realistic asphalt greys — distinct from terrain without looking like tar
  motorway: [0x4a4f57, 18], trunk: [0x4a4f57, 16], primary: [0x545a63, 13],
  secondary: [0x5d636c, 11], tertiary: [0x646a73, 9], residential: [0x6d737c, 7],
  unclassified: [0x6d737c, 6], service: [0x7a8088, 4], living_street: [0x7a8088, 6],
  pedestrian: [0x9a9484, 5], footway: [0xa89a72, 2.5], path: [0xa89a72, 2],
  cycleway: [0x5f7d9c, 2.5], track: [0x8a7a58, 3],
};
