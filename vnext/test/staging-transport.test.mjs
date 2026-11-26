import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { amountInCents, createAsaasSandboxIssuer } from '../asaas-issuance.mjs';
import { createOcaStagingSender } from '../oca-staging-sender.mjs';

test('the OCA sender signs only consented normalized data and preserves the event ID on retries', async () => {
  const secret = randomBytes(32);
  const event = { eventId: randomUUID(), conversationId: randomUUID(), consent: true,
    name: ' Fixture ', email: 'FIXTURE@example.test', note: 'Resumo fictício', tenant: randomUUID() };
  const requests = [];
  const send = createOcaStagingSender({ secret: secret.toString('hex'), request: async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) throw new Error('simulated transport failure');
    return new Response(null, { status: 200 });
  } });
  assert.equal(await send({ ...event, consent: false }), 'invalid');
  assert.equal(requests.length, 0);
  assert.equal(await send(event), 'retry_same_event');
  assert.equal(await send(event), 'duplicate');
  for (const { url, options } of requests) {
    assert.equal(url, 'http://127.0.0.1:4176/integrations/oca');
    assert.equal(options.redirect, 'error');
    const { 'x-oca-timestamp': timestamp, 'x-oca-signature': signature } = options.headers;
    assert.equal(signature, createHmac('sha256', secret).update(timestamp + '.').update(options.body).digest('hex'));
    const { tenant, ...expected } = event;
    assert.deepEqual(JSON.parse(options.body), { ...expected, name: 'Fixture', email: 'fixture@example.test' });
  }
});

test('the Asaas issuer uses the fixed Sandbox origin and only recovers one unambiguous match', async () => {
  const id = randomUUID();
  const op = { kind: 'customers', external_reference: id };
  let payload;
  const gateway = createAsaasSandboxIssuer({ apiKey: randomUUID(), request: async (url, options) => {
    const target = new URL(url);
    assert.equal(target.origin, 'https://api-sandbox.asaas.com');
    assert.equal(target.pathname, '/v3/customers');
    assert.equal(options.redirect, 'error');
    if (options.method === 'GET') assert.equal(target.searchParams.get('externalReference'), id);
    else assert.equal(JSON.parse(options.body).externalReference, id);
    return Response.json(payload);
  } });
  payload = { id: 'cus_fixture', externalReference: id };
  assert.deepEqual(await gateway.create(op, { externalReference: id }), payload);
  payload = { hasMore: false, data: [payload] };
  assert.equal((await gateway.lookup(op)).id, 'cus_fixture');
  payload = { hasMore: true, data: payload.data };
  assert.equal(await gateway.lookup(op), null);
  assert.equal(amountInCents(25.03), 2503);
  assert.ok(Number.isNaN(amountInCents(25.031)));
});
