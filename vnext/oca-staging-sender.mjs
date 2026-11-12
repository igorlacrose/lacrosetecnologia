import { createHmac } from 'node:crypto';
import { normalizeOcaEvent, ocaBodyLimit } from './oca-envelope.mjs';

const endpoint = 'http://127.0.0.1:4176/integrations/oca';

export function createOcaStagingSender({ secret, request = fetch, now = Date.now }) {
  if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/i.test(secret)) {
    throw new Error('Configure a dedicated staging OCA signing key');
  }
  const signingKey = Buffer.from(secret, 'hex');

  return async function deliver(event) {
    const envelope = normalizeOcaEvent(event);
    if (!envelope) return 'invalid';
    const body = Buffer.from(JSON.stringify(envelope));
    if (body.byteLength > ocaBodyLimit) return 'invalid';
    const timestamp = String(Math.floor(now() / 1000));
    const signature = createHmac('sha256', signingKey).update(timestamp + '.').update(body).digest('hex');
    try {
      const response = await request(endpoint, {
        method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { 'content-type': 'application/json', 'x-oca-timestamp': timestamp, 'x-oca-signature': signature },
      });
      await response.body?.cancel();
      if (response.status === 201) return 'accepted';
      if (response.status === 200) return 'duplicate';
      if (response.status === 409) return 'conflict';
      if (response.status < 500 && ![408, 429].includes(response.status)) return 'rejected';
    } catch {
      // The receiver may have committed before the connection failed.
    }
    return 'retry_same_event';
  };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  try {
    const send = createOcaStagingSender({ secret: process.env.VNEXT_OCA_HMAC_KEY });
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.byteLength;
      if (bytes > ocaBodyLimit) throw new Error('OCA envelope exceeds limit');
      chunks.push(chunk);
    }
    const event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    const result = await send(event);
    console.log('OCA staging delivery:', result);
    if (!['accepted', 'duplicate'].includes(result)) process.exitCode = result === 'retry_same_event' ? 2 : 1;
  } catch {
    console.error('Invalid staging OCA configuration or input.');
    process.exitCode = 1;
  }
}
