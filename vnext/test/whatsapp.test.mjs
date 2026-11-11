import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPreviewDatabase, fixture, withIdentity } from '../preview-db.mjs';
import { serveWorkspace } from '../workspace.mjs';
import { createMetaWhatsappProvider } from '../meta-whatsapp.mjs';

const appId='123456789012345', configId='765432109876543';
const wabaId='12345678901', phoneNumberId='98765432101';
const tokenKey='ab'.repeat(32);
const businessToken='fixtures-only-business-integration-access-token';
const code='fixture_authorization_code_123456789';
const admin={sub:fixture.admin,aal:'aal2'};
const adminB={sub:fixture.secondAdmin,aal:'aal2'};
const viewer={sub:fixture.viewer,aal:'aal2'};

function provider(db) {
  const calls=[];
  const instance=createMetaWhatsappProvider({
    db,appId,configId,appSecret:'staging-fixture-meta-app-secret-key',
    tokenKey,version:'v26.0',request:async (url,options)=>{
      calls.push({url,method:options.method});
      assert.equal(options.redirect,'error');
      assert.equal(options.signal?.aborted,false);
      if(url.endsWith('/oauth/access_token')){
        assert.equal(options.method,'POST');
        assert.doesNotMatch(url,/client_secret|fixture_authorization_code/);
        assert.equal(new URLSearchParams(options.body).get('code'),code);
        return Response.json({access_token:businessToken});
      }
      assert.match(url,new RegExp('/'+wabaId+'/phone_numbers'));
      assert.equal(options.headers.authorization,'Bearer '+businessToken);
      return Response.json({data:[{id:phoneNumberId,display_phone_number:'+55 73 99999-0000'}]});
    }
  });
  return {instance,calls};
}
async function call(db,route,{claims=admin,tenant=fixture.tenant,data,metaProvider=null}={}){
  const request=new Request('https://staging.example.test/api/'+route+'?tenant='+tenant,
    data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const res=await serveWorkspace(request,db,claims,{metaProvider});
  return [res.status,await res.json()];
}

test('Meta connection fails closed without credentials, an admin, or AAL2',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  assert.deepEqual(await call(db,'whatsapp'),[200,[]]);
  assert.equal((await call(db,'whatsapp',{claims:null}))[0],401);
  assert.equal((await call(db,'whatsapp',{claims:{...admin,aal:'aal1'}}))[0],403);
  assert.equal((await call(db,'whatsapp',{claims:adminB}))[0],403);
  assert.equal((await call(db,'whatsapp/signup',{data:{}}))[0],503);
  const {instance}=provider(db);
  assert.equal((await call(db,'whatsapp/signup',{claims:viewer,data:{},metaProvider:instance}))[0],403);
  const [status,intent]=await call(db,'whatsapp/signup',{data:{},metaProvider:instance});
  assert.equal(status,201);
  assert.equal(intent.directBillingOnly,true);
  assert.equal(intent.configId,configId);
  assert.ok(intent.state.length>=32);
});

test('OAuth code is checked against Meta phone, encrypted and tenant-pinned',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  const {instance,calls}=provider(db);
  const [status,nonce]=await call(db,'whatsapp/signup',{data:{},metaProvider:instance});
  assert.equal(status,201);
  const posted={intentId:nonce.intentId,state:nonce.state,code,
    wabaId,phoneNumberId};
  const linked=await instance.finish(fixture.tenant,fixture.admin,posted);
  assert.equal(linked.ok,true);
  assert.equal(linked.status,'awaiting_billing');
  assert.equal(calls.length,2);
  const [readStatus,list]=await call(db,'whatsapp');
  assert.equal(readStatus,200);
  assert.equal(list.length,1);
  assert.equal(list[0].meta_phone_number_id,phoneNumberId);
  assert.equal(list[0].billing_owner,'customer_direct');
  assert.equal(list[0].billing_state,'unverified');
  assert.equal(list[0].connection_state,'awaiting_billing');
  assert.equal(JSON.stringify(list).includes('token_'),false);
  const [otherStatus,otherList]=await call(db,'whatsapp',{claims:adminB,tenant:fixture.secondTenant});
  assert.equal(otherStatus,200);
  assert.deepEqual(otherList,[]);
  const secret=(await db.query('select token_ciphertext,token_nonce from lkz_vnext.whatsapp_connections')).rows[0];
  assert.ok(secret.token_ciphertext);
  assert.equal(secret.token_nonce.length,12);
  assert.notEqual(secret.token_ciphertext.toString(),businessToken);
  await assert.rejects(
    withIdentity(db,admin,tx=>tx.query('select token_ciphertext from lkz_vnext.whatsapp_connections')),
    {code:'42501'}
  );
  assert.deepEqual(await instance.finish(fixture.tenant,fixture.admin,posted),
    {ok:false,status:'signup_expired'});
});

test('billing self-report cannot make an account verified or activate messages',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  const {instance}=provider(db);
  const [,nonce]=await call(db,'whatsapp/signup',{data:{},metaProvider:instance});
  const linked=await instance.finish(fixture.tenant,fixture.admin,{
    intentId:nonce.intentId,state:nonce.state,code,wabaId,phoneNumberId
  });
  const path='whatsapp/'+linked.connectionId+'/report-billing';
  assert.equal((await call(db,path,{claims:viewer,data:{}}))[0],403);
  // Um admin B é autorizado apenas em B: a conexão de A é indisponível.
  assert.equal((await call(db,path,{claims:adminB,tenant:fixture.secondTenant,data:{}}))[0],409);
  const [status,report]=await call(db,path,{data:{}});
  assert.equal(status,200);
  assert.equal(report.billing_state,'customer_reported');
  assert.equal(report.active,false);
  const [,list]=await call(db,'whatsapp');
  assert.equal(list[0].connection_state,'awaiting_billing');
  assert.equal(list[0].billing_state,'customer_reported');
  assert.equal((await call(db,path,{data:{}}))[0],409);
  await assert.rejects(
    withIdentity(db,admin,tx=>tx.query(
      "update lkz_vnext.whatsapp_connections set billing_state='verified' where tenant_id=$1",
      [fixture.tenant]
    )),{code:'42501'}
  );
  assert.equal((await call(db,'whatsapp/reminders'))[1].enabled,false);
});

test('duplicate phone must not be attached to another tenant',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  const {instance}=provider(db);
  const [,first]=await call(db,'whatsapp/signup',{data:{},metaProvider:instance});
  const grant=n=>({intentId:n.intentId,state:n.state,code,wabaId,phoneNumberId});
  assert.equal((await instance.finish(fixture.tenant,fixture.admin,grant(first))).ok,true);
  const [,other]=await call(db,'whatsapp/signup',{tenant:fixture.secondTenant,
    claims:adminB,data:{},metaProvider:instance});
  const attempt=await instance.finish(fixture.secondTenant,fixture.secondAdmin,grant(other));
  assert.equal(attempt.ok,false);
  assert.equal(attempt.status,'phone_owned_by_another_tenant');
  assert.equal((await db.query('select count(*)::integer as total from lkz_vnext.whatsapp_connections')).rows[0].total,1);
});

test('invalid Meta response never creates or unlocks a connection',async t=>{
  const db=await createPreviewDatabase();t.after(()=>db.close());
  const {instance}=provider(db);
  const [,nonce]=await call(db,'whatsapp/signup',{data:{},metaProvider:instance});
  await assert.rejects(instance.finish(fixture.tenant,fixture.admin,{
    intentId:nonce.intentId,state:nonce.state,code,wabaId,
    phoneNumberId:'12345679999'
  }),/meta_phone_not_verified/);
  assert.equal((await call(db,'whatsapp'))[1].length,0);
  assert.throws(()=>createMetaWhatsappProvider({
    db,appId,configId,appSecret:'short',tokenKey,version:'v26.0'
  }),/requires dedicated/);
});
