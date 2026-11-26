import { openStagingDatabase, assertReminderRole } from './staging-db.mjs';
import { rehearseDueReminders } from './reminder-rehearsal.mjs';

// Explicit isolated-stage CLI. This does not send Meta messages.
// It MAY expire stale pending jobs and records tenant-safe diagnostics.
export async function runReminderRehearsal({argv=process.argv.slice(2),env=process.env}={}){
  if(argv.length!==2||argv[0]!=='--dry-run'||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(argv[1]))
    throw new TypeError('Usage: node rehearse-reminders.mjs --dry-run <tenant-uuid>');
  const db=openStagingDatabase(env.VNEXT_REMINDER_DATABASE_URL);
  try{
    await assertReminderRole(db);
    return await rehearseDueReminders(db,{tenant:argv[1]});
  }finally{await db.close()}
}
if(process.argv[1]&&import.meta.filename===process.argv[1]){
  try{
    const result=await runReminderRehearsal();
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{
    // No connection strings, secrets, schema names or tenant data in logs.
    process.stderr.write('Reminder staging rehearsal unavailable.\n');
    process.exitCode=1;
  }
}
