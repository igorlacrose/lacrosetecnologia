import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest();
const paymentIdPattern = /^pay_[A-Za-z0-9_-]{1,120}$/;
const maxBodyBytes = 64 * 1024;

async function readEvent(request) {
  if (!request.body) throw new SyntaxError('Missing body');
  const reader = request.body.getReader();
  const buffer = new Uint8Array(maxBodyBytes);
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > maxBodyBytes) {
        await reader.cancel();
        throw new RangeError('Webhook body limit');
      }
      buffer.set(value, length);
      length += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
}

export function createAsaasSandboxWebhook({ token, db }) {
  if (typeof token !== 'string' || !/^\S{32,255}$/.test(token)) {
    throw new Error('Configure a dedicated Sandbox webhook token');
  }
  const expected = digest(token);
  return async function acceptWebhook(request) {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const presented = request.headers.get('asaas-access-token');
    if (!presented || presented.length > 255 || !timingSafeEqual(digest(presented), expected)) {
      return new Response(null, { status: 401 });
    }
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return new Response(null, { status: 415 });
    }

    let payload;
    try {
      payload = await readEvent(request);
    } catch (error) {
      return new Response(null, { status: error instanceof RangeError ? 413 : 400 });
    }
    const { id, event, payment } = payload ?? {};
    if (typeof id !== 'string' || !/^evt_[A-Za-z0-9_&-]{1,150}$/.test(id)
      || typeof event !== 'string' || !/^PAYMENT_[A-Z_]{1,70}$/.test(event)
      || typeof payment?.id !== 'string' || !paymentIdPattern.test(payment.id)) {
      return new Response(null, { status: 400 });
    }
    try {
      // The connection must use autocommit and the ingest role. Store no customer payload.
      await db.query(
        'insert into lkz_vnext_billing.asaas_sandbox_events (event_id, event_type, payment_id) '
        + 'values ($1, $2, $3) on conflict do nothing',
        [id, event, payment.id],
      );
      return new Response(null, { status: 200 });
    } catch {
      return new Response(null, { status: 503 });
    }
  };
}

export async function fetchAsaasSandboxPayment(paymentId, apiKey, request = fetch) {
  if (typeof paymentId !== 'string' || !paymentIdPattern.test(paymentId)) {
    throw new Error('Invalid Asaas payment reference');
  }
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('Missing Sandbox credentials');
  const response = await request('https://api-sandbox.asaas.com/v3/payments/' + paymentId, {
    headers: { access_token: apiKey, accept: 'application/json', 'user-agent': 'LKZ-ADM-VNext' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Sandbox payment lookup failed');
  const payment = await response.json();
  if (payment?.id !== paymentId) throw new Error('Unexpected Sandbox payment reference');
  return payment;
}
