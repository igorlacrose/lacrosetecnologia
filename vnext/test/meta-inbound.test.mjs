import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createPreviewDatabase, fixture } from '../preview-db.mjs';
import { createMetaInboundWebhook } from '../meta-inbound.mjs';
import { createMetaInboundServer } from '../meta-inbound-listener.mjs';
import { createAppointmentWebhook } from '../appointment-reminders.mjs';

const appSecret='test-only-internal-meta-secret-123456789';
const verifyToken='test-only-long-verify-token-for-meta';
const pepper=randomBytes(32).toString('hex');
const encryptionKey=randomBytes(32).toString('hex');
const waA='123456789012',phoneA='123456789099';
const waB='123456789013',phoneB='123456789088';
const recipient='5573999912345';
const sourceId=randomUUID(),sourceSecret=randomBytes(32).toString('hex');

const sign=(body,secret=appSecret)=>
  'sha256='+createHmac('sha256',secret).update(body).digest('hex');
function envelope(waba=waA,phone=phoneA,{messageId='wamid.HBgM12345',text='PARAR',from=recipient}={}){
  return {object:'whatsapp_business_account',entry:[{
    id:waba,changes:[{
      field:'messages',value:{
        messaging_product:'whatsapp',
        metadata:{phone_number_id:phone},
        messages:[{id:messageId,from,type:'text',text:{body:text}}]
      }
    }]
  }]};
}
function request(obj,{sig,method='POST',body,contentType='application/json'}={}){
  const payload=body??JSON.stringify(obj);
  return new Request('https://test.example/integrations/meta-whatsapp',{
    method,headers:{'content-type':contentType,
      'x-hub-signature-256':sig??sign(payload)},body:payload
  });
}
const call=async(handler,obj,options={})=>{
  const res=await handler(request(obj,options));
  return [res.status,await res.json()];
};
async function connect(db,tenant,waba,phone){
  await db.transaction(async tx=>{
    await tx.exec('set local role lkz_vnext_meta_bridge');
    await tx.query(
      'insert into lkz_vnext.whatsapp_connections '+
      '(tenant_id,meta_waba_id,meta_phone_number_id,token_ciphertext,token_nonce) '+
      'values($1,$2,$3,$4,$5)',
      [tenant,waba,phone,Buffer.from('encrypted-fixture'),randomBytes(12)]
    );
  });
}
function makeWebhook(db){
  return createMetaInboundWebhook({db,appSecret,verifyToken,hashPepper:pepper});
}
async function book(db,tenant,product='barbaros'){
  const handler=createAppointmentWebhook({
    db,sources:[{id:sourceId,tenant,product,secret:sourceSecret}],
    encryptionKey,hashPepper:pepper
  });
  const data={
    eventId:randomUUID(),type:'booked',appointmentId:'booking_'+randomUUID().slice(0,8),
    revision:1,startsAt:new Date(Date.now()+36*3600000).toISOString(),
    timezone:'America/Bahia',recipient:'+'+recipient,
    consent:{granted:true,source:'online_booking',
      at:new Date(Date.now()-5000).toISOString()}
  };
  const timestamp=String(Math.floor(Date.now()/1000));
  const json=JSON.stringify(data);
  const signature=createHmac('sha256',sourceSecret).update(timestamp+'.'+json).digest('hex');
  const res=await handler(new Request('https://test.example/integrations/appointments',{
    method:'POST',headers:{
      'content-type':'application/json',
      'x-lkz-source-id':sourceId,
      'x-lkz-timestamp':timestamp,
      'x-lkz-signature':signature
    },body:json
  }));
  assert.equal(res.status,200);
  return data;
}

test('GET challenge requires exact private verification token; no secrets echoed',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  const handler=makeWebhook(db);
  const url='https://test.example/integrations/meta-whatsapp?hub.mode=subscribe'+
    '&hub.verify_token='+verifyToken+'&hub.challenge=424242';
  const response=await handler(new Request(url));
  assert.equal(response.status,200);
  assert.equal(await response.text(),'424242');
  assert.equal((await handler(new Request(url.replace(verifyToken,'invalid-token')))).status,403);
  assert.equal((await handler(new Request(url.replace('424242','not-a-challenge')))).status,403);
  assert.equal((await handler(new Request(url.replace('subscribe','unsubscribe')))).status,403);
});

test('verified STOP cancels all tenant jobs and erases stored recipient; replay is idempotent',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  await connect(db,fixture.tenant,waA,phoneA);
  await connect(db,fixture.secondTenant,waB,phoneB);
  await book(db,fixture.tenant,'barbaros');
  await book(db,fixture.secondTenant,'barbaros');
  assert.equal((await db.query(
    "select count(*)::integer n from lkz_vnext.whatsapp_reminder_jobs where status='pending'"
  )).rows[0].n,6);
  const handler=makeWebhook(db);
  const obj=envelope();
  assert.deepEqual(await call(handler,obj),[200,{ok:true,processed:1}]);
  const [status,replay]=await call(handler,obj);
  assert.equal(status,200);assert.equal(replay.processed,0);
  const stopped=await db.query(
    'select tenant_id,consent_given,recipient_ciphertext from lkz_vnext.whatsapp_appointments order by tenant_id'
  );
  const rowA=stopped.rows.find(x=>x.tenant_id===fixture.tenant);
  const rowB=stopped.rows.find(x=>x.tenant_id===fixture.secondTenant);
  assert.equal(rowA.consent_given,false);
  assert.equal(rowA.recipient_ciphertext,null);
  assert.equal(rowB.consent_given,true);
  assert.notEqual(rowB.recipient_ciphertext,null);
  const counts=await db.query(
    "select tenant_id,count(*)::integer n from lkz_vnext.whatsapp_reminder_jobs "+
    "where status='pending' group by tenant_id"
  );
  assert.deepEqual(counts.rows,[{tenant_id:fixture.secondTenant,n:3}]);
  const ledger=await db.query('select meta_message_id,recipient_hash from lkz_vnext.whatsapp_meta_optout_events');
  assert.equal(ledger.rows.length,1);
  assert.equal(ledger.rows[0].meta_message_id,'wamid.HBgM12345');
  assert.match(ledger.rows[0].recipient_hash,/^[0-9a-f]{64}$/);
  assert.equal((await db.query('select count(*)::integer n from lkz_vnext.whatsapp_opt_outs')).rows[0].n,1);
});

test('invalid or missing signatures and unknown WABAs never change consent',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  await connect(db,fixture.tenant,waA,phoneA);
  await book(db,fixture.tenant);
  const handler=makeWebhook(db);
  const obj=envelope();
  assert.equal((await call(handler,obj,{sig:'sha256='+'0'.repeat(64)}))[0],401);
  assert.equal((await call(handler,obj,{sig:''}))[0],401);
  assert.equal((await call(handler,obj,{sig:sign(JSON.stringify(obj),'different-secret')}))[0],401);
  assert.equal((await call(handler,envelope('888888888888',phoneA)))[1].processed,0);
  assert.equal((await call(handler,envelope(waA,'888888888888')))[1].processed,0);
  const unsupported=envelope(waA,phoneA,{text:'Cancelar meu horário'});
  assert.equal((await call(handler,unsupported))[1].processed,0);
  assert.equal((await db.query(
    "select count(*)::integer n from lkz_vnext.whatsapp_reminder_jobs where status='pending'"
  )).rows[0].n,3);
  assert.equal((await db.query('select count(*)::integer n from lkz_vnext.whatsapp_opt_outs')).rows[0].n,0);
  const valid=envelope(waA,phoneA,{text:'Não quero mais mensagens!'});
  assert.equal((await call(handler,valid))[1].processed,1);
});

test('signed Meta webhook cannot be used to activate WhatsApp billing or sending',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  await connect(db,fixture.tenant,waA,phoneA);
  const handler=makeWebhook(db);
  assert.equal((await call(handler,envelope(waA,phoneA,{text:'ATIVAR'})))[1].processed,0);
  const connections=await db.query(
    'select billing_state,connection_state from lkz_vnext.whatsapp_connections'
  );
  assert.deepEqual(connections.rows,[{billing_state:'unverified',connection_state:'awaiting_billing'}]);
  const roles=await db.query(
    "select relname from pg_class where relname='whatsapp_meta_optout_events'"
  );
  assert.equal(roles.rows.length,1);
});

test('dedicated loopback listener exposes only the signed Meta webhook',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  await connect(db,fixture.tenant,waA,phoneA);
  const server=createMetaInboundServer(makeWebhook(db));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  const get=await fetch(origin+'/integrations/meta-whatsapp?hub.mode=subscribe'+
    '&hub.verify_token='+verifyToken+'&hub.challenge=777');
  assert.equal(get.status,200);
  assert.equal(await get.text(),'777');
  assert.equal((await fetch(origin+'/api/tenants')).status,404);
  assert.equal((await fetch(origin+'/admin/')).status,404);
  assert.equal((await fetch(origin+'/integrations/meta-whatsapp',{method:'POST',
    headers:{'content-type':'application/json'},body:JSON.stringify(envelope())})).status,401);
  const body=JSON.stringify(envelope());
  const result=await fetch(origin+'/integrations/meta-whatsapp',{
    method:'POST',headers:{
      'content-type':'application/json','x-hub-signature-256':sign(body)
    },body
  });
  assert.equal(result.status,200);
  assert.equal((await result.json()).processed,1);
});
