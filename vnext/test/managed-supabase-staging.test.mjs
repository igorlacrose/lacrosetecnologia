import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrateStaging, openStagingDatabase } from '../staging-db.mjs';

const stagingHost = 'db.nijsafzwxzcfqdevlsxe.supabase.co';
const productionHost = 'db.icrtewhazpfauuroswri.supabase.co';
const sample = (host, db = 'postgres', port = 5432) =>
  'postgresql://lkz_vnext_runtime:synthetic-only@' + host + ':' + port + '/' + db;

test('only the pinned managed Supabase staging project may use /postgres', async () => {
  const db = openStagingDatabase(sample(stagingHost));
  try {
    await assert.rejects(migrateStaging(db), /never rerun standalone migrations/);
  } finally {
    await db.close();
  }
});

test('production and other Supabase projects may not use /postgres', () => {
  for (const url of [
    sample(productionHost),
    sample('db.otherproject.supabase.co'),
    sample('db.nijsafzwxzcfqdevlsxe.supabase.co.evil.test'),
    sample(stagingHost, 'postgres', 6543),
    sample('127.0.0.1'),
    'postgresql://lkz_vnext_runtime:synthetic-only@aws-0-sa-east-1.pooler.supabase.com:5432/postgres',
    sample(stagingHost) + '?sslmode=disable',
  ]) {
    assert.throws(() => openStagingDatabase(url),
      /Expected a dedicated LKZ VNext staging database URL/);
  }
});

test('standalone staging databases remain supported, including disposable PG17 CI', async () => {
  for (const dbName of ['lkz_vnext_stage','lkz_vnext_stage_ci']) {
    const db = openStagingDatabase(sample('127.0.0.1',dbName));
    try {
      assert.equal(typeof db.transaction,'function');
      assert.equal(typeof db.close,'function');
    } finally {
      await db.close();
    }
  }
});
