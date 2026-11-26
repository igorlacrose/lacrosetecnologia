import { once } from 'node:events';
import { createAsaasSandboxWebhook } from './asaas-sandbox.mjs';
import { createPreviewServer } from './preview.mjs';
import { assertIntegrationRole, openStagingDatabase, withAsaasRole } from './staging-db.mjs';

export async function openStagingAsaasWebhook({ connection, token }) {
  const db = openStagingDatabase(connection);
  try {
    await assertIntegrationRole(db, 'lkz_vnext_asaas_ingest');
    const scoped = withAsaasRole(db, 'lkz_vnext_asaas_ingest');
    const handler = createAsaasSandboxWebhook({
      token, db: { query: (sql, args) => scoped.transaction(tx => tx.query(sql, args)) },
    });
    return { handler, close: db.close };
  } catch (error) {
    await db.close();
    throw error;
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  let ingest;
  try {
    ingest = await openStagingAsaasWebhook({
      connection: process.env.VNEXT_ASAAS_INGEST_DATABASE_URL,
      token: process.env.VNEXT_ASAAS_WEBHOOK_TOKEN,
    });
    const server = createPreviewServer(undefined, { asaasWebhook: ingest.handler, webhookOnly: true });
    server.listen(4177, '127.0.0.1');
    await once(server, 'listening');
    console.log('Asaas Sandbox webhook | http://127.0.0.1:4177/integrations/asaas-sandbox');
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => server.close(() => void ingest.close()));
    }
  } catch {
    await ingest?.close();
    console.error('Failed to start the isolated Sandbox webhook.');
    process.exitCode = 1;
  }
}
