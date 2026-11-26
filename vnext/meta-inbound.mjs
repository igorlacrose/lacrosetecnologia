import { createHmac, timingSafeEqual } from 'node:crypto';

// WhatsApp Cloud API inbound webhook. Security boundary: only verified Meta
// signatures may revoke reminder consent, never permit sending or billing.
const id=/^[0-9]{5,30}$/;
const metaMessage=/^[A-Za-z0-9._:=/-]{1,255}$/;
const msisdn=/^[1-9][0-9]{7,14}$/;
const stopWords=new Set([
  'PARAR','SAIR','STOP','UNSUBSCRIBE','CANCELAR NOTIFICACOES',
  'NAO RECEBER MENSAGENS','NAO QUERO MAIS MENSAGENS'
]);

function fixedEqual(received,expected){
  if(typeof received!=='string'||received.length!==expected.length)return false;
  return timingSafeEqual(Buffer.from(received),Buffer.from(expected));
}
function normalizedCommand(message){
  if(typeof message!=='string'||message.length>90)return '';
  return message.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .trim().replace(/[.!?]+$/,'').replace(/\s+/g,' ').toUpperCase();
}
function errorResponse(status,code){
  return Response.json({ok:false,code},{
    status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}
  });
}
async function readBytes(request,limit){
  if(!request.body)throw new TypeError('missing_body');
  const reader=request.body.getReader();
  const chunks=[];let length=0;
  while(true){
    const {value,done}=await reader.read();
    if(done)break;
    length+=value.byteLength;
    if(length>limit){
      await reader.cancel();
      throw new RangeError('body_limit');
    }
    chunks.push(value);
  }
  const data=Buffer.alloc(length);let offset=0;
  for(const part of chunks){data.set(part,offset);offset+=part.byteLength;}
  return data;
}
function parseEvents(json){
  if(json?.object!=='whatsapp_business_account'||!Array.isArray(json.entry)||
    json.entry.length>20)throw new TypeError('invalid_envelope');
  const events=[];
  for(const entry of json.entry){
    if(!id.test(String(entry.id??''))||!Array.isArray(entry.changes)||
       entry.changes.length>20)continue;
    for(const change of entry.changes){
      if(change?.field!=='messages')continue;
      const value=change.value;
      const phoneId=String(value?.metadata?.phone_number_id??'');
      if(!id.test(phoneId)||!Array.isArray(value.messages)||
         value.messages.length>50)continue;
      for(const message of value.messages){
        if(message?.type!=='text'||!stopWords.has(normalizedCommand(message.text?.body)))
          continue;
        if(!metaMessage.test(message.id??'')||!msisdn.test(message.from??''))
          continue;
        events.push({wabaId:String(entry.id),phoneId,messageId:message.id,
          recipient:'+'+message.from});
        if(events.length>50)throw new TypeError('batch_too_large');
      }
    }
  }
  return events;
}
function hashRecipient(pepper,tenant,phone){
  return createHmac('sha256',pepper).update(tenant+':'+phone).digest('hex');
}
export function createMetaInboundWebhook({db,appSecret,verifyToken,hashPepper}={}){
  if(typeof db?.transaction!=='function'||typeof appSecret!=='string'||appSecret.length<24||
     typeof verifyToken!=='string'||verifyToken.length<24||
     typeof hashPepper!=='string'||hashPepper.length<32)
    throw new TypeError('Protected Meta webhook configuration required');
  return async request=>{
    if(request.method==='GET'){
      const params=new URL(request.url).searchParams;
      if(params.get('hub.mode')!=='subscribe'||
         !fixedEqual(params.get('hub.verify_token'),verifyToken)){
        return new Response('',{status:403});
      }
      const challenge=params.get('hub.challenge');
      if(!/^[0-9]{1,50}$/.test(challenge??''))return new Response('',{status:403});
      return new Response(challenge,{
        status:200,headers:{'content-type':'text/plain; charset=utf-8',
          'cache-control':'no-store'}
      });
    }
    if(request.method!=='POST')return errorResponse(405,'method_not_allowed');
    if(!(request.headers.get('content-type')??'').toLowerCase().startsWith('application/json'))
      return errorResponse(415,'content_type');
    const claimed=request.headers.get('x-hub-signature-256')??'';
    if(!/^sha256=[a-f0-9]{64}$/i.test(claimed))
      return errorResponse(401,'signature_invalid');
    let bytes,events;
    try{
      bytes=await readBytes(request,65536);
      const mac='sha256='+createHmac('sha256',appSecret).update(bytes).digest('hex');
      if(!fixedEqual(mac,claimed.toLowerCase()))
        return errorResponse(401,'signature_invalid');
      events=parseEvents(JSON.parse(bytes.toString('utf8')));
    }catch(err){
      return errorResponse(err instanceof RangeError?413:400,'invalid_payload');
    }
    if(!events.length)
      return Response.json({ok:true,processed:0},{headers:{'cache-control':'no-store'}});
    try{
      const processed=await db.transaction(async tx=>{
        await tx.exec('set local role lkz_vnext_reminder_bridge');
        let changed=0;
        for(const event of events){
          // WABA + number are verified against the tenant connection; never
          // accept a tenant ID from the webhook payload.
          const {rows:connections}=await tx.query(
            'select tenant_id from lkz_vnext.whatsapp_connections '+
            'where meta_waba_id=$1 and meta_phone_number_id=$2',
            [event.wabaId,event.phoneId]
          );
          if(connections.length!==1)continue;
          const tenant=connections[0].tenant_id;
          const hashed=hashRecipient(hashPepper,tenant,event.recipient);
          // Serializes with appointment event intake and manual opt-out.
          await tx.query('select pg_advisory_xact_lock(hashtextextended($1,0))',
            [tenant+':recipient:'+hashed]);
          const {rows:inserted}=await tx.query(
            'insert into lkz_vnext.whatsapp_meta_optout_events '+
            '(tenant_id,meta_message_id,meta_phone_number_id,recipient_hash) '+
            'values ($1,$2,$3,$4) on conflict do nothing returning meta_message_id',
            [tenant,event.messageId,event.phoneId,hashed]
          );
          if(!inserted.length)continue;
          await tx.query(
            'insert into lkz_vnext.whatsapp_opt_outs(tenant_id,recipient_hash,source) '+
            "values ($1,$2,'whatsapp_reply') on conflict do nothing",
            [tenant,hashed]
          );
          await tx.query(
            "update lkz_vnext.whatsapp_reminder_jobs set status='cancelled',updated_at=now() "+
            "where tenant_id=$1 and status='pending' and (tenant_id,product,appointment_key) in "+
            "(select tenant_id,product,appointment_key from lkz_vnext.whatsapp_appointments "+
            "where tenant_id=$1 and recipient_hash=$2)",
            [tenant,hashed]
          );
          await tx.query(
            'update lkz_vnext.whatsapp_appointments set consent_given=false,'+
            'consent_at=null,consent_source=null,recipient_hash=null,'+
            'recipient_ciphertext=null,recipient_nonce=null,updated_at=now() '+
            'where tenant_id=$1 and recipient_hash=$2',
            [tenant,hashed]
          );
          changed++;
        }
        return changed;
      });
      return Response.json({ok:true,processed},{
        headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}
      });
    }catch{
      // Meta will retry. No raw message or phone ever reaches application logs.
      return errorResponse(503,'storage_unavailable');
    }
  };
}
