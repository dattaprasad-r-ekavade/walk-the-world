// Resolves the Cesium ion token from a single env var or two split parts
// (for hosts that cap secret length at 255 chars).
export function getCesiumIonToken() {
  const full = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN?.trim();
  if (full) return full;

  const part1 = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN_1?.trim() ?? "";
  const part2 = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN_2?.trim() ?? "";
  const combined = part1 + part2;
  return combined || undefined;
}
