import { MeshoptDecoder } from "meshoptimizer/decoder";
import { decodePrebuiltCellWithCodec } from "./prebuilt-cell-format.js";

async function inflateIfGzip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  if (typeof DecompressionStream !== "function" || typeof Blob !== "function" || typeof Response !== "function") {
    throw new Error("This browser cannot decompress prebuilt cell data");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodePrebuiltCell(input) {
  const bytes = await inflateIfGzip(input);
  return decodePrebuiltCellWithCodec(bytes, MeshoptDecoder);
}
