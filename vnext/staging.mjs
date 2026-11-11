import { createPreviewServer } from './preview.mjs';
import { createStagingAuth } from './staging-auth.mjs';
import { assertWorkspaceRole, assertMetaRole, openStagingDatabase } from './staging-db.mjs';
import { createMetaWhatsappProvider } from './meta-whatsapp.mjs';
import { createOcaIntake } from './oca-intake.mjs';
import { openStagingAsaasWebhook } from './staging-asaas-webhook.mjs';

try {
  const auth = createStagingAuth({
    url: process.env.VNEXT_AUTH_URL, publishableKey: process.env.VNEXT_AUTH_PUBLISHABLE_KEY,
  });
  const db = openStagingDatabase(process.env.VNEXT_RUNTIME_DATABASE_URL);
  let ingest, metaDb;
  const close = () => Promise.all([db.close(), ingest?.close(), metaDb?.close()]);
  try {
    await assertWorkspaceRole(db);
    const lacroseTenant = process.env.VNEXT_LACROSE_TENANT ?? null;
    const oca = process.env.VNEXT_OCA_HMAC_KEY ? createOcaIntake({
      db, tenant: lacroseTenant, actor: process.env.VNEXT_OCA_ACTOR,
      secret: process.env.VNEXT_OCA_HMAC_KEY,
    }) : undefined;
    const webhookToken = process.env.VNEXT_ASAAS_WEBHOOK_TOKEN;
    const ingestUrl = process.env.VNEXT_ASAAS_INGEST_DATABASE_URL;
    if (webhookToken || ingestUrl) {
      ingest = await openStagingAsaasWebhook({ connection: ingestUrl, token: webhookToken });
    }
    // Opt-in only. Partial Meta configuration aborts startup: no unsafe fallback.
    const metaNames = ['VNEXT_META_DATABASE_URL','VNEXT_META_APP_ID','VNEXT_META_CONFIG_ID',
      'VNEXT_META_APP_SECRET','VNEXT_META_TOKEN_ENCRYPTION_KEY','VNEXT_META_GRAPH_VERSION'];
    const metaEnabled = metaNames.some(name => process.env[name]);
    let metaProvider;
    if (metaEnabled) {
      if (!metaNames.every(name => process.env[name])) throw new Error('Incomplete Meta integration configuration');
      metaDb = openStagingDatabase(process.env.VNEXT_META_DATABASE_URL);
      await assertMetaRole(metaDb);
      metaProvider = createMetaWhatsappProvider({
        db: metaDb,
        appId: process.env.VNEXT_META_APP_ID,
        configId: process.env.VNEXT_META_CONFIG_ID,
        appSecret: process.env.VNEXT_META_APP_SECRET,
        tokenKey: process.env.VNEXT_META_TOKEN_ENCRYPTION_KEY,
        version: process.env.VNEXT_META_GRAPH_VERSION,
      });
    }
    const server = createPreviewServer(db, {
      auth, oca, asaasWebhook: ingest?.handler, lacroseTenant, metaProvider,
    });
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
