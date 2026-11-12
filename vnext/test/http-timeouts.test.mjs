import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreviewDatabase } from '../preview-db.mjs';
import { createPreviewServer } from '../preview.mjs';

test('VNext bounds request and header time for all HTTP entrypoints', async t => {
  const fixtureDb = await createPreviewDatabase();
  t.after(() => fixtureDb.close());
  const variants = [
    ['local preview', fixtureDb, { allowSyntheticIdentity: true }],
    ['authenticated workspace', undefined, {
      auth: { verify: async () => null, handle: async () => Response.json({}, { status: 401 }) },
    }],
    ['dedicated Asaas webhook', undefined, {
      webhookOnly: true,
      asaasWebhook: async () => new Response(null, { status: 401 }),
    }],
  ];
  for (const [name, db, options] of variants) {
    const server = createPreviewServer(db, options);
    assert.equal(server.requestTimeout, 15_000, name + ' requestTimeout');
    assert.equal(server.headersTimeout, 10_000, name + ' headersTimeout');
    assert.ok(server.headersTimeout <= server.requestTimeout, name + ' safe limits');
  }
});
