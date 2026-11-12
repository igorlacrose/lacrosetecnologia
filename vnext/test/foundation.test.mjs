import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createAsaasSandboxWebhook, fetchAsaasSandboxPayment, reconcileNextAsaasSandboxEvent } from '../asaas-sandbox.mjs';

const sql = (file) => readFile(new URL('../db/' + file, import.meta.url), 'utf8');

test('PostgreSQL denies unauthorized CRM access and converts without duplicates', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    grant usage on schema auth to authenticated;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select (auth.jwt()->>'sub')::uuid $$;
  `);
  await db.exec(await sql('001-foundation.sql'));
  await db.exec(await sql('003-draft-catalog.sql'));
  const [tenantA, tenantB, operator, viewer, admin, inactive] = Array.from({ length: 6 }, randomUUID);
  await db.query("insert into lkz_vnext.tenants values ($1, 'A'), ($2, 'B')", [tenantA, tenantB]);
  await db.query('insert into auth.users values ($1), ($2), ($3), ($4)', [operator, viewer, admin, inactive]);
  await db.query(`insert into lkz_vnext.memberships values
    ($1, $3, 'operator', true), ($2, $3, 'viewer', true), ($1, $4, 'viewer', true),
    ($1, $5, 'admin', true), ($1, $6, 'admin', false)`, [tenantA, tenantB, operator, viewer, admin, inactive]);

  async function login(sub, aal) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub, aal })]);
    await db.exec('set role authenticated');
  }
  const addProduct = (tenant) => db.query(
    "insert into lkz_vnext.products (tenant_id, slug, name, kind) values ($1, 'fixture', 'Fixture', 'saas') returning id",
    [tenant],
  );
  const addPlan = (tenant, product, amount) => db.query(
    "insert into lkz_vnext.plans (tenant_id, product_id, name, amount_brl_cents, interval) values ($1, $2, 'Fixture', $3, 'monthly')",
    [tenant, product, amount],
  );
  const list = () => db.query('select id from lkz_vnext.tenants');
  const insertLead = (tenant) => db.query(
    "insert into lkz_vnext.leads (tenant_id, name, email) values ($1, 'Fixture', 'test@example.test') returning id",
    [tenant],
  );
  const convert = (tenant, lead) => db.query('select lkz_vnext.convert_lead($1, $2) as client', [tenant, lead]);

  await db.exec('set role anon');
  await assert.rejects(list, { code: '42501' });
  await login(operator, 'aal1');
  assert.equal((await list()).rows.length, 0);
  await assert.rejects(insertLead(tenantA), { code: '42501' });
  await login(inactive, 'aal2');
  assert.equal((await list()).rows.length, 0);
  await login(viewer, 'aal2');
  await assert.rejects(insertLead(tenantA), { code: '42501' });

  await login(operator, 'aal2');
  await assert.rejects(insertLead(tenantB), { code: '42501' });
  await assert.rejects(addProduct(tenantA), { code: '42501' });
  const first = (await insertLead(tenantA)).rows[0].id;
  const second = (await insertLead(tenantA)).rows[0].id;
  await assert.rejects(convert(tenantB, first), { code: '42501' });
  await assert.rejects(db.query('update lkz_vnext.leads set tenant_id = $1', [tenantB]), { code: '42501' });
  const original = (await convert(tenantA, first)).rows[0].client;
  assert.equal((await convert(tenantA, first)).rows[0].client, original);
  assert.equal((await convert(tenantA, second)).rows[0].client, original);
  assert.equal((await db.query('select * from lkz_vnext.audit')).rows.length, 0);

  await login(admin, 'aal2');
  assert.deepEqual((await list()).rows, [{ id: tenantA }]);
  assert.equal((await db.query('select * from lkz_vnext.clients')).rows.length, 1);
  assert.equal((await db.query('select * from lkz_vnext.audit')).rows.length, 5);
  await assert.rejects(db.query('delete from lkz_vnext.audit'), { code: '42501' });
  const product = (await addProduct(tenantA)).rows[0].id;
  await assert.rejects(addPlan(tenantB, product, 100), { code: '42501' });
  await assert.rejects(addPlan(tenantA, randomUUID(), 100), { code: '23503' });
  await assert.rejects(addPlan(tenantA, product, 0), { code: '23514' });
  await addPlan(tenantA, product, 100);
  await db.query('update lkz_vnext.clients set archived_at = now() where id = $1', [original]);
  const third = (await insertLead(tenantA)).rows[0].id;
  await assert.rejects(convert(tenantA, third), { code: '23514' });
});

test('webhook authenticates, persists minimal data and deduplicates in PostgreSQL', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('create role anon; create role authenticated');
  await db.exec(await sql('002-asaas-inbox.sql'));
  await db.exec('set role lkz_vnext_asaas_ingest');
  const token = randomUUID();
  const handle = createAsaasSandboxWebhook({ token, db });
  const payload = { id: 'evt_fixture&123', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_fixture', customer: 'discard' } };
  const request = (body, presented = token) => new Request('https://localhost/webhook', {
    method: 'POST',
    headers: { 'asaas-access-token': presented, 'content-type': 'application/json' },
    body,
  });
  assert.equal((await handle(request(JSON.stringify(payload), 'wrong'))).status, 401);
  assert.equal((await handle(request('x'.repeat(65537)))).status, 413);
  assert.equal((await handle(request('{}'))).status, 400);
  assert.equal((await handle(request(JSON.stringify(payload)))).status, 200);
  assert.equal((await handle(request(JSON.stringify(payload)))).status, 200);
  await assert.rejects(db.query('select * from lkz_vnext_billing.asaas_sandbox_events'), { code: '42501' });
  await db.exec('reset role');
  assert.deepEqual((await db.query('select event_id, payment_id from lkz_vnext_billing.asaas_sandbox_events')).rows,
    [{ event_id: payload.id, payment_id: payload.payment.id }]);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from lkz_vnext_billing.asaas_sandbox_events'), { code: '42501' });
  assert.equal((await handle(request(JSON.stringify(payload)))).status, 503);
});

test('payment lookup fixes the Sandbox origin and verifies response identity', async () => {
  const payment = await fetchAsaasSandboxPayment('pay_fixture', randomUUID(), async (url, options) => {
    assert.equal(url, 'https://api-sandbox.asaas.com/v3/payments/pay_fixture');
    assert.equal(options.redirect, 'error');
    return Response.json({ id: 'pay_fixture', status: 'RECEIVED' });
  });
  assert.equal(payment.status, 'RECEIVED');
  await assert.rejects(fetchAsaasSandboxPayment('../other', randomUUID()), /Invalid/);
  await assert.rejects(fetchAsaasSandboxPayment('pay_fixture', randomUUID(),
    async () => Response.json({ id: 'pay_other' })), /Unexpected/);
});

test('an accepted Sandbox event survives closing and reopening the database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lkz-vnext-'));
  let db;
  try {
    db = new PGlite(directory);
    await db.exec('create role anon; create role authenticated');
    await db.exec(await sql('002-asaas-inbox.sql'));
    await db.exec('set role lkz_vnext_asaas_ingest');
    const token = randomUUID();
    const handle = createAsaasSandboxWebhook({ token, db });
    const response = await handle(new Request('https://webhook.example.test/', {
      method: 'POST',
      headers: { 'asaas-access-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'evt_restore', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_restore' } }),
    }));
    assert.equal(response.status, 200);
    await db.close();
    db = new PGlite(directory);
    const { rows } = await db.query('select event_id from lkz_vnext_billing.asaas_sandbox_events');
    assert.deepEqual(rows, [{ event_id: 'evt_restore' }]);
  } finally {
    if (db && !db.closed) await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Sandbox worker retries unavailable payments and stores only observed status', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('create role anon; create role authenticated');
  await db.exec(await sql('002-asaas-inbox.sql'));
  await db.exec(await sql('004-asaas-reconcile.sql'));
  const table = 'lkz_vnext_billing.asaas_sandbox_events';
  const token = randomUUID();
  const handle = createAsaasSandboxWebhook({ token, db });
  await db.exec('set role lkz_vnext_asaas_ingest');
  const response = await handle(new Request('https://webhook.example.test/', {
    method: 'POST',
    headers: { 'asaas-access-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'evt_worker', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_worker' } }),
  }));
  assert.equal(response.status, 200);
  await assert.rejects(db.query(`update ${table} set attempts = 5`), { code: '42501' });

  await db.exec('set role lkz_vnext_asaas_reconcile');
  await assert.rejects(db.query(`update ${table} set payment_id = 'pay_other'`), { code: '42501' });
  const apiKey = randomUUID();
  const unavailable = async () => new Response(null, { status: 503 });
  assert.equal(await reconcileNextAsaasSandboxEvent({ db, apiKey, request: unavailable }), 'retry');
  assert.equal(await reconcileNextAsaasSandboxEvent({ db, apiKey, request: unavailable }), 'idle');
  await db.query(`update ${table} set next_attempt_at = now()`);
  const reconciled = await reconcileNextAsaasSandboxEvent({
    db, apiKey, request: async () => Response.json({ id: 'pay_worker', status: 'REFUNDED', customer: 'discard' }),
  });
  assert.equal(reconciled, 'observed');
  assert.deepEqual((await db.query(`select observed_status, attempts from ${table}`)).rows,
    [{ observed_status: 'REFUNDED', attempts: 2 }]);

  await db.exec('reset role');
  await db.query(`insert into ${table} (event_id, event_type, payment_id, attempts)
    values ('evt_exhaust', 'PAYMENT_RECEIVED', 'pay_worker', 4)`);
  await db.exec('set role lkz_vnext_asaas_reconcile');
  assert.equal(await reconcileNextAsaasSandboxEvent({ db, apiKey, request: unavailable }), 'failed');
  assert.equal(await reconcileNextAsaasSandboxEvent({ db, apiKey, request: unavailable }), 'idle');
});
