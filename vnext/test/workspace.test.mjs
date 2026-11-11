import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPreviewDatabase, fixture } from '../preview-db.mjs';
import { createPreviewServer } from '../preview.mjs';
import { serveWorkspace } from '../workspace.mjs';
import { createAsaasSandboxWebhook } from '../asaas-sandbox.mjs';
import { createOcaIntake } from '../oca-intake.mjs';
import { createOcaStagingSender } from '../oca-staging-sender.mjs';

test('CRM, OCA and commercial drafts work through the workspace API with tenant isolation', async (t) => {
  const db = await createPreviewDatabase();
  t.after(() => db.close());
  const admin = { sub: fixture.admin, aal: 'aal2' };
  const viewer = { sub: fixture.viewer, aal: 'aal2' };
  const adminB = { sub: fixture.secondAdmin, aal: 'aal2' };

  async function call(route, { data, tenant = fixture.tenant, claims = admin } = {}) {
    const request = new Request('https://workspace.example.test/api/' + route + '?tenant=' + tenant,
      data === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const response = await serveWorkspace(request, db, claims);
    return [response.status, await response.json()];
  }

  assert.equal((await call('leads', { claims: null }))[0], 401);
  assert.equal((await call('leads', { claims: { ...admin, aal: 'aal1' } }))[0], 403);
  assert.equal((await call('leads', { claims: adminB }))[0], 403);
  assert.deepEqual(await call('leads', { tenant: fixture.secondTenant, claims: adminB }), [200, []]);

  const lead = { name: 'Cliente fictício', email: 'cliente@example.test', oca_reference: randomUUID() };
  assert.equal((await call('oca/intake', { data: lead, claims: viewer }))[0], 403);
  const [created, first] = await call('oca/intake', { data: lead });
  assert.equal(created, 201);
  assert.deepEqual(await call('oca/intake', { data: lead }), [200, first]);
  assert.equal((await call('oca/intake', { data: { ...lead, email: 'outro@example.test' } }))[0], 409);
  assert.equal((await call('leads'))[1].length, 1);

  const [, answer] = await call('oca/assist', { data: { question: 'O BarbarOS já pode ser contratado?' } });
  assert.match(answer.answer, /em desenvolvimento/);
  assert.deepEqual(answer.drafts, ['BarbarOS', 'LibertyOS']);
  const [, otherAnswer] = await call('oca/assist', {
    tenant: fixture.secondTenant, claims: adminB, data: { question: 'Olá' },
  });
  assert.deepEqual(otherAnswer.drafts, []);

  const opportunityData = { lead_id: first.id, title: 'Projeto fictício' };
  assert.equal((await call('opportunities', { data: opportunityData, claims: viewer }))[0], 403);
  assert.equal((await call('opportunities', { data: opportunityData, tenant: fixture.secondTenant, claims: adminB }))[0], 409);
  const [createdOpportunity, opportunity] = await call('opportunities', { data: opportunityData });
  assert.equal(createdOpportunity, 201);
  const stageRoute = 'opportunities/' + opportunity.id + '/stage';
  assert.equal((await call(stageRoute, { data: { stage: 'won' }, claims: viewer }))[0], 404);
  assert.equal((await call(stageRoute, { data: { stage: 'negotiation' } }))[1].stage, 'negotiation');
  assert.equal((await call('interactions', { data: { lead_id: first.id, channel: 'oca', note: 'Contato fictício' } }))[0], 201);

  const [, converted] = await call('leads/' + first.id + '/convert', { data: {} });
  assert.ok(converted.client_id);
  const [, products] = await call('products');
  const [createdPlan, plan] = await call('plans', {
    data: { product_id: products[0].id, name: 'Plano fictício', amount_brl_cents: 100, interval: 'monthly' },
  });
  assert.equal(createdPlan, 201);
  const draft = { client_id: converted.client_id, plan_id: plan.id };
  assert.equal((await call('subscription_drafts', { data: draft, claims: viewer }))[0], 403);
  const [createdDraft, subscription] = await call('subscription_drafts', { data: draft });
  assert.equal(createdDraft, 201);
  const eligibility = 'subscription_drafts/' + subscription.id + '/eligibility';
  assert.deepEqual(await call(eligibility), [200, {
    eligible: false, product: products[0].slug, reason: 'product_not_homologated',
  }]);
  assert.equal((await call(eligibility, { tenant: fixture.secondTenant, claims: adminB }))[0], 404);
  assert.equal((await call('subscription_drafts', { data: draft }))[0], 409);
  assert.deepEqual(await call('audit', { claims: viewer }), [200, []]);
  assert.equal(Number((await call('overview'))[1].leads), 1);
  assert.equal(Number((await call('overview', { tenant: fixture.secondTenant, claims: adminB }))[1].leads), 0);
  const [, audit] = await call('audit');
  assert.ok(audit.some(event => event.entity === 'interactions'));
  assert.ok(audit.some(event => event.entity === 'subscription_drafts'));
});

test('loopback server serves the interface and rejects foreign origins on writes', async (t) => {
  const db = await createPreviewDatabase();
  const server = createPreviewServer(db);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await db.close();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const html = await fetch(origin);
  assert.match(await html.text(), /LKZ ADM VNext/);
  assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const url = origin + '/api/leads?tenant=' + fixture.tenant;
  const input = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Teste', email: 'teste@example.test' }) };
  assert.equal((await fetch(url, { ...input, headers: { ...input.headers, origin: 'https://foreign.example.test' } })).status, 403);
  assert.equal((await fetch(url, { ...input, headers: { ...input.headers, origin } })).status, 201);
  assert.equal((await (await fetch(url)).json()).length, 1);
});

test('the staging HTTP routes deliver signed OCA events and persist authenticated Sandbox webhooks', async (t) => {
  const db = await createPreviewDatabase();
  const secret = randomBytes(32).toString('hex');
  const webhookToken = randomUUID();
  const oca = createOcaIntake({ db, tenant: fixture.tenant, actor: fixture.viewer, secret });
  const asaasWebhook = createAsaasSandboxWebhook({
    token: webhookToken,
    db: { query: (sql, args) => db.transaction(async tx => {
      await tx.exec('set local role lkz_vnext_asaas_ingest');
      return tx.query(sql, args);
    }) },
  });
  const server = createPreviewServer(db, { oca, asaasWebhook });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await db.close();
  });
  await db.query("update lkz_vnext.memberships set role='operator' where user_id=$1", [fixture.viewer]);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const send = createOcaStagingSender({
    secret, request: (url, options) => fetch(origin + new URL(url).pathname, options),
  });
  const event = { eventId: randomUUID(), conversationId: randomUUID(), consent: true,
    name: 'Fixture', email: 'oca@example.test', note: 'Resumo fictício' };
  assert.equal(await send({ ...event, consent: false }), 'invalid');
  assert.equal(await send(event), 'accepted');
  assert.equal(await send(event), 'duplicate');
  assert.equal(await send({ ...event, note: 'Resumo divergente' }), 'conflict');

  const interactions = await fetch(origin + '/api/interactions?tenant=' + fixture.tenant);
  assert.equal(interactions.status, 200);
  assert.deepEqual((await interactions.json()).map(row => row.oca_event_id), [event.eventId]);
  const audit = await (await fetch(origin + '/api/audit?tenant=' + fixture.tenant)).json();
  assert.equal(audit.filter(row => row.entity === 'interactions' && row.actor_id === fixture.viewer).length, 1);

  const webhook = token => fetch(origin + '/integrations/asaas-sandbox', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'asaas-access-token': token },
    body: JSON.stringify({ id: 'evt_fixture_http', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_fixture_http' } }),
  });
  assert.equal((await webhook(randomUUID())).status, 401);
  assert.equal((await webhook(webhookToken)).status, 200);
  assert.equal((await webhook(webhookToken)).status, 200);
  const { rows } = await db.query(`
    select payment_id from lkz_vnext_billing.asaas_sandbox_events where event_id='evt_fixture_http'
  `);
  assert.deepEqual(rows, [{ payment_id: 'pay_fixture_http' }]);
});
