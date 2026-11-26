import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAsaasJson } from '../asaas-response.mjs';
import { fetchAsaasSandboxPayment } from '../asaas-sandbox.mjs';
import { createAsaasSandboxIssuer } from '../asaas-issuance.mjs';

const cap = 256 * 1024;
const payment = {
  id: 'pay_ci_limited', customer: 'cus_ci_limited',
  value: 10, status: 'RECEIVED',
};

test('Asaas JSON reader accepts normal provider responses', async () => {
  assert.deepEqual(await readAsaasJson(Response.json(payment)), payment);
  const result = await fetchAsaasSandboxPayment(payment.id,'synthetic-only',
    async () => Response.json(payment));
  assert.deepEqual(result,payment);
});

test('Asaas JSON reader rejects declared oversized responses before reading', async () => {
  const body = Response.json(payment);
  body.headers.set('content-length',String(cap + 1));
  await assert.rejects(readAsaasJson(body),err => err instanceof RangeError);
});

test('Asaas JSON reader cancels streaming responses exceeding 256 KiB', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(cap));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readAsaasJson(new Response(stream)),err => err instanceof RangeError);
  assert.equal(cancelled,true);
});

test('Asaas JSON reader fails closed on interrupted or malformed responses', async () => {
  const broken = new ReadableStream({
    start(controller) { controller.error(new Error('Simulated truncated provider response')); },
  });
  await assert.rejects(readAsaasJson(new Response(broken)));
  await assert.rejects(readAsaasJson(new Response('{invalid')));
  await assert.rejects(readAsaasJson(new Response(null)));
});

test('Asaas issuer refuses an oversized response without accepting its record', async () => {
  const issuer = createAsaasSandboxIssuer({
    apiKey: 'synthetic-only',
    request: async () => Response.json({ hasMore: false, data: [], extra: 'x'.repeat(cap) }),
  });
  await assert.rejects(issuer.lookup({
    kind:'payments',
    external_reference:'00000000-0000-4000-8000-000000000999',
  }),err => err instanceof RangeError);
});

test('Asaas payment read cannot ingest huge provider JSON', async () => {
  await assert.rejects(
    fetchAsaasSandboxPayment(payment.id,'synthetic-only',
      async () => Response.json({ ...payment, extra: 'x'.repeat(cap) })),
    err => err instanceof RangeError
  );
});
