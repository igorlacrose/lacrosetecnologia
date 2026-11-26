import { reconcileBoundSandboxPayment, reconcileNextCommercialEvent } from './commercial-reconcile.mjs';
import { assertIntegrationRole, openStagingDatabase, withAsaasRole } from './staging-db.mjs';

try {
  const eventId = process.argv[2];
  const apiKey = process.env.ASAAS_SANDBOX_API_KEY;
  if ((eventId !== '--next' && !/^evt_[A-Za-z0-9_&-]{1,150}$/.test(eventId ?? '')) || !apiKey) {
    throw new Error('Missing Sandbox credentials or event');
  }
  const db = openStagingDatabase(process.env.VNEXT_ASAAS_RECONCILE_DATABASE_URL);
  try {
    await assertIntegrationRole(db, 'lkz_vnext_asaas_reconcile');
    const scoped = withAsaasRole(db, 'lkz_vnext_asaas_reconcile');
    const result = eventId === '--next'
      ? await reconcileNextCommercialEvent({ db: scoped, apiKey })
      : await reconcileBoundSandboxPayment({ db: scoped, eventId, apiKey });
    console.log('Sandbox reconciliation:', result);
    if (!['already_processed', 'paid', 'pending', 'overdue', 'reversed', 'disputed', 'applied', 'idle'].includes(result)) process.exitCode = 2;
  } finally {
    await db.close();
  }
} catch {
  console.error('Sandbox reconciliation failed. No payment was created.');
  process.exitCode = 1;
}
