import { createCipheriv, createHash, randomBytes } from 'node:crypto';

// Server-side only. No shared Lacrose credit line; every connection awaits
// independent customer billing verification before any billable message.
const graphHost='https://graph.facebook.com';
const ids=/^[0-9]{5,30}$/;
const uuids=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noncePattern=/^[A-Za-z0-9_-]{32,96}$/;
const hash=v=>createHash('sha256').update(v).digest('hex');

function configOf({appId,configId,appSecret,tokenKey,version,db}){
  if(!ids.test(appId??'')||!ids.test(configId??'')||
    typeof appSecret!=='string'||appSecret.length<20||
    !/^[0-9a-f]{64}$/i.test(tokenKey??'')||
    !/^v(?:2[4-9]|3[0-9])\.0$/.test(version??'')||
    typeof db?.transaction!=='function')
    throw new TypeError('Meta integration requires dedicated DB role, credentials and 256-bit token key');
  return {appId,configId,appSecret,version,db,key:Buffer.from(tokenKey,'hex')};
}
async function decodeGraph(response){
  if(!response.ok)throw new Error('meta_api_unavailable');
  const raw=await response.text();
  if(raw.length>65536)throw new Error('meta_response_too_large');
  try{return JSON.parse(raw)}catch{throw new Error('meta_invalid_response')}
}
async function verifyAuth(config,code,waba,phone,request){
  // POST: client secret and OAuth code must never appear in a query string.
  const body=new URLSearchParams({client_id:config.appId,client_secret:config.appSecret,code});
  const result=await decodeGraph(await request(graphHost+'/'+config.version+'/oauth/access_token',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:body.toString(),signal:AbortSignal.timeout(7000),redirect:'error'
  }));
  const token=result?.access_token;
  if(typeof token!=='string'||token.length<25||token.length>4096)
    throw new Error('meta_code_not_exchanged');
  const url=graphHost+'/'+config.version+'/'+waba+'/phone_numbers?fields=id,display_phone_number&limit=100';
  const numbers=await decodeGraph(await request(url,{
    headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(7000),redirect:'error'
  }));
  if(!Array.isArray(numbers?.data))throw new Error('meta_phone_not_verified');
  const registered=numbers.data.find(item=>String(item.id)===phone);
  if(!registered)throw new Error('meta_phone_not_verified');
  const display=typeof registered.display_phone_number==='string'
    ?registered.display_phone_number.slice(0,40):null;
  return {token,display};
}
function encryptToken(token,key){
  const nonce=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,nonce);
  return {nonce,encrypted:Buffer.concat([
    cipher.update(token,'utf8'),cipher.final(),cipher.getAuthTag()
  ])};
}
function verifyPayload(x){
  if(!x||typeof x!=='object'||Array.isArray(x)||
    !uuids.test(x.intentId??'')||!noncePattern.test(x.state??'')||
    !ids.test(x.wabaId??'')||!ids.test(x.phoneNumberId??'')||
    typeof x.code!=='string'||x.code.length<12||x.code.length>2048)
    throw new TypeError('Invalid Embedded Signup response');
  return x;
}

export function createMetaWhatsappProvider(options){
  const cfg=configOf(options),request=options.request??fetch;
  if(typeof request!=='function')throw new TypeError('Invalid request adapter');
  return Object.freeze({
    publicConfig:Object.freeze({
      appId:cfg.appId,configId:cfg.configId,version:cfg.version,directBillingOnly:true
    }),
    // This function is called inside a tenant-admin AAL2/RLS transaction.
    async start(tx,tenant,actor){
      if(!uuids.test(tenant)||!uuids.test(actor))throw new TypeError('Invalid tenant actor');
      const state=randomBytes(32).toString('base64url');
      const {rows:[intent]}=await tx.query(
        "insert into lkz_vnext.whatsapp_signup_intents "+
        "(tenant_id,actor_id,nonce_hash,expires_at) "+
        "values ($1,$2,$3,now()+interval '5 minutes') returning id",
        [tenant,actor,hash(state)]
      );
      return {intentId:intent.id,state,...this.publicConfig};
    },
    // Token is exchanged, verified and encrypted inside a separate privileged
    // DB transaction, with a role that cannot access financial/CRM objects.
    async finish(tenant,actor,data){
      const x=verifyPayload(data);
      if(!uuids.test(tenant)||!uuids.test(actor))throw new TypeError('Invalid tenant actor');
      return cfg.db.transaction(async tx=>{
        await tx.exec('set local role lkz_vnext_meta_bridge');
        const intent=await tx.query(
          "select id from lkz_vnext.whatsapp_signup_intents "+
          "where tenant_id=$1 and actor_id=$2 and id=$3 and nonce_hash=$4 "+
          "and consumed_at is null and expires_at>now() for update",
          [tenant,actor,x.intentId,hash(x.state)]
        );
        if(!intent.rows.length)return {ok:false,status:'signup_expired'};
        const {token,display}=await verifyAuth(cfg,x.code,x.wabaId,x.phoneNumberId,request);
        const secret=encryptToken(token,cfg.key);
        const prior=await tx.query(
          "select id,tenant_id from lkz_vnext.whatsapp_connections "+
          "where meta_phone_number_id=$1 for update",[x.phoneNumberId]
        );
        if(prior.rows.length&&prior.rows[0].tenant_id!==tenant)
          return {ok:false,status:'phone_owned_by_another_tenant'};
        let connectionId;
        if(prior.rows.length){
          connectionId=prior.rows[0].id;
          await tx.query(
            "update lkz_vnext.whatsapp_connections set "+
            "meta_waba_id=$3,meta_messaging_account_id=null,phone_display=$4,"+
            "token_ciphertext=$5,token_nonce=$6,token_key_version=1,"+
            "connection_state='awaiting_billing',billing_state='unverified',"+
            "billing_verified_at=null,billing_verified_by=null,updated_at=now() "+
            "where tenant_id=$1 and id=$2",
            [tenant,connectionId,x.wabaId,display,secret.encrypted,secret.nonce]
          );
        }else{
          const {rows:[connection]}=await tx.query(
            "insert into lkz_vnext.whatsapp_connections "+
            "(tenant_id,meta_waba_id,meta_phone_number_id,phone_display,"+
            "token_ciphertext,token_nonce) values ($1,$2,$3,$4,$5,$6) returning id",
            [tenant,x.wabaId,x.phoneNumberId,display,secret.encrypted,secret.nonce]
          );
          connectionId=connection.id;
        }
        await tx.query(
          "update lkz_vnext.whatsapp_signup_intents set consumed_at=now() "+
          "where tenant_id=$1 and id=$2",[tenant,x.intentId]
        );
        await tx.query(
          "insert into lkz_vnext.audit(tenant_id,actor_id,entity,record_id,operation) "+
          "values ($1,$2,'whatsapp_connections',$3,$4)",
          [tenant,actor,connectionId,prior.rows.length?'META_RECONNECTED':'META_CONNECTED']
        );
        return {ok:true,connectionId,status:'awaiting_billing',directBillingOnly:true};
      });
    }
  });
}
