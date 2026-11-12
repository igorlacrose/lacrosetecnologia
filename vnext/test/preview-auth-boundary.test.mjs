import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreviewDatabase, isSyntheticPreviewDatabase } from '../preview-db.mjs';
import { createPreviewServer } from '../preview.mjs';

const auth = {
  verify: async () => null,
  handle: async () => Response.json({ error: 'denied' }, { status: 401 }),
};

test('missing Auth never grants a synthetic admin to a non-preview database', () => {
  const persistentDatabase = { transaction: async () => {
    throw new Error('Should not query a database while validating server identity mode');
  } };
  assert.equal(isSyntheticPreviewDatabase(persistentDatabase), false);
  assert.throws(
    () => createPreviewServer(persistentDatabase),
    /verified authentication provider/
  );
  assert.throws(
    () => createPreviewServer(persistentDatabase, { allowSyntheticIdentity: true }),
    /only with a local preview fixture/
  );
  assert.doesNotThrow(() => createPreviewServer(persistentDatabase, { auth }));
});

test('PGlite identity must be opted into explicitly, and cannot mix with real Auth', async t => {
  const db = await createPreviewDatabase();
  t.after(() => db.close());
  assert.equal(isSyntheticPreviewDatabase(db), true);
  assert.throws(() => createPreviewServer(db), /verified authentication provider/);
  assert.throws(
    () => createPreviewServer(db, { auth, allowSyntheticIdentity: true }),
    /only with a local preview fixture/
  );
  assert.doesNotThrow(() => createPreviewServer(db, { allowSyntheticIdentity: true }));
});

test('isolated provider webhook does not require workspace Auth', () => {
  assert.doesNotThrow(() => createPreviewServer(undefined, {
    webhookOnly: true,
    asaasWebhook: async () => new Response(null, { status: 401 }),
  }));
});
