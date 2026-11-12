import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createPreviewDatabase, fixture, withIdentity } from '../preview-db.mjs';
import { createAppointmentWebhook } from '../appointment-reminders.mjs';
import { simulateReminderDispatch } from '../simulated-dispatch.mjs';
import { serveWorkspace } from '../workspace.mjs';

const encryptionKey=randomBytes(32).toString('hex');
const hashPepper=randomBytes(32).toString('hex');
const fakePhone='+5573999900000';

async function addBooking(db,{tenant=fixture.tenant,product='barbaros'}={}){
  const sourceId=randomUUID(),secret=randomBytes(32).toString('hex');
  const webhook=createAppointmentWebhook({
    db,encryptionKey,hashPepper,
    sources:[{id:sourceId,tenant,product,secret}],
  });
  const event={
    eventId:randomUUID(),type:'booked',
    appointmentId:'appt_'+randomUUID().replaceAll('-','').slice(0,20),
    revision:1,startsAt:new Date(Date.now()+48*3600000).toISOString(),
    timezone:'America/Bahia',recipient:fakePhone,
    consent:{granted:true,at:new Date(Date.now()-2000).toISOString(),
      source:'online_booking'},
  };
  const timestamp=String(Math.floor(Date.now()/1000));
  const raw=JSON.stringify(event);
  const sig=createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex');
  const response=await webhook(new Request('https://staging.example/integrations/appointments',{
    method:'POST',headers:{'content-type':'application/json','x-lkz-source-id':sourceId,
      'x-lkz-timestamp':timestamp,'x-lkz-signature':sig},
    body:raw,
  }));
  assert.equal(response.status,200);
  return event;
}

async function syntheticReady(db,{tenant=fixture.tenant,cap=2,waba='123456789010',phone='123456789020'}={}){
  // Fixture-only superuser setup. The customer UI cannot enable this.
  await db.query(
    'insert into lkz_vnext.whatsapp_reminder_policies '+
    '(tenant_id,enabled,offsets_minutes,monthly_message_limit) '+
    'values($1,true,$2,$3)',
    [tenant,[1440,120],cap]
  );
  await db.query(
    'insert into lkz_vnext.whatsapp_connections '+
    '(tenant_id,meta_waba_id,meta_phone_number_id,connection_state,'+
    'billing_state,billing_verified_at,billing_verified_by,token_ciphertext,token_nonce) '+
    "values($1,$2,$3,'ready','verified',now(),$4,$5,$6)",
    [tenant,waba,phone,fixture.admin,Buffer.from('encrypted-synthetic-token'),
      randomBytes(12)]
  );
}
async function usage(db,tenant=fixture.tenant){
  const {rows}=await db.query(
    'select simulated_count from lkz_vnext.whatsapp_simulated_monthly_usage '+
    'where tenant_id=$1',[tenant]);
  return rows.length?rows[0].simulated_count:0;
}
async function summaries(db,tenant,claims){
  const response=await serveWorkspace(new Request(
    'https://staging.example/api/whatsapp/reminders/simulated?tenant='+tenant
  ),db,claims);
  return [response.status,await response.json()];
}
const later=()=>Date.now()+5000;

test('fails closed by default, without Meta credentials or spending',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  await addBooking(db);
  const result=await simulateReminderDispatch(db,{tenant:fixture.tenant,clock:later});
  assert.deepEqual(result,{
    mode:'simulation_only',dryRun:true,canDispatch:false,
    checked:0,simulated:0,quotaBlocked:0,
    utcMonth:new Date().toISOString().slice(0,7)+'-01',
  });
  assert.equal(await usage(db),0);
  const {rows:jobs}=await db.query(
    "select status from lkz_vnext.whatsapp_reminder_jobs");
  assert.ok(jobs.every(job=>job.status==='pending'));
});

test('simulates at most the monthly cap atomically, never moves a job to sent',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  await addBooking(db);
  await addBooking(db);
  await syntheticReady(db,{cap:1});
  const first=await simulateReminderDispatch(db,{tenant:fixture.tenant,clock:later});
  assert.equal(first.checked,2);
  assert.equal(first.simulated,1);
  assert.equal(first.quotaBlocked,1);
  assert.equal(first.canDispatch,false);
  assert.equal(await usage(db),1);
  const second=await simulateReminderDispatch(db,{tenant:fixture.tenant,clock:later});
  assert.equal(second.simulated,0);
  assert.equal(second.quotaBlocked,1);
  assert.equal(await usage(db),1);
  const {rows:statuses}=await db.query(
    "select status,count(*)::integer n from lkz_vnext.whatsapp_reminder_jobs "+
    'group by status order by status');
  assert.deepEqual(statuses,[
    {status:'pending',n:5},{status:'simulated',n:1}
  ]);
  const {rows:ledger}=await db.query(
    'select count(*)::integer n from lkz_vnext.whatsapp_simulated_dispatches');
  assert.equal(ledger[0].n,1);
  await db.query(
    'update lkz_vnext.whatsapp_reminder_policies '+
    'set monthly_message_limit=2 where tenant_id=$1',[fixture.tenant]);
  const third=await simulateReminderDispatch(db,{tenant:fixture.tenant,clock:later});
  assert.equal(third.simulated,1);
  assert.equal(await usage(db),2);
  assert.equal((await simulateReminderDispatch(db,{
    tenant:fixture.tenant,clock:later
  })).simulated,0);
  const {rows:finalLedger}=await db.query(
    'select count(*)::integer n from lkz_vnext.whatsapp_simulated_dispatches');
  assert.equal(finalLedger[0].n,2);
});

test('parallel simulations cannot exceed quota or duplicate the synthetic ledger',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  await addBooking(db);
  await addBooking(db);
  await syntheticReady(db,{cap:1});
  const results=await Promise.all([
    simulateReminderDispatch(db,{tenant:fixture.tenant,clock:later}),
    simulateReminderDispatch(db,{tenant:fixture.tenant,clock:later}),
  ]);
  assert.equal(results.reduce((sum,x)=>sum+x.simulated,0),1);
  assert.equal(await usage(db),1);
  const {rows}=await db.query(
    'select count(*)::integer n from lkz_vnext.whatsapp_simulated_dispatches');
  assert.equal(rows[0].n,1);
});

test('each tenant has isolated synthetic monthly quota, never any Meta charge',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  await addBooking(db,{tenant:fixture.tenant});
  await addBooking(db,{tenant:fixture.secondTenant});
  await syntheticReady(db,{tenant:fixture.tenant,cap:1});
  await syntheticReady(db,{
    tenant:fixture.secondTenant,cap:1,
    waba:'123456789011',phone:'123456789021',
  });
  assert.equal((await simulateReminderDispatch(db,{tenant:fixture.tenant,clock:later})).simulated,1);
  assert.equal((await simulateReminderDispatch(db,{tenant:fixture.secondTenant,clock:later})).simulated,1);
  assert.equal(await usage(db,fixture.tenant),1);
  assert.equal(await usage(db,fixture.secondTenant),1);
});

test('failure between quota reservation and ledger insert rolls back EVERYTHING',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  await addBooking(db);
  await syntheticReady(db,{cap:1});
  const faulted={
    transaction:operation=>db.transaction(tx=>operation({
      exec:sql=>tx.exec(sql),
      query:(sql,args)=>{
        if(sql.startsWith('insert into lkz_vnext.whatsapp_simulated_dispatches'))
          throw new Error('Injected ledger failure');
        return tx.query(sql,args);
      },
    })),
  };
  await assert.rejects(
    simulateReminderDispatch(faulted,{tenant:fixture.tenant,clock:later}),
    /Injected ledger failure/
  );
  assert.equal(await usage(db),0);
  assert.equal((await db.query(
    "select count(*)::integer n from lkz_vnext.whatsapp_reminder_jobs "+
    "where status='simulated'")).rows[0].n,0);
  assert.equal((await db.query(
    'select count(*)::integer n from lkz_vnext.whatsapp_simulated_dispatches'
  )).rows[0].n,0);
});

test('MFA and tenant isolation protect aggregate report and raw synthetic ledger',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  await addBooking(db);
  await syntheticReady(db,{cap:1});
  await simulateReminderDispatch(db,{tenant:fixture.tenant,clock:later});
  const claims={sub:fixture.admin,aal:'aal2'};
  const [status,summary]=await summaries(db,fixture.tenant,claims);
  assert.equal(status,200);
  assert.equal(summary.canDispatch,false);
  assert.equal(Number(summary.simulated_jobs),1);
  assert.equal(Number(summary.simulated_this_month),1);
  assert.equal((await summaries(db,fixture.tenant,{
    sub:fixture.viewer,aal:'aal1'
  }))[0],403);
  assert.equal((await summaries(db,fixture.tenant,{
    sub:fixture.secondAdmin,aal:'aal2'
  }))[0],403);
  const [otherStatus,otherSummary]=await summaries(db,fixture.secondTenant,{
    sub:fixture.secondAdmin,aal:'aal2'
  });
  assert.equal(otherStatus,200);
  assert.equal(Number(otherSummary.simulated_jobs),0);
  await assert.rejects(
    withIdentity(db,claims,tx=>tx.query(
      'select * from lkz_vnext.whatsapp_simulated_dispatches'
    )),{code:'42501'}
  );
});
