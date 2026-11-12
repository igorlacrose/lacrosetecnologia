const maxProviderJsonBytes = 256 * 1024;

// Responses from a trusted HTTPS origin still count as external input.
// Bound memory before JSON parsing; AbortSignal.timeout is the time limit.
export async function readAsaasJson(response) {
  const announced = response?.headers?.get('content-length');
  if (announced !== null && announced !== undefined && /^\d+$/.test(announced)
    && BigInt(announced) > BigInt(maxProviderJsonBytes)) {
    try { await response.body?.cancel(); } catch { /* Stream already closed. */ }
    throw new RangeError('Asaas response exceeds byte limit');
  }
  if (!response?.body || typeof response.body.getReader !== 'function') {
    throw new TypeError('Asaas response body is missing');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new TypeError('Invalid Asaas response chunk');
      if (value.byteLength > maxProviderJsonBytes - bytes) {
        try { await reader.cancel(); } catch { /* Stream already closed. */ }
        throw new RangeError('Asaas response exceeds byte limit');
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks, bytes);
  return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(body));
}
