import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createPreviewDatabase, fixture, withIdentity } from '../preview-db.mjs';
import { createOcaIntake } from '../oca-intake.mjs';
import { createStagingAuth } from '../staging-auth.mjs';
import { openStagingDatabase } from '../staging-db.mjs';
import { reconcileBoundSandboxPayment } from '../commercial-reconcile.mjs';

test('staging refuses institutional endpoints and requires verified AAL2 claims', async () => {
  assert.throws(() => openStagingDatabase('postgres://user@127.0.0.1/postgres'));
  assert.throws(() => openStagingDatabase('postgres://user@db.icrtewhazpfauuroswri.supabase.co/lkz_vnext_stage'));
  const url = 'https://stagingfixture.supabase.co';
  const factor = randomUUID();
  const challenge = randomUUID();
  const standard = { iss: url + '/auth/v1', aud: 'authenticated', role: 'authenticated',
    is_anonymous: false, sub: fixture.admin, exp: Math.floor(Date.now() / 1000) + 60 };
  const auth = createStagingAuth({
    url,
    publishableKey: 'sb_publishable_' + randomUUID(),
    clientFactory: () => ({ auth: { getClaims: async token => ({
      data: { claims: { ...standard, aal: token === 'valid.aal.two' ? 'aal2' : 'aal1',
        ...(token === 'invalid.jwt.issuer' ? { iss: 'https://invalid.example.test' } : {}) } },
    }) } }),
    request: async (endpoint, options) => {
      if (endpoint.endsWith('/token?grant_type=password')) return Response.json({ access_token: 'valid.aal.one' });
      if (endpoint.endsWith('/user')) return Response.json({ factors: [{ id: factor, factor_type: 'totp', status: 'verified' }] });
      assert.equal(options.headers.authorization, 'Bearer valid.aal.one');
      if (endpoint.endsWith('/challenge')) return Response.json({ id: challenge });
      assert.deepEqual(JSON.parse(options.body), { challenge_id: challenge, code: '123456' });
      return Response.json({ access_token: 'valid.aal.two' });
    },
  });
  assert.equal(await auth.verify('valid.aal.one'), null);
  assert.equal(await auth.verify('invalid.jwt.issuer', false), null);
  assert.deepEqual(await auth.verify('valid.aal.two'), { sub: fixture.admin, aal: 'aal2' });
  const login = await auth.handle(new Request(url + '/auth/login', {
    method: 'POST', body: JSON.stringify({ email: 'fixture@example.test', password: randomUUID() }),
  }));
  assert.deepEqual(await login.json(), { token: 'valid.aal.one', factorId: factor });
  const mfa = await auth.handle(new Request(url + '/auth/mfa', {
    method: 'POST', headers: { authorization: 'Bearer valid.aal.one' },
    body: JSON.stringify({ factorId: factor, code: '123456' }),
  }));
  assert.deepEqual(await mfa.json(), { token: 'valid.aal.two' });
});

test('signed OCA delivery is tenant-pinned, idempotent, audited and fail-closed', async (t) => {
  const db = await createPreviewDatabase();
  t.after(() => db.close());
  await db.query("update lkz_vnext.memberships set role='operator' where user_id=$1", [fixture.viewer]);
  const secret = randomBytes(32).toString('hex');
  const intake = createOcaIntake({ db, tenant: fixture.tenant, actor: fixture.viewer, secret });
  const payload = {
    eventId: randomUUID(), conversationId: randomUUID(), tenant: fixture.secondTenant,
    name: 'Fixture', email: 'test@example.test', note: 'Resumo fict?cio', consent: true,
  };
  const send = async (value, options = {}) => {
    const timestamp = String(Math.floor(Date.now() / 1000) - (options.age ?? 0));
    const body = JSON.stringify(value);
    const signature = createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(timestamp + '.').update(body).digest('hex');
    const response = await intake(new Request('https://fixture.example.test/integrations/oca', {
      method: 'POST', body,
      headers: { 'content-type': 'application/json', 'x-oca-timestamp': timestamp,
        'x-oca-signature': options.signature ?? signature },
    }));
    return response.status;
  };
  assert.equal(await send(payload, { signature: '0'.repeat(64) }), 401);
  assert.equal(await send(payload, { age: 301 }), 401);
  assert.equal(await send({ ...payload, consent: false }), 400);
  assert.equal(await send(payload), 201);
  assert.equal(await send(payload), 200);
  assert.equal(await send({ ...payload, note: 'Outro resumo' }), 409);
  await withIdentity(db, { sub: fixture.admin, aal: 'aal2' }, async tx => {
    assert.deepEqual((await tx.query('select tenant_id, oca_event_id from lkz_vnext.interactions')).rows,
      [{ tenant_id: fixture.tenant, oca_event_id: payload.eventId }]);
    assert.ok((await tx.query("select 1 from lkz_vnext.audit where actor_id=$1 and entity='interactions'", [fixture.viewer])).rows.length);
  });
  await db.query('update lkz_vnext.memberships set active=false where user_id=$1', [fixture.viewer]);
  assert.equal(await send({ ...payload, eventId: randomUUID() }), 403);
});

test('Sandbox reconciliation updates only matched bindings and license requests stay blocked', async (t) => {
  const db = await createPreviewDatabase();
  t.after(() => db.close());
  const tenant = fixture.tenant;
  const binding = randomUUID();
  const subscription = await withIdentity(db, { sub: fixture.admin, aal: 'aal2' }, async tx => {
    const { rows: [client] } = await tx.query(
      "insert into lkz_vnext.clients (tenant_id,name,email) values ($1,'Fixture','fixture@example.test') returning id", [tenant]);
    const { rows: [product] } = await tx.query("select id from lkz_vnext.products where slug='barbaros'");
    const { rows: [plan] } = await tx.query(
      "insert into lkz_vnext.plans (tenant_id,product_id,name,amount_brl_cents,interval) values ($1,$2,'Fixture',2500,'monthly') returning id",
      [tenant, product.id]);
    const { rows: [draft] } = await tx.query(
      'insert into lkz_vnext.subscription_drafts (tenant_id,client_id,plan_id) values ($1,$2,$3) returning id',
      [tenant, client.id, plan.id]);
    const { rows: [license] } = await tx.query(
      'insert into lkz_vnext.license_requests (tenant_id,subscription_id) values ($1,$2) returning state', [tenant,draft.id]);
    assert.equal(license.state, 'blocked');
    return draft.id;
  });
  await db.query(`insert into lkz_vnext_billing.payment_bindings
    (payment_id,tenant_id,subscription_id,customer_id,external_reference,expected_brl_cents)
    values ('pay_fixture',$1,$2,'cus_fixture',$3,2500)`, [tenant, subscription, binding]);
  await db.exec(`insert into lkz_vnext_billing.asaas_sandbox_events (event_id,event_type,payment_id)
    values ('evt_confirm','PAYMENT_RECEIVED','pay_fixture'),('evt_refund','PAYMENT_REFUNDED','pay_fixture')`);
  await db.exec('set role lkz_vnext_asaas_reconcile');
  const reconcile = (eventId, status, value = 25) => reconcileBoundSandboxPayment({
    db, eventId, apiKey: randomUUID(), request: async () => Response.json({
      id: 'pay_fixture', customer: 'cus_fixture', externalReference: binding, value, status,
    }),
  });
  assert.equal(await reconcile('evt_confirm', 'RECEIVED', 25.01), 'mismatch');
  assert.equal(await reconcile('evt_confirm', 'RECEIVED'), 'paid');
  assert.equal(await reconcile('evt_confirm', 'RECEIVED'), 'already_processed');
  assert.equal(await reconcile('evt_refund', 'REFUNDED'), 'reversed');
  assert.equal((await db.query('select state from lkz_vnext_billing.payment_bindings')).rows[0].state, 'reversed');
  await db.exec('reset role');
  assert.equal((await db.query('select state from lkz_vnext.license_requests')).rows[0].state, 'blocked');
});
