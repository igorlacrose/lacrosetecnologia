import { migrateStaging, openStagingDatabase } from './staging-db.mjs';
try {
  const db = openStagingDatabase(process.env.VNEXT_MIGRATION_DATABASE_URL);
  try {
    await migrateStaging(db);
    console.log('VNext staging migrations verified.');
  } finally {
    await db.close();
  }
} catch {
  console.error('VNext migrations failed. Check the dedicated staging database and migration history.');
  process.exitCode = 1;
}
