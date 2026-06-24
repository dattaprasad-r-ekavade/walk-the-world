// Cesium Workers/Assets/Widgets load from this base URL at runtime.
// Default: unpkg CDN (keeps deploy artifacts small). Set
// NEXT_PUBLIC_CESIUM_BASE_URL=/cesium to bundle local assets instead.
export function getCesiumBaseUrl() {
  const custom = process.env.NEXT_PUBLIC_CESIUM_BASE_URL?.trim();
  if (custom) return custom.replace(/\/$/, "");

  const version =
    process.env.NEXT_PUBLIC_CESIUM_PKG_VERSION?.trim() || "1.142.0";
  return `https://unpkg.com/cesium@${version}/Build/Cesium`;
}
