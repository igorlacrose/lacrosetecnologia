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

export async function reconcileNextAsaasSandboxEvent({ db, apiKey, request }) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('Missing Sandbox credentials');
  // Mark exhausted claims left behind by interrupted workers.
  await db.query(`
    update lkz_vnext_billing.asaas_sandbox_events
    set failed_at = now(), lease_token = null, lease_until = null
    where processed_at is null and failed_at is null and attempts >= 5 and lease_until <= now()
  `);

  const { rows: [event] } = await db.query(`
    with candidate as (
      select event_id from lkz_vnext_billing.asaas_sandbox_events
      where processed_at is null and failed_at is null and attempts < 5
        and next_attempt_at <= now() and (lease_until is null or lease_until <= now())
      order by next_attempt_at, event_id
      limit 1 for update skip locked
    )
    update lkz_vnext_billing.asaas_sandbox_events inbox
    set attempts = attempts + 1, lease_token = gen_random_uuid(),
        lease_until = now() + interval '60 seconds'
    from candidate where inbox.event_id = candidate.event_id
    returning inbox.event_id, inbox.payment_id, inbox.lease_token
  `);
  if (!event) return 'idle';

  let status = null;
  try {
    const payment = await fetchAsaasSandboxPayment(event.payment_id, apiKey, request);
    if (typeof payment.status === 'string' && /^[A-Z_]{1,40}$/.test(payment.status)) {
      status = payment.status;
    }
  } catch {
    // Persist a retry without retaining provider responses or credentials.
  }

  const { rows: [result] } = await db.query(`
    update lkz_vnext_billing.asaas_sandbox_events
    set observed_status = $3::text,
        processed_at = case when $3::text is not null then now() end,
        failed_at = case when $3::text is null and attempts >= 5 then now() end,
        next_attempt_at = now() + interval '30 seconds' * power(2, attempts - 1),
        lease_token = null, lease_until = null
    where event_id = $1 and lease_token = $2 and lease_until > now()
    returning processed_at, failed_at
  `, [event.event_id, event.lease_token, status]);

  if (!result) return 'lease_lost';
  if (result.processed_at) return 'observed';
  return result.failed_at ? 'failed' : 'retry';
}
