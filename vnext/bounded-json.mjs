// Strict byte cap for HTTP JSON from providers and internal authentication
// handlers. Content-Length is advisory; the streaming cap is authoritative.
export async function readBoundedJson(message, maxBytes, source = 'Provider') {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('Invalid JSON byte limit');
  }
  const announced = message?.headers?.get('content-length');
  if (announced != null && /^\d+$/.test(announced)
    && BigInt(announced) > BigInt(maxBytes)) {
    try { await message.body?.cancel(); } catch { /* Stream may be closed. */ }
    throw new RangeError(source + ' JSON exceeds byte limit');
  }
  if (!message?.body || typeof message.body.getReader !== 'function') {
    throw new TypeError(source + ' JSON body is missing');
  }
  const reader = message.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new TypeError(source + ' JSON chunk is invalid');
      }
      if (value.byteLength > maxBytes - size) {
        try { await reader.cancel(); } catch { /* Stream may be closed. */ }
        throw new RangeError(source + ' JSON exceeds byte limit');
      }
      size += value.byteLength;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true })
    .decode(Buffer.concat(chunks, size)));
}
