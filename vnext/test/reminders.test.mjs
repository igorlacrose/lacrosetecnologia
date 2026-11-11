import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createPreviewDatabase, fixture, withIdentity } from '../preview-db.mjs';
import { createPreviewServer } from '../preview.mjs';
import { createAppointmentWebhook, inspectDueReminders } from '../appointment-reminders.mjs';
import { createAppointmentSender } from '../appointment-sender.mjs';
import { serveWorkspace } from '../workspace.mjs';

const secretA=randomBytes(32).toString('hex');
const secretB=randomBytes(32).toString('hex');
const sourceA=randomUUID(),sourceB=randomUUID(),sourceC=randomUUID();
const phone='+5573999990000';
const hashPepper=randomBytes(32).toString('hex');
const encryptionKey=randomBytes(32).toString('hex');
const now=()=>Date.now();
const inHours=hours=>new Date(now()+hours*3600000).toISOString();
const event=(type,revision,extra={})=>({
  eventId:randomUUID(),type,appointmentId:'agenda_123',
  revision,...extra,
});
const booking=(revision=1,startsAt=inHours(30),extra={})=>event('booked',revision,{
  startsAt,timezone:'America/Bahia',recipient:phone,
  consent:{granted:true,at:new Date(now()-1000).toISOString(),source:'online_booking'},
  ...extra,
});
const sources=[
  {id:sourceA,tenant:fixture.tenant,product:'barbaros',secret:secretA},
  {id:sourceB,tenant:fixture.tenant,product:'libertyos',secret:secretB},
  {id:sourceC,tenant:fixture.secondTenant,product:'barbaros',secret:secretB+'!'},
];

function setup(db){
  const handler=createAppointmentWebhook({db,sources,encryptionKey,hashPepper,clock:now});
  async function send(source,body,stamp=Math.floor(now()/1000)){
    const { createHmac }=await import('node:crypto');
    const raw=JSON.stringify(body);
    const signature=createHmac('sha256',source.secret)
      .update(String(stamp)+'.'+raw).digest('hex');
    const response=await handler(new Request('https://vnext.example.test/integrations/appointments',{
      method:'POST',headers:{
        'content-type':'application/json',
        'x-lkz-source-id':source.id,
        'x-lkz-timestamp':String(stamp),
        'x-lkz-signature':signature,
      },body:raw
    }));
    return [response.status,await response.json()];
  }
  return {handler,send};
}
const count=async(db,table,filter='')=>{
  const {rows:[row]}=await db.query('select count(*)::integer as n from lkz_vnext.'+table+' '+filter);
  return row.n;
};

test('booking creates confirmation, 24h and 2h jobs without Meta spend',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  const {send}=setup(db);
  const eventA=booking();
  assert.deepEqual(await send(sources[0],eventA),[200,{ok:true,code:'scheduled',scheduledJobs:3}]);
  assert.equal(await count(db,'whatsapp_appointments'),1);
  assert.equal(await count(db,'whatsapp_reminder_jobs'),3);
  const jobs=await db.query('select kind,status from lkz_vnext.whatsapp_reminder_jobs order by kind');
  assert.deepEqual(jobs.rows.map(x=>x.kind),['confirmation','reminder_24h','reminder_2h']);
  assert.ok(jobs.rows.every(x=>x.status==='pending'));
  const stored=(await db.query('select recipient_ciphertext,recipient_nonce,consent_source from lkz_vnext.whatsapp_appointments')).rows[0];
  assert.notEqual(stored.recipient_ciphertext.toString(),phone);
  assert.equal(stored.recipient_nonce.byteLength,12);
  assert.equal(stored.consent_source,'online_booking');
  const inspected=await inspectDueReminders(db,{tenant:fixture.tenant,clock:now});
  assert.deepEqual(inspected,{dryRun:true,canDispatch:false,due:[]});
});

test('duplicate event, changed replay, stale revisions, reschedule and cancel',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  const {send}=setup(db);
  const first=booking();
  assert.equal((await send(sources[0],first))[1].code,'scheduled');
  assert.equal((await send(sources[0],first))[1].code,'duplicate');
  assert.equal((await send(sources[0],{...first,startsAt:inHours(40)}))[0],409);
  assert.equal(await count(db,'whatsapp_reminder_jobs'),3);
  const updated=event('rescheduled',2,{
    startsAt:inHours(50),timezone:'America/Bahia',recipient:phone,
    consent:{granted:true,at:new Date(now()-1000).toISOString(),source:'online_booking'}
  });
  assert.equal((await send(sources[0],updated))[1].code,'scheduled');
  assert.equal((await db.query("select count(*)::integer as n from lkz_vnext.whatsapp_reminder_jobs where status='cancelled'")).rows[0].n,3);
  assert.equal((await send(sources[0],event('booked',1,{
    startsAt:inHours(40),timezone:'America/Bahia',recipient:phone,
    consent:{granted:true,at:new Date(now()-1000).toISOString(),source:'online_booking'}
  })))[0],409);
  assert.equal((await send(sources[0],event('cancelled',3)))[1].code,'cancelled');
  assert.equal((await db.query("select count(*)::integer as n from lkz_vnext.whatsapp_reminder_jobs where status='pending'")).rows[0].n,0);
  assert.equal((await db.query("select state from lkz_vnext.whatsapp_appointments")).rows[0].state,'cancelled');
  assert.equal((await send(sources[0],event('booked',2,{
    startsAt:inHours(40),timezone:'America/Bahia',recipient:phone,
    consent:{granted:true,at:new Date(now()-1000).toISOString(),source:'online_booking'}
  })))[0],409);
});

test('opt-out blocks both SaaS products inside one tenant, never another tenant',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  const {send}=setup(db);
  const a=booking(),b={...booking(),appointmentId:'liberty_234'},c={...booking(),appointmentId:'other_345'};
  assert.equal((await send(sources[0],a))[1].code,'scheduled');
  assert.equal((await send(sources[1],b))[1].code,'scheduled');
  assert.equal((await send(sources[2],c))[1].code,'scheduled');
  const opted=event('opted_out',1,{recipient:phone,source:'booking_platform'});
  assert.equal((await send(sources[0],opted))[1].code,'opt_out_applied');
  const status=await db.query("select tenant_id,consent_given from lkz_vnext.whatsapp_appointments order by tenant_id,product");
  assert.equal(status.rows.filter(x=>x.tenant_id===fixture.tenant&&x.consent_given).length,0);
  assert.equal(status.rows.filter(x=>x.tenant_id===fixture.secondTenant&&x.consent_given).length,1);
  assert.equal((await db.query("select count(*)::integer as n from lkz_vnext.whatsapp_reminder_jobs where tenant_id=$1 and status='pending'",
    [fixture.tenant])).rows[0].n,0);
  assert.equal((await send(sources[0],{...booking(2),appointmentId:'agenda_123'}))[1].code,'no_consent');
  assert.equal(await count(db,'whatsapp_opt_outs'),1);
});

test('no consent, incorrect HMAC, unknown source and old timestamp do not queue',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  const {handler,send}=setup(db);
  const noConsent=booking(1,inHours(35),{
    consent:{granted:false},recipient:undefined
  });
  assert.equal((await send(sources[0],noConsent))[1].code,'no_consent');
  assert.equal(await count(db,'whatsapp_reminder_jobs'),0);
  const invalid=await handler(new Request('https://test.example/integrations/appointments',{
    method:'POST',headers:{'content-type':'application/json','x-lkz-source-id':sourceA,
      'x-lkz-timestamp':String(Math.floor(now()/1000)),'x-lkz-signature':'0'.repeat(64)},
    body:JSON.stringify(booking())
  }));
  assert.equal(invalid.status,401);
  assert.equal((await send({...sources[0],id:randomUUID()},booking()))[0],401);
  assert.equal((await send(sources[0],booking(),Math.floor(now()/1000)-3600))[0],401);
  assert.equal(await count(db,'whatsapp_reminder_jobs'),0);
  assert.equal((await send(sources[0],booking(1,inHours(30),{
    consent:{granted:true,source:'staff_recorded',at:null}
  })))[0],400);
});

test('direct tables deny authenticated users; aggregate summary requires AAL2 tenant membership',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  const {send}=setup(db);
  assert.equal((await send(sources[0],booking()))[0],200);
  const admin={sub:fixture.admin,aal:'aal2'};
  await assert.rejects(
    withIdentity(db,admin,tx=>tx.query('select * from lkz_vnext.whatsapp_appointments')),
    {code:'42501'}
  );
  const call=async(claims,tenant)=>{
    const req=new Request('https://example.test/api/whatsapp/reminders/summary?tenant='+tenant);
    const res=await serveWorkspace(req,db,claims);
    return [res.status,await res.json()];
  };
  const [status,summary]=await call(admin,fixture.tenant);
  assert.equal(status,200);
  assert.equal(Number(summary.appointments),1);
  assert.equal(Number(summary.pending),3);
  assert.equal((await call({sub:fixture.viewer,aal:'aal1'},fixture.tenant))[0],403);
  assert.equal((await call({sub:fixture.secondAdmin,aal:'aal2'},fixture.tenant))[0],403);
  assert.equal(Number((await call({sub:fixture.secondAdmin,aal:'aal2'},fixture.secondTenant))[1].appointments),0);
});

test('signed sender reaches the local staging route without exposed data',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  const {handler}=setup(db);
  const server=createPreviewServer(db,{appointmentWebhook:handler});
  t.after(async()=>new Promise(resolve=>server.close(resolve)));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  const sender=createAppointmentSender({
    endpoint:'https://staging.example.test/integrations/appointments',
    sourceId:sourceA,secret:secretA,
    request:(url,options)=>fetch(origin+new URL(url).pathname,options)
  });
  const result=await sender(booking());
  assert.equal(result.status,200);
  assert.equal(result.code,'scheduled');
  assert.equal(result.scheduledJobs,3);
  assert.equal(await count(db,'whatsapp_reminder_jobs'),3);
  assert.throws(()=>createAppointmentSender({
    endpoint:'http://untrusted.example.test/integrations/appointments',
    sourceId:sourceA,secret:secretA
  }),/Secure endpoint/);
});


test('rate limit blocks booking floods but never blocks valid consent withdrawal',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  const {send}=setup(db);
  const placeholders=[],args=[];
  for(let i=0;i<60;i++){
    const n=args.length;
    placeholders.push('($'+(n+1)+',$'+(n+2)+',$'+(n+3)+',$'+(n+4)+',$'+(n+5)+')');
    args.push(fixture.tenant,'barbaros',randomUUID(),'f'.repeat(64),'booked');
  }
  await db.query(
    'insert into lkz_vnext.whatsapp_appointment_events '+
    '(tenant_id,product,event_id,event_digest,event_type) values '+
    placeholders.join(','),args
  );
  const [limited,blocked]=await send(sources[0],booking());
  assert.equal(limited,429);
  assert.equal(blocked.code,'rate_limited');
  const [allowed,withdrawn]=await send(sources[0],{
    eventId:randomUUID(),type:'opted_out',recipient:phone,source:'booking_platform'
  });
  assert.equal(allowed,200);
  assert.equal(withdrawn.code,'opt_out_applied');
  assert.equal(await count(db,'whatsapp_opt_outs'),1);
});
