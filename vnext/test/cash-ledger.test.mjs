import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createPreviewDatabase, fixture, withIdentity } from '../preview-db.mjs';
import { serveWorkspace } from '../workspace.mjs';

test('cash entries are scoped, idempotent and reversible through an append-only ledger', async t => {
  const db = await createPreviewDatabase();
  t.after(() => db.close());
  const admin = { sub: fixture.admin, aal: 'aal2' };
  const viewer = { sub: fixture.viewer, aal: 'aal2' };
  const date = '2026-01-10';
  const receipt = { id: randomUUID(), business_date: date, amount_brl_cents: 15000, reference: 'Pedido fictício' };
  const send = (data, claims = admin, tenant = fixture.tenant, route = 'cash') => serveWorkspace(new Request(
    `http://localhost/api/${route}?tenant=${tenant}&date=${date}`,
    data ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) } : {},
  ), db, claims);

  assert.equal((await send(receipt, null)).status, 401);
  assert.equal((await send(receipt, { ...admin, aal: 'aal1' })).status, 403);
  assert.equal((await send(receipt, viewer)).status, 403);
  assert.equal((await send(receipt, admin, fixture.secondTenant)).status, 403);
  assert.equal((await send({ ...receipt, business_date: '2099-01-01' })).status, 400);
  const results = await Promise.all([send(receipt), send(receipt)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 201]);
  assert.equal((await send({ ...receipt, reference: 'Outra origem' })).status, 409);
  const count = { id: randomUUID(), business_date: date, counted_brl_cents: 14700 };
  const countCash = (data, claims = admin) => send(data, claims, fixture.tenant, 'cash/counts');
  assert.equal((await countCash(count, viewer)).status, 403);
  const counted = await countCash(count);
  assert.equal(counted.status, 201);
  assert.deepEqual(await counted.json(), { id: count.id, expected_brl_cents: '15000', difference_brl_cents: '-300' });
  const reversal = { ...receipt, id: randomUUID(), reverses_id: receipt.id, reference: 'Estorno fictício' };
  assert.equal((await send({ ...reversal, amount_brl_cents: 100 })).status, 400);
  const otherAdmin = { sub: fixture.secondAdmin, aal: 'aal2' };
  assert.equal((await send(reversal, otherAdmin, fixture.secondTenant)).status, 400);
  assert.equal((await send(reversal)).status, 201);
  assert.equal((await send(reversal)).status, 200);
  assert.equal((await send({ ...reversal, id: randomUUID() })).status, 409);
  assert.equal((await send({ ...reversal, id: randomUUID(), reverses_id: reversal.id })).status, 400);
  const { entries, ...totals } = await (await send()).json();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].reverses_id, receipt.id);
  assert.deepEqual(totals, {
    entry_count: '2', received_cents: '15000', reversed_cents: '15000', expected_cents: '0',
  });
  assert.deepEqual(await (await countCash(count)).json(), {
    id: count.id, expected_brl_cents: '15000', difference_brl_cents: '-300',
  });
  assert.equal((await countCash({ ...count, counted_brl_cents: 0 })).status, 409);
  await withIdentity(db, admin, async tx => {
    const { rows } = await tx.query("select actor_id from lkz_vnext.audit where entity='cash_entries'");
    assert.deepEqual(rows, [{ actor_id: fixture.admin }, { actor_id: fixture.admin }]);
  });
  for (const sql of [
    'update lkz_vnext.cash_entries set amount_brl_cents=1',
    'delete from lkz_vnext.cash_entries',
    'insert into lkz_vnext.cash_entries (actor_id) values (auth.uid())',
  ]) {
    await assert.rejects(withIdentity(db, admin, tx => tx.exec(sql)), { code: '42501' });
  }
});
