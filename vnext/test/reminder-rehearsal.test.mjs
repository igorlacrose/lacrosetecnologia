import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createPreviewDatabase, fixture, withIdentity } from '../preview-db.mjs';
import { createAppointmentWebhook } from '../appointment-reminders.mjs';
import { rehearseDueReminders } from '../reminder-rehearsal.mjs';
import { serveWorkspace } from '../workspace.mjs';

const sourceId=randomUUID(),sourceSecret=randomBytes(32).toString('hex');
const phone='+5573999900123';
const pepper=randomBytes(32).toString('hex');
const key=randomBytes(32).toString('hex');

async function makeBooking(db,{tenant=fixture.tenant,product='barbaros'}={}){
  const webhook=createAppointmentWebhook({
    db,sources:[{id:sourceId,tenant,product,secret:sourceSecret}],
    encryptionKey:key,hashPepper:pepper
  });
  const body={
    eventId:randomUUID(),type:'booked',appointmentId:'booking_'+randomUUID().slice(0,8),
    revision:1,startsAt:new Date(Date.now()+28*3600000).toISOString(),
    timezone:'America/Bahia',recipient:phone,
    consent:{granted:true,at:new Date(Date.now()-2000).toISOString(),
      source:'online_booking'}
  };
  const timestamp=String(Math.floor(Date.now()/1000));
  const raw=JSON.stringify(body);
  const signature=createHmac('sha256',sourceSecret)
    .update(timestamp+'.'+raw).digest('hex');
  const res=await webhook(new Request('https://fixture.example/integrations/appointments',{
    method:'POST',headers:{
      'content-type':'application/json','x-lkz-timestamp':timestamp,
      'x-lkz-source-id':sourceId,'x-lkz-signature':signature
    },body:raw
  }));
  assert.equal(res.status,200);
  return body;
}

async function summary(db,tenant,claims){
  const res=await serveWorkspace(
    new Request('https://fixture.example/api/whatsapp/reminders/rehearsal?tenant='+tenant),
    db,claims
  );
  return [res.status,await res.json()];
}

test('dry-run stores no message body, never sends or moves pending jobs to sent',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  await makeBooking(db);
  const now=Date.now()+6000;
  const first=await rehearseDueReminders(db,{tenant:fixture.tenant,clock:()=>now});
  assert.deepEqual(first,{
    dryRun:true,canDispatch:false,checked:1,decisions:{blocked_policy:1}
  });
  const again=await rehearseDueReminders(db,{tenant:fixture.tenant,clock:()=>now});
  assert.equal(again.checked,1);
  const {rows}=await db.query(
    'select decision,check_count from lkz_vnext.whatsapp_reminder_rehearsals'
  );
  assert.deepEqual(rows,[{decision:'blocked_policy',check_count:2}]);
  const {rows:statuses}=await db.query(
    "select status,count(*)::integer as n from lkz_vnext.whatsapp_reminder_jobs group by status"
  );
  assert.deepEqual(statuses,[{status:'pending',n:3}]);
  assert.equal((await rehearseDueReminders(db,{tenant:fixture.secondTenant,
    clock:()=>now})).checked,0);
  const asText=JSON.stringify(rows);
  assert.equal(asText.includes(phone),false);
});

test('expired due windows are marked expired and never reactivated',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  await makeBooking(db);
  const future=Date.now()+18*60000;
  const result=await rehearseDueReminders(db,{tenant:fixture.tenant,clock:()=>future});
  assert.equal(result.checked,1);
  assert.equal(result.decisions.expired,1);
  const again=await rehearseDueReminders(db,{tenant:fixture.tenant,clock:()=>future});
  assert.equal(again.checked,0);
  const {rows}=await db.query(
    "select status from lkz_vnext.whatsapp_reminder_jobs where kind='confirmation'"
  );
  assert.equal(rows[0].status,'expired');
});

test('theoretical future billing and policy gates still cannot dispatch messages',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  await makeBooking(db);
  await db.query(
    'insert into lkz_vnext.whatsapp_reminder_policies '+
    '(tenant_id,enabled,offsets_minutes,monthly_message_limit) '+
    'values($1,true,$2,10)',
    [fixture.tenant,[1440,120]]
  );
  await db.query(
    'insert into lkz_vnext.whatsapp_connections '+
    '(tenant_id,meta_waba_id,meta_phone_number_id,connection_state,'+
    'billing_state,billing_verified_at,billing_verified_by,token_ciphertext,token_nonce) '+
    "values($1,'123456789012','987654321012','ready','verified',now(),$2,$3,$4)",
    [fixture.tenant,fixture.admin,Buffer.from('ciphertext-staging'),
      randomBytes(12)]
  );
  const result=await rehearseDueReminders(db,{tenant:fixture.tenant,clock:()=>Date.now()+5000});
  assert.deepEqual(result.decisions,{dry_run_eligible:1});
  assert.equal(result.canDispatch,false);
  const {rows}=await db.query(
    "select status from lkz_vnext.whatsapp_reminder_jobs where kind='confirmation'"
  );
  assert.equal(rows[0].status,'pending');
});

test('stale appointment revision and revoked consent are cancelled without sending',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  await makeBooking(db);
  await db.query(
    'update lkz_vnext.whatsapp_appointments set revision=revision+1,'+
    'consent_given=false,consent_at=null,consent_source=null,'+
    'recipient_hash=null,recipient_ciphertext=null,recipient_nonce=null'
  );
  const result=await rehearseDueReminders(db,{tenant:fixture.tenant,clock:()=>Date.now()+5000});
  assert.equal(result.decisions.blocked_appointment,1);
  const {rows}=await db.query(
    "select status from lkz_vnext.whatsapp_reminder_jobs where kind='confirmation'"
  );
  assert.equal(rows[0].status,'cancelled');
});

test('aggregate diagnostics require MFA, tenant membership and never reveal appointment IDs',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  await makeBooking(db);
  await rehearseDueReminders(db,{tenant:fixture.tenant,clock:()=>Date.now()+5000});
  const a={sub:fixture.admin,aal:'aal2'};
  const [status,body]=await summary(db,fixture.tenant,a);
  assert.equal(status,200);
  assert.equal(Number(body.checks),1);
  assert.equal(Number(body.blocked),1);
  assert.equal(JSON.stringify(body).includes('booking_'),false);
  assert.equal((await summary(db,fixture.tenant,
    {sub:fixture.viewer,aal:'aal1'}))[0],403);
  assert.equal((await summary(db,fixture.tenant,
    {sub:fixture.secondAdmin,aal:'aal2'}))[0],403);
  assert.equal((await summary(db,fixture.secondTenant,
    {sub:fixture.secondAdmin,aal:'aal2'}))[0],200);
  await assert.rejects(withIdentity(db,a,tx=>tx.query(
    'select * from lkz_vnext.whatsapp_reminder_rehearsals'
  )),{code:'42501'});
});
