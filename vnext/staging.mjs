import { createPreviewServer } from './preview.mjs';
import { createStagingAuth } from './staging-auth.mjs';
import { assertWorkspaceRole, openStagingDatabase } from './staging-db.mjs';
import { createOcaIntake } from './oca-intake.mjs';

try {
  const auth = createStagingAuth({
    url: process.env.VNEXT_AUTH_URL, publishableKey: process.env.VNEXT_AUTH_PUBLISHABLE_KEY,
  });
  const db = openStagingDatabase(process.env.VNEXT_RUNTIME_DATABASE_URL);
  try {
    await assertWorkspaceRole(db);
    const lacroseTenant = process.env.VNEXT_LACROSE_TENANT ?? null;
    const oca = process.env.VNEXT_OCA_HMAC_KEY ? createOcaIntake({
      db, tenant: lacroseTenant, actor: process.env.VNEXT_OCA_ACTOR,
      secret: process.env.VNEXT_OCA_HMAC_KEY,
    }) : undefined;
    const server = createPreviewServer(db, { auth, oca, lacroseTenant });
    server.listen(4176, '127.0.0.1', () => console.log('LKZ ADM VNext | http://127.0.0.1:4176'));
    process.once('SIGINT', () => server.close(() => db.close()));
    server.once('error', () => {
      console.error('Failed to start the staging HTTP server.');
      process.exitCode = 1;
      void db.close();
    });
  } catch (error) {
    await db.close();
    throw error;
  }
} catch {
  console.error('Invalid VNext staging configuration.');
  process.exitCode = 1;
}
