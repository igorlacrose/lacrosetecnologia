import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createPreviewDatabase, fixture, withIdentity } from '../preview-db.mjs';
import { createAppointmentWebhook } from '../appointment-reminders.mjs';
import { serveWorkspace } from '../workspace.mjs';

const admin={sub:fixture.admin,aal:'aal2'};
const adminB={sub:fixture.secondAdmin,aal:'aal2'};
const viewer={sub:fixture.viewer,aal:'aal2'};

async function call(db,method='GET',body,claims=admin,tenant=fixture.tenant){
  const response=await serveWorkspace(new Request(
    'https://fixture.example.test/api/whatsapp/reminders?tenant='+tenant,
    {method,headers:method==='POST'?{'content-type':'application/json'}:undefined,
      body:method==='POST'?JSON.stringify(body):undefined}
  ),db,claims);
  return [response.status,await response.json()];
}

test('tenant admin can preconfigure offsets and cap without enabling Meta dispatch',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  const [initialStatus,initial]=await call(db);
  assert.equal(initialStatus,200);
  assert.equal(initial.enabled,false);
  assert.deepEqual(initial.offsets_minutes,[1440,120]);
  assert.equal(initial.monthly_message_limit,0);
  const [status,updated]=await call(db,'POST',{
    offsets_minutes:[120],monthly_message_limit:125
  });
  assert.equal(status,200);
  assert.equal(updated.enabled,false);
  assert.equal(updated.canDispatch,false);
  assert.deepEqual(updated.offsets_minutes,[120]);
  assert.equal(updated.monthly_message_limit,125);
  const [,stored]=await call(db);
  assert.deepEqual(stored,{enabled:false,offsets_minutes:[120],monthly_message_limit:125});
  const {rows}=await db.query(
    "select operation from lkz_vnext.audit where entity='whatsapp_reminder_policies'"
  );
  assert.deepEqual(rows.map(row=>row.operation),['PREFERENCES_UPDATED']);
});

test('other tenant, viewer, expired MFA and unsafe payloads cannot change preferences',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  const valid={offsets_minutes:[1440,120],monthly_message_limit:25};
  assert.equal((await call(db,'POST',valid,viewer))[0],403);
  assert.equal((await call(db,'POST',valid,{...admin,aal:'aal1'}))[0],403);
  assert.equal((await call(db,'POST',valid,adminB,fixture.tenant))[0],403);
  assert.equal((await call(db,'POST',{...valid,enabled:true}))[0],400);
  assert.equal((await call(db,'POST',{...valid,monthly_message_limit:999999}))[0],400);
  assert.equal((await call(db,'POST',{...valid,offsets_minutes:[10]}))[0],400);
  assert.equal((await call(db,'POST',{...valid,offsets_minutes:[120,120]}))[0],400);
  assert.equal((await call(db,'POST',{...valid,offsets_minutes:[]}))[0],400);
  assert.equal((await call(db,'POST',{...valid,offsets_minutes:[120,1440]}))[0],200);
  assert.equal((await call(db,'POST',{...valid,monthly_message_limit:0}))[0],200);
  assert.equal((await call(db,'POST',valid,adminB,fixture.secondTenant))[0],200);
  await assert.rejects(
    withIdentity(db,admin,tx=>tx.query(
      "update lkz_vnext.whatsapp_reminder_policies set enabled=true where tenant_id=$1",
      [fixture.tenant]
    )),{code:'42501'}
  );
  const state=(await db.query(
    'select enabled from lkz_vnext.whatsapp_reminder_policies'
  )).rows;
  assert.ok(state.every(row=>row.enabled===false));
});

test('new appointments schedule only chosen offsets; dispatch stays closed',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  const [status]=await call(db,'POST',{
    offsets_minutes:[120],monthly_message_limit:42
  });
  assert.equal(status,200);
  const sourceId=randomUUID(),secret=randomBytes(32).toString('hex');
  const intake=createAppointmentWebhook({
    db,sources:[{id:sourceId,tenant:fixture.tenant,product:'barbaros',secret}],
    encryptionKey:randomBytes(32).toString('hex'),
    hashPepper:randomBytes(32).toString('hex')
  });
  const event={
    eventId:randomUUID(),type:'booked',appointmentId:'booking1234',
    revision:1,startsAt:new Date(Date.now()+30*3600000).toISOString(),
    timezone:'America/Bahia',recipient:'+5573999990000',
    consent:{granted:true,source:'online_booking',
      at:new Date(Date.now()-2000).toISOString()}
  };
  const timestamp=String(Math.floor(Date.now()/1000));
  const raw=JSON.stringify(event);
  const mac=createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex');
  const response=await intake(new Request('https://fixture.example.test/integrations/appointments',{
    method:'POST',headers:{'content-type':'application/json',
      'x-lkz-source-id':sourceId,'x-lkz-timestamp':timestamp,'x-lkz-signature':mac},
    body:raw
  }));
  assert.equal(response.status,200);
  assert.equal((await response.json()).scheduledJobs,2);
  const {rows}=await db.query('select kind from lkz_vnext.whatsapp_reminder_jobs order by kind');
  assert.deepEqual(rows.map(row=>row.kind),['confirmation','reminder_2h']);
  const {rows:policies}=await db.query(
    'select enabled from lkz_vnext.whatsapp_reminder_policies where tenant_id=$1',
    [fixture.tenant]
  );
  assert.equal(policies[0].enabled,false);
});
