import { gzipSync } from "node:zlib";
import { MeshoptEncoder } from "meshoptimizer/encoder";
import { encodePrebuiltCellWithCodec } from "./prebuilt-cell-format.js";

export async function encodePrebuiltCell(input) {
  const binary = await encodePrebuiltCellWithCodec(input, MeshoptEncoder);
  return new Uint8Array(gzipSync(binary, { level: 9 }));
}
