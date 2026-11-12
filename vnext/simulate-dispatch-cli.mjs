import { openStagingDatabase, assertReminderRole } from './staging-db.mjs';
import { simulateReminderDispatch } from './simulated-dispatch.mjs';

// Manual, explicitly gated simulation against a dedicated VNext stage.
// Never starts a scheduler, sends a WhatsApp or accesses Meta credentials.
export async function runSimulatedDispatch({
  argv=process.argv.slice(2),env=process.env,
}={}){
  if(argv.length!==2||argv[0]!=='--simulation-only'||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(argv[1]))
    throw new TypeError('Usage: node simulate-dispatch-cli.mjs --simulation-only <tenant-uuid>');
  const db=openStagingDatabase(env.VNEXT_REMINDER_DATABASE_URL);
  try{
    await assertReminderRole(db);
    return await simulateReminderDispatch(db,{tenant:argv[1]});
  }finally{await db.close()}
}
if(process.argv[1]&&import.meta.filename===process.argv[1]){
  try{
    const result=await runSimulatedDispatch();
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{
    process.stderr.write('Isolated dispatch simulation unavailable.\n');
    process.exitCode=1;
  }
}
