import { createAsaasSandboxIssuer, issueSandboxRecord } from './asaas-issuance.mjs';
import { assertIntegrationRole, openStagingDatabase, withAsaasRole } from './staging-db.mjs';

try {
  const [kind, subject, dueDate, billingType, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('Unexpected arguments');
  const gateway = createAsaasSandboxIssuer({ apiKey: process.env.ASAAS_SANDBOX_API_KEY });
  const db = openStagingDatabase(process.env.VNEXT_ASAAS_ISSUE_DATABASE_URL);
  try {
    await assertIntegrationRole(db, 'lkz_vnext_asaas_issue');
    const scoped = withAsaasRole(db, 'lkz_vnext_asaas_issue');
    const result = await issueSandboxRecord({ db: scoped, gateway, kind, subject, dueDate, billingType,
      tenant: process.env.VNEXT_ASAAS_TENANT, fixtureTaxId: process.env.VNEXT_ASAAS_FIXTURE_TAX_ID });
    console.log('Sandbox issuance:', result);
    if (!['linked', 'already_linked'].includes(result)) process.exitCode = 2;
  } finally {
    await db.close();
  }
} catch {
  console.error('Sandbox issuance failed. Review configuration and reconcile any pending reference.');
  process.exitCode = 1;
}
