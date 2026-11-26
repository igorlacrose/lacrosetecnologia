import assert from 'node:assert/strict';

// Execute ONLY inside the disposable PG17 service created by GitHub Actions.
// Test roles and references are synthetic. No network request or real payment.
const roles = new Set([
  'lkz_vnext_asaas_ingest',
  'lkz_vnext_asaas_issue',
  'lkz_vnext_asaas_reconcile',
]);

export async function verifyAsaasLeastPrivilege(pool) {
  async function asRole(role, sql, args = []) {
    if (!roles.has(role)) throw new Error('Unapproved test role');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role ' + role);
      const result = await client.query(sql, args);
      await client.query('rollback');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  const ingest = 'lkz_vnext_asaas_ingest';
  const issue = 'lkz_vnext_asaas_issue';
  const reconcile = 'lkz_vnext_asaas_reconcile';

  // Only the ingest worker may accept the minimal signed webhook envelope.
  // The enclosing test transaction is rolled back intentionally.
  assert.equal((await asRole(ingest,
    'insert into lkz_vnext_billing.asaas_sandbox_events ' +
    '(event_id,event_type,payment_id) values($1,$2,$3)',
    ['evt_ci_ingest_acl','PAYMENT_RECEIVED','pay_ci_ingest_acl']
  )).rowCount,1);

  const forbidden = [
    [ingest,'select event_id from lkz_vnext_billing.asaas_sandbox_events'],
    [ingest,"update lkz_vnext_billing.asaas_sandbox_events set event_type='PAYMENT_REFUNDED'"],
    [ingest,'select * from lkz_vnext_billing.payment_bindings'],
    [ingest,'select * from lkz_vnext.clients'],
    [issue,'select * from lkz_vnext_billing.asaas_sandbox_events'],
    [issue,"update lkz_vnext_billing.payment_bindings set state='paid'"],
    [issue,'select * from lkz_vnext_billing.payment_state_events'],
    [reconcile,
      "insert into lkz_vnext_billing.asaas_sandbox_events " +
      "(event_id,event_type,payment_id) values('evt_bad','PAYMENT_RECEIVED','pay_bad')"],
    [reconcile,
      "update lkz_vnext_billing.sandbox_issuance set provider_id='pay_bad'"],
    [reconcile,'select * from lkz_vnext.clients'],
  ];
  for(const [role,sql] of forbidden){
    await assert.rejects(asRole(role,sql), error => error.code === '42501',
      'Forbidden worker operation unexpectedly succeeded: ' + role);
  }

  // The reconcile worker may read the minimal inbox and existing binding, but
  // cannot impersonate the signer/issuer or alter provider reference linkage.
  const {rows:[binding]} = await asRole(reconcile,
    'select payment_id,state from lkz_vnext_billing.payment_bindings ' +
    'order by payment_id limit 1');
  assert.ok(binding?.payment_id?.startsWith('pay_'));
  assert.ok(['paid','overdue'].includes(binding.state));

  // The issuer only sees email-gated sandbox fixtures, never actual billing
  // state/history. Its RLS client policy must remain active.
  const {rows:clients} = await asRole(issue,
    'select email from lkz_vnext.clients order by email');
  assert.ok(clients.length >= 2);
  assert.ok(clients.every(c => c.email.endsWith('@example.test')));

  const {rows:checks} = await pool.query(
    'select c.relname, c.relrowsecurity ' +
    'from pg_catalog.pg_class c ' +
    'join pg_catalog.pg_namespace n on n.oid=c.relnamespace ' +
    "where n.nspname='lkz_vnext_billing' and c.relkind in ('r','p') " +
    'order by c.relname'
  );
  assert.ok(checks.length >= 4);
  assert.ok(checks.every(row => row.relrowsecurity === true),
    'Every billing table must have RLS enabled');
}
