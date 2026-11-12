import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { fixture, withIdentity } from '../preview-db.mjs';
import { assertIntegrationRole, assertWorkspaceRole, migrateStaging, openStagingDatabase } from '../staging-db.mjs';

const bootstrapUrl = process.env.VNEXT_NATIVE_TEST_ADMIN_URL;

test('native PostgreSQL enforces tenant and billing permissions over TCP', { skip: !bootstrapUrl }, async t => {
  const bootstrap = new URL(bootstrapUrl);
  assert.equal(bootstrap.hostname, '127.0.0.1');
  assert.equal(bootstrap.pathname, '/postgres');
  assert.equal(bootstrap.username, 'lkz_native_test_bootstrap');
  const database = 'lkz_vnext_stage_ci';
  const admin = new pg.Client({ connectionString: bootstrap.href });
  const pools = [];
  t.after(async () => {
    await Promise.all(pools.map(db => db.close()));
    await admin.end();
  });
  await admin.connect();

  const migrator = 'lkz_vnext_migrator';
  const runtime = 'lkz_vnext_runtime';
  const billing = [
    ['lkz_ci_ingest', 'lkz_vnext_asaas_ingest'],
    ['lkz_ci_issue', 'lkz_vnext_asaas_issue'],
    ['lkz_ci_reconcile', 'lkz_vnext_asaas_reconcile'],
  ];
  const logins = [migrator, runtime, ...billing.map(([login]) => login)];
  const passwords = new Map(logins.map(login => [login, randomBytes(32).toString('hex')]));
  for (const [login, password] of passwords) {
    const flags = login === migrator ? 'createrole noinherit' : login === runtime ? 'noinherit' : 'inherit';
    await admin.query(`create role ${login} login ${flags} password '${password}'`);
  }
  await admin.query('create role anon nologin; create role authenticated nologin');
  await admin.query(`create database ${database} owner ${migrator}`);
  await admin.query(`revoke all on database ${database} from public; grant connect on database ${database} to ${logins.join(',')}`);

  function connect(login) {
    const url = new URL(bootstrap);
    url.pathname = '/' + database;
    if (login) {
      url.username = login;
      url.password = passwords.get(login);
    }
    const db = openStagingDatabase(url.href);
    pools.push(db);
    return db;
  }

  const owner = connect(migrator);
  await owner.transaction(tx => tx.exec(`
    create schema auth;
    revoke all on schema auth from public;
    grant usage on schema auth to authenticated;
    create table auth.users (id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select (auth.jwt()->>'sub')::uuid $$;
  `));
  await migrateStaging(owner);
  await migrateStaging(owner);
  const setup = connect();
  await setup.transaction(async tx => {
    await tx.exec('grant authenticated to lkz_vnext_runtime with inherit false, set true');
    for (const [login, role] of billing) await tx.exec(`grant ${role} to ${login}`);
  });
  await owner.transaction(async tx => {
    await tx.query("insert into lkz_vnext.tenants values ($1,'Tenant A'), ($2,'Tenant B')", [fixture.tenant, fixture.secondTenant]);
    await tx.query('insert into auth.users values ($1)', [fixture.admin]);
    await tx.query("insert into lkz_vnext.memberships values ($1,$2,'admin',true)", [fixture.tenant, fixture.admin]);
  });

  const workspace = connect(runtime);
  await assertWorkspaceRole(workspace);
  const visible = aal => withIdentity(workspace, { sub: fixture.admin, aal }, async tx =>
    (await tx.query('select id from lkz_vnext.tenants order by id')).rows.map(row => row.id));
  assert.deepEqual(await visible('aal1'), []);
  assert.deepEqual(await visible('aal2'), [fixture.tenant]);
  await owner.transaction(tx => tx.query('update lkz_vnext.memberships set active=false where user_id=$1', [fixture.admin]));
  assert.deepEqual(await visible('aal2'), []);
  await owner.transaction(tx => tx.exec('alter table lkz_vnext.tenants disable row level security'));
  try {
    await assert.rejects(assertWorkspaceRole(workspace), /active row-level security/);
  } finally {
    await owner.transaction(tx => tx.exec('alter table lkz_vnext.tenants enable row level security'));
  }

  const [ingest, , reconcile] = await Promise.all(billing.map(async ([login, role]) => {
    const db = connect(login);
    await assertIntegrationRole(db, role);
    return db;
  }));
  await assert.rejects(ingest.transaction(tx => tx.exec('select event_id from lkz_vnext_billing.asaas_sandbox_events')),
    { code: '42501' });
  const event = "insert into lkz_vnext_billing.asaas_sandbox_events (event_id,event_type,payment_id) "
    + "values ('evt_native_ci','PAYMENT_RECEIVED','pay_native_ci') on conflict do nothing";
  await Promise.all([ingest.transaction(tx => tx.exec(event)), ingest.transaction(tx => tx.exec(event))]);
  const observed = await reconcile.transaction(tx => tx.exec('select event_id from lkz_vnext_billing.asaas_sandbox_events'));
  assert.deepEqual(observed.rows, [{ event_id: 'evt_native_ci' }]);
});
