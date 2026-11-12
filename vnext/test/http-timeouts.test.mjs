import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreviewServer } from '../preview.mjs';

test('VNext bounds request and header time for all HTTP entrypoints', () => {
  const variants = [
    ['local preview', {}],
    ['authenticated workspace', { auth: { verify: async () => null } }],
    ['dedicated Asaas webhook', {
      webhookOnly: true,
      asaasWebhook: async () => new Response(null, { status: 401 }),
    }],
  ];
  for (const [name, options] of variants) {
    const server = createPreviewServer(undefined, options);
    assert.equal(server.requestTimeout, 15_000, name + ' requestTimeout');
    assert.equal(server.headersTimeout, 10_000, name + ' headersTimeout');
    assert.ok(server.headersTimeout <= server.requestTimeout, name + ' safe limits');
  }
});
