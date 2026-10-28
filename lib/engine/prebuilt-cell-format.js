const MAGIC = "WTWC";
const PREFIX_BYTES = 12;
const FORMAT_VERSION = 1;
const MAX_HEADER_BYTES = 16 * 1024 * 1024;
const MAX_CELL_BYTES = 128 * 1024 * 1024;
const QUANTIZED_ATTRIBUTES = new Set(["position", "normal", "color", "uv"]);

export const PREBUILT_CELL_FORMAT_VERSION = FORMAT_VERSION;

const ARRAY_TYPES = Object.freeze({
  Float32Array,
  Float64Array,
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
});

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError("Prebuilt cell input must be a Uint8Array or ArrayBuffer");
}

function quantizeAttribute(array, itemSize) {
  const count = array.length / itemSize;
  const stride = Math.ceil((itemSize * 2) / 4) * 4;
  const min = Array(itemSize).fill(Infinity);
  const max = Array(itemSize).fill(-Infinity);
  for (let vertex = 0; vertex < count; vertex++) {
    for (let axis = 0; axis < itemSize; axis++) {
      const value = array[vertex * itemSize + axis];
      if (!Number.isFinite(value)) throw new Error("Prebuilt geometry contains a non-finite attribute value");
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }

  const bytes = new Uint8Array(count * stride);
  const view = new DataView(bytes.buffer);
  for (let vertex = 0; vertex < count; vertex++) {
    for (let axis = 0; axis < itemSize; axis++) {
      const span = max[axis] - min[axis];
      const value = span > 0
        ? Math.round(((array[vertex * itemSize + axis] - min[axis]) / span) * 65535)
        : 0;
      view.setUint16(vertex * stride + axis * 2, value, true);
    }
  }
  return { bytes, count, stride, min, max };
}

function encodeTypedArray(array, path, parent, encoder) {
  const type = array.constructor?.name;
  if (!Object.hasOwn(ARRAY_TYPES, type)) throw new TypeError(`Unsupported prebuilt array type: ${type}`);

  const key = path.at(-1);
  const attributeName = key === "array" ? path.at(-2) : null;
  const itemSize = key === "array" && Number.isInteger(parent?.itemSize) ? parent.itemSize : null;
  const shouldQuantize = array instanceof Float32Array && itemSize > 0 &&
    itemSize <= 4 && QUANTIZED_ATTRIBUTES.has(attributeName) && array.length % itemSize === 0;

  let storage;
  let count;
  let size;
  let mode;
  let quantization = null;
  if (shouldQuantize) {
    quantization = quantizeAttribute(array, itemSize);
    storage = quantization.bytes;
    count = quantization.count;
    size = quantization.stride;
    mode = "ATTRIBUTES";
  } else {
    const source = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const isIndex = key === "index" && (array instanceof Uint16Array || array instanceof Uint32Array);
    if (isIndex) {
      storage = source.slice();
      count = array.length;
      size = array.BYTES_PER_ELEMENT;
      mode = count % 3 === 0 ? "TRIANGLES" : "INDICES";
    } else {
      const stride = key === "array" && itemSize > 0 && array.length % itemSize === 0
        ? itemSize * array.BYTES_PER_ELEMENT
        : array.BYTES_PER_ELEMENT;
      if (stride % 4 === 0 && array.byteLength % stride === 0) {
        storage = source.slice();
        count = array.byteLength / stride;
        size = stride;
      } else {
        size = 4;
        count = Math.ceil(array.byteLength / size);
        storage = new Uint8Array(count * size);
        storage.set(source);
      }
      mode = "ATTRIBUTES";
    }
  }

  const meshopt = encoder.encodeGltfBuffer(storage, count, size, mode, 0);
  const encoded = meshopt.byteLength < storage.byteLength ? meshopt : storage;
  return {
    bytes: encoded,
    descriptor: {
      codec: encoded === meshopt ? "meshopt" : "raw",
      mode,
      type,
      count,
      size,
      storedBytes: encoded.byteLength,
      sourceBytes: array.byteLength,
      quantization: quantization && {
        itemSize,
        stride: quantization.stride,
        min: quantization.min,
        max: quantization.max,
        normalized: parent.normalized === true,
      },
    },
  };
}

function packTree(value, path, parent, encoder, buffers) {
  if (ArrayBuffer.isView(value)) {
    const packed = encodeTypedArray(value, path, parent, encoder);
    const id = buffers.length;
    buffers.push(packed);
    return { $wtwBuffer: id };
  }
  if (Array.isArray(value)) return value.map((item, index) => packTree(item, [...path, index], value, encoder, buffers));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = packTree(item, [...path, key], value, encoder, buffers);
    }
    return out;
  }
  return value;
}

export async function encodePrebuiltCellWithCodec({ metadata, result }, encoder) {
  if (!result || typeof result !== "object") throw new TypeError("Prebuilt cell result is required");
  await encoder.ready;
  const buffers = [];
  const root = packTree(result, ["result"], null, encoder, buffers);
  let payloadBytes = 0;
  for (const buffer of buffers) {
    buffer.descriptor.offset = payloadBytes;
    payloadBytes += buffer.bytes.byteLength;
  }
  const manifest = {
    format: "walk-the-world-prebuilt-cell",
    version: FORMAT_VERSION,
    metadata: metadata || {},
    root,
    buffers: buffers.map((buffer) => buffer.descriptor),
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (headerBytes.byteLength > MAX_HEADER_BYTES) throw new RangeError("Prebuilt cell manifest is too large");
  const totalBytes = PREFIX_BYTES + headerBytes.byteLength + payloadBytes;
  if (totalBytes > MAX_CELL_BYTES) throw new RangeError("Prebuilt cell exceeds the maximum supported size");

  const output = new Uint8Array(totalBytes);
  output.set(new TextEncoder().encode(MAGIC), 0);
  const view = new DataView(output.buffer);
  view.setUint16(4, FORMAT_VERSION, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, headerBytes.byteLength, true);
  output.set(headerBytes, PREFIX_BYTES);
  let offset = PREFIX_BYTES + headerBytes.byteLength;
  for (const buffer of buffers) {
    output.set(buffer.bytes, offset);
    offset += buffer.bytes.byteLength;
  }
  return output;
}

function decodeTypedArray(descriptor, payload, decoder) {
  const { codec, mode, type, count, size, offset, storedBytes, sourceBytes, quantization } = descriptor;
  const Type = ARRAY_TYPES[type];
  if (!Type || !Number.isInteger(count) || count < 0 || !Number.isInteger(size) || size <= 0 ||
      !Number.isInteger(offset) || offset < 0 || !Number.isInteger(storedBytes) || storedBytes < 0 ||
      offset + storedBytes > payload.byteLength) {
    throw new Error("Invalid prebuilt cell buffer descriptor");
  }
  const stored = payload.subarray(offset, offset + storedBytes);
  let decoded;
  if (codec === "meshopt") {
    if (!["ATTRIBUTES", "TRIANGLES", "INDICES"].includes(mode)) throw new Error("Invalid meshopt buffer mode");
    decoded = new Uint8Array(count * size);
    decoder.decodeGltfBuffer(decoded, count, size, stored, mode);
  } else if (codec === "raw") {
    decoded = stored.slice();
  } else {
    throw new Error(`Unsupported prebuilt buffer codec: ${codec}`);
  }

  if (quantization) {
    if (!Number.isInteger(quantization.itemSize) || quantization.itemSize < 1 ||
        !Number.isInteger(quantization.stride) || quantization.stride < quantization.itemSize * 2 ||
        !Array.isArray(quantization.min) || !Array.isArray(quantization.max) ||
        quantization.min.length !== quantization.itemSize || quantization.max.length !== quantization.itemSize ||
        decoded.byteLength !== count * quantization.stride) {
      throw new Error("Invalid prebuilt quantization descriptor");
    }
    const floats = new Float32Array(count * quantization.itemSize);
    const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
    for (let vertex = 0; vertex < count; vertex++) {
      let lengthSq = 0;
      for (let axis = 0; axis < quantization.itemSize; axis++) {
        const min = quantization.min[axis], max = quantization.max[axis];
        if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new Error("Invalid prebuilt quantization range");
        const q = view.getUint16(vertex * quantization.stride + axis * 2, true) / 65535;
        const value = max > min ? min + q * (max - min) : min;
        floats[vertex * quantization.itemSize + axis] = value;
        lengthSq += value * value;
      }
      if (descriptor.attributeName === "normal" && lengthSq > 0) {
        const invLength = 1 / Math.sqrt(lengthSq);
        for (let axis = 0; axis < quantization.itemSize; axis++) floats[vertex * quantization.itemSize + axis] *= invLength;
      }
    }
    return floats;
  }

  if (!Number.isInteger(sourceBytes) || sourceBytes < 0 || sourceBytes > decoded.byteLength) {
    throw new Error("Invalid prebuilt source byte length");
  }
  const aligned = decoded.slice(0, sourceBytes);
  if (aligned.byteLength % Type.BYTES_PER_ELEMENT !== 0) throw new Error("Misaligned prebuilt typed array");
  return new Type(aligned.buffer, aligned.byteOffset, aligned.byteLength / Type.BYTES_PER_ELEMENT);
}

function unpackTree(value, path, manifest, payload, decoder) {
  if (value && typeof value === "object" && Number.isInteger(value.$wtwBuffer)) {
    const descriptor = manifest.buffers[value.$wtwBuffer];
    if (!descriptor) throw new Error("Prebuilt cell references a missing buffer");
    if (path.at(-1) === "array") descriptor.attributeName = path.at(-2);
    return decodeTypedArray(descriptor, payload, decoder);
  }
  if (Array.isArray(value)) return value.map((item, index) => unpackTree(item, [...path, index], manifest, payload, decoder));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = unpackTree(item, [...path, key], manifest, payload, decoder);
    return out;
  }
  return value;
}

export async function decodePrebuiltCellWithCodec(input, decoder) {
  const bytes = asBytes(input);
  if (bytes.byteLength < PREFIX_BYTES || bytes.byteLength > MAX_CELL_BYTES) throw new RangeError("Invalid prebuilt cell size");
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) throw new Error("Invalid prebuilt cell signature");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  if (version !== FORMAT_VERSION) throw new Error(`Unsupported prebuilt cell version: ${version}`);
  if (view.getUint16(6, true) !== 0) throw new Error("Unsupported prebuilt cell flags");
  const headerLength = view.getUint32(8, true);
  if (!headerLength || headerLength > MAX_HEADER_BYTES || PREFIX_BYTES + headerLength > bytes.byteLength) {
    throw new Error("Invalid prebuilt cell manifest length");
  }
  const manifestBytes = bytes.subarray(PREFIX_BYTES, PREFIX_BYTES + headerLength);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  if (manifest?.format !== "walk-the-world-prebuilt-cell" || manifest.version !== FORMAT_VERSION ||
      !Array.isArray(manifest.buffers) || !manifest.root) {
    throw new Error("Invalid prebuilt cell manifest");
  }
  await decoder.ready;
  const payload = bytes.subarray(PREFIX_BYTES + headerLength);
  const result = unpackTree(manifest.root, ["result"], manifest, payload, decoder);
  return { metadata: manifest.metadata || {}, result };
}
