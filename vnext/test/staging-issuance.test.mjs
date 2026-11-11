import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { issueSandboxRecord } from '../asaas-issuance.mjs';
import { createAsaasSandboxWebhook } from '../asaas-sandbox.mjs';
import { reconcileBoundSandboxPayment } from '../commercial-reconcile.mjs';
import { createPreviewDatabase, fixture, withIdentity } from '../preview-db.mjs';

function asRole(db, role) {
  return { transaction: operation => db.transaction(async tx => {
    await tx.exec('set local role ' + role);
    return operation(tx);
  }) };
}

test('Sandbox issuance reserves before POST, recovers without another POST and reconciles both payment types', async t => {
  const db = await createPreviewDatabase();
  t.after(() => db.close());
  const tenant = fixture.tenant;
  const { client, realClient, once, monthly } = await withIdentity(db, { sub: fixture.admin, aal: 'aal2' }, async tx => {
    const { rows: [client, realClient] } = await tx.query(`
      insert into lkz_vnext.clients (tenant_id,name,email) values
      ($1,'Fixture','payer@example.test'), ($1,'Fixture','payer@external.invalid') returning id
    `, [tenant]);
    const { rows: [product] } = await tx.query("select id from lkz_vnext.products where slug='barbaros'");
    const { rows: [oncePlan, monthlyPlan] } = await tx.query(`
      insert into lkz_vnext.plans (tenant_id,product_id,name,amount_brl_cents,interval) values
      ($1,$2,'Fixture once',2500,'once'), ($1,$2,'Fixture monthly',3000,'monthly') returning id
    `, [tenant, product.id]);
    const { rows: [once, monthly] } = await tx.query(`
      insert into lkz_vnext.subscription_drafts (tenant_id,client_id,plan_id) values
      ($1,$2,$3), ($1,$2,$4) returning id
    `, [tenant, client.id, oncePlan.id, monthlyPlan.id]);
    const { rows: [license] } = await tx.query(
      'insert into lkz_vnext.license_requests (tenant_id,subscription_id) values ($1,$2) returning state', [tenant, monthly.id]);
    assert.equal(license.state, 'blocked');
    return { client, realClient, once, monthly };
  });
  const created = new Map();
  let postCount = 0;
  const gateway = {
    async create(op, body) {
      postCount += 1;
      const id = { customers: 'cus_fixture', payments: 'pay_once', subscriptions: 'sub_fixture' }[op.kind];
      const result = { ...body, id };
      created.set(op.kind, result);
      if (op.kind === 'customers') throw new Error('gateway committed before connection closed');
      return result;
    },
    async lookup(op) { return created.get(op.kind); },
  };
  const issuer = asRole(db, 'lkz_vnext_asaas_issue');
  const issue = (kind, subject, options) => issueSandboxRecord({
    db: issuer, gateway, kind, subject, tenant, ...options,
  });
  const customer = { fixtureTaxId: '0'.repeat(11) };
  const contract = { dueDate: '2030-01-15', billingType: 'PIX' };
  assert.equal(await issue('customers', realClient.id, customer), 'not_eligible');
  assert.equal(await issue('payments', once.id, contract), 'not_eligible');
  assert.equal(await issue('customers', client.id, customer), 'needs_reconciliation');
  assert.equal(await issue('customers', client.id, customer), 'linked');
  assert.equal(await issue('customers', client.id, customer), 'already_linked');
  assert.equal(await issue('subscriptions', once.id, contract), 'not_eligible');
  assert.equal(await issue('payments', once.id, contract), 'linked');
  assert.equal(await issue('subscriptions', monthly.id, contract), 'linked');
  assert.equal(await issue('subscriptions', monthly.id, { ...contract, billingType: 'BOLETO' }), 'not_eligible');
  assert.equal(postCount, 3);
  assert.equal(created.get('subscriptions').cycle, 'MONTHLY');
  assert.equal(created.get('subscriptions').value, 30);

  const token = randomUUID();
  const ingest = asRole(db, 'lkz_vnext_asaas_ingest');
  const webhook = createAsaasSandboxWebhook({ token, db: { query: (sql, args) => ingest.transaction(tx => tx.query(sql, args)) } });
  async function ingestEvent(id, paymentId, accessToken = token) {
    const response = await webhook(new Request('http://127.0.0.1:4176/integrations/asaas-sandbox', {
      method: 'POST', headers: { 'content-type': 'application/json', 'asaas-access-token': accessToken },
      body: JSON.stringify({ id, event: 'PAYMENT_RECEIVED', payment: { id: paymentId } }),
    }));
    return response.status;
  }
  assert.equal(await ingestEvent('evt_once', 'pay_once', randomUUID()), 401);
  assert.equal(await ingestEvent('evt_once', 'pay_once'), 200);
  assert.equal(await ingestEvent('evt_recur_1', 'pay_recur_1'), 200);
  assert.equal(await ingestEvent('evt_recur_1', 'pay_recur_1'), 200);
  assert.equal(await ingestEvent('evt_recur_2', 'pay_recur_2'), 200);
  const reconciler = asRole(db, 'lkz_vnext_asaas_reconcile');
  const reconcile = (eventId, payment) => reconcileBoundSandboxPayment({
    db: reconciler, eventId, apiKey: randomUUID(), request: async () => Response.json(payment),
  });
  assert.equal(await reconcile('evt_once', { ...created.get('payments'), status: 'RECEIVED' }), 'paid');
  const recurring = { id: 'pay_recur_1', subscription: 'sub_fixture', customer: 'cus_fixture', value: 30, status: 'RECEIVED' };
  assert.equal(await reconcile('evt_recur_1', { ...recurring, customer: 'cus_unknown' }), 'mismatch');
  assert.equal(await reconcile('evt_recur_1', recurring), 'paid');
  assert.equal(await reconcile('evt_recur_1', recurring), 'already_processed');
  assert.equal(await reconcile('evt_recur_2', { ...recurring, id: 'pay_recur_2' }), 'paid');
  assert.equal((await db.query('select state from lkz_vnext.license_requests')).rows[0].state, 'blocked');
  assert.equal((await db.query('select count(*) as count from lkz_vnext_billing.payment_bindings')).rows[0].count, 3);
});
