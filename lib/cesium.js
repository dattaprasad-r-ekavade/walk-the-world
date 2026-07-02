// Cesium (script, Workers, Assets, Widgets) loads entirely from CDN at
// runtime — nothing is bundled, so npm install and builds stay tiny.
// Override with NEXT_PUBLIC_CESIUM_BASE_URL to self-host if needed.
export const CESIUM_VERSION = "1.142.0";

export function getCesiumBaseUrl() {
  const custom = process.env.NEXT_PUBLIC_CESIUM_BASE_URL?.trim();
  if (custom) return custom.replace(/\/$/, "");
  return `https://unpkg.com/cesium@${CESIUM_VERSION}/Build/Cesium`;
}
