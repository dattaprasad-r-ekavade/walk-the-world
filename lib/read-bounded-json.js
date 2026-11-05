// @ts-check
// Bounded request-body readers for write endpoints. Both honour a declared
// Content-Length up front and stop streaming as soon as the limit is crossed,
// so an oversized upload never gets buffered in full.
const httpError = (message, status) => Object.assign(new Error(message), { status });

export async function readBoundedBytes(request, maxBytes) {
  const tooLarge = () => httpError('Payload too large', 413);
  if (Number(request.headers.get('content-length')) > maxBytes) throw tooLarge();
  if (!request.body) throw httpError('Request body required', 400);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function readBoundedJson(request, maxBytes) {
  const bytes = await readBoundedBytes(request, maxBytes);
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw httpError('Invalid JSON', 400); }
}
