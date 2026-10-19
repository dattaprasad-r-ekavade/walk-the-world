export async function readBoundedJson(request, maxBytes) {
  const tooLarge = () => Object.assign(new Error('Payload too large'), { status: 413 });
  if (Number(request.headers.get('content-length')) > maxBytes) throw tooLarge();
  if (!request.body) throw Object.assign(new Error('JSON body required'), { status: 400 });
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
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}
