import { createPreviewServer } from './preview.mjs';
import { createStagingAuth } from './staging-auth.mjs';
import { assertIntegrationRole, assertWorkspaceRole, openStagingDatabase } from './staging-db.mjs';
import { createOcaIntake } from './oca-intake.mjs';
import { createAsaasSandboxWebhook } from './asaas-sandbox.mjs';

try {
  const auth = createStagingAuth({
    url: process.env.VNEXT_AUTH_URL, publishableKey: process.env.VNEXT_AUTH_PUBLISHABLE_KEY,
  });
  const db = openStagingDatabase(process.env.VNEXT_RUNTIME_DATABASE_URL);
  let ingestDb;
  const close = () => Promise.all([db.close(), ingestDb?.close()]);
  try {
    await assertWorkspaceRole(db);
    const lacroseTenant = process.env.VNEXT_LACROSE_TENANT ?? null;
    const oca = process.env.VNEXT_OCA_HMAC_KEY ? createOcaIntake({
      db, tenant: lacroseTenant, actor: process.env.VNEXT_OCA_ACTOR,
      secret: process.env.VNEXT_OCA_HMAC_KEY,
    }) : undefined;
    const webhookToken = process.env.VNEXT_ASAAS_WEBHOOK_TOKEN;
    const ingestUrl = process.env.VNEXT_ASAAS_INGEST_DATABASE_URL;
    let asaasWebhook;
    if (webhookToken || ingestUrl) {
      ingestDb = openStagingDatabase(ingestUrl);
      await assertIntegrationRole(ingestDb, 'lkz_vnext_asaas_ingest');
      asaasWebhook = createAsaasSandboxWebhook({
        token: webhookToken, db: { query: (sql, values) => ingestDb.transaction(tx => tx.query(sql, values)) },
      });
    }
    const server = createPreviewServer(db, { auth, oca, asaasWebhook, lacroseTenant });
    server.listen(4176, '127.0.0.1', () => console.log('LKZ ADM VNext | http://127.0.0.1:4176'));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => void close()));
    server.once('error', () => {
      console.error('Failed to start the staging HTTP server.');
      process.exitCode = 1;
      void close();
    });
  } catch (error) {
    await close();
    throw error;
  }
} catch {
  console.error('Invalid VNext staging configuration.');
  process.exitCode = 1;
}
