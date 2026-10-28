import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CloudAccess} from '../src/cloud-auth.js';

const user='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const tenant='12345678-1234-4234-8234-123456789abc';
const invitation='11111111-2222-4333-8444-555555555555';
const jwt=aal=>['head',Buffer.from(JSON.stringify({sub:user,aal,role:'authenticated'})).toString('base64url'),'signature'].join('.');
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const session=aal=>({access_token:jwt(aal),refresh_token:'refresh-token',expires_in:3600,user:{id:user,email:'gestor@example.invalid'}});

test('SMTP Resend indisponível mantém convite pendente; não declara envio',async()=>{
 const paths=[];
 const client=new CloudAccess(async(url,options)=>{
  paths.push({url,method:options.method,body:options.body});
  if(url.includes('grant_type=password'))return response(session('aal2'));
  if(url.includes('lkz_isp_memberships'))return response([{tenant_id:tenant,role:'gestor',sector_id:null}]);
  if(url.includes('lkz_isp_user_invitations?select='))return response([{id:invitation,status:'pending'}],201);
  if(url.includes('functions/v1/lkzisp-user-invitations'))return response({error:'resend_smtp_not_configured'},409);
  throw Error('Unexpected request '+url);
 });
 await client.signIn('gestor@example.invalid','test-password');
 const result=await client.createInvitation({tenant_id:tenant,invited_email:'new@example.invalid',requested_role:'administrador'});
 assert.equal(result.saved,true);
 assert.equal(result.sent,false);
 assert.equal(result.id,invitation);
 assert.match(result.reason,/Resend.*SMTP/i);
 assert.equal(paths.filter(x=>x.url.includes('lkz_isp_user_invitations?select=')).length,1);
 assert.equal(paths.filter(x=>x.url.includes('functions/v1/lkzisp-user-invitations')).length,1);
});

test('nova pessoa só aceita convite depois de MFA confirmado',async()=>{
 let count=0;
 const client=new CloudAccess(async(url)=>{
  if(url.includes('grant_type=password'))return response(session('aal1'));
  count++;throw Error('Forbidden access '+url);
 });
 await client.signIn('gestor@example.invalid','test-password');
 await assert.rejects(client.acceptInvitations(),/segundo fator/);
 await assert.rejects(client.sendInvitation(invitation),/MFA/);
 assert.equal(count,0);
});

test('conta AAL2 confirma convites via função segura; nunca define papel no navegador',async()=>{
 const actions=[];
 const client=new CloudAccess(async(url,options)=>{
  if(url.includes('grant_type=password'))return response(session('aal2'));
  if(url.includes('functions/v1/lkzisp-user-invitations')){
   actions.push(JSON.parse(options.body));
   return response({status:'accepted_checked',accepted:1});
  }
  throw Error('Unexpected '+url);
 });
 await client.signIn('gestor@example.invalid','test-password');
 const result=await client.acceptInvitations();
 assert.deepEqual(result,{accepted:1});
 assert.deepEqual(actions,[{action:'accept'}]);
});

test('link de convite validado permite criar senha própria antes do MFA',async()=>{
 const oldLoc=globalThis.location,oldHist=globalThis.history;
 const getUrl=jwt('aal1');
 globalThis.location={hash:'#access_token='+getUrl+'&refresh_token=refresh-token&type=invite&expires_in=3600',pathname:'/lkzisp/',search:''};
 globalThis.history={replaceState:()=>{}};
 let updated=false;
 try{
  const client=new CloudAccess(async(url,options)=>{
   if(url.endsWith('/auth/v1/user')&&options.method==='GET')return response({id:user,email:'new@example.invalid'});
   if(url.endsWith('/auth/v1/user')&&options.method==='PUT'){
    assert.ok(typeof JSON.parse(options.body).password==='string');
    updated=true;
    return response({});
   }
   throw Error('Unexpected '+url);
  });
  const outcome=await client.handleAuthCallback();
  assert.equal(outcome.invited,true);
  assert.equal(client.invitationSetupPending,true);
  await assert.rejects(client.setInvitedPassword('123'),/12 e 200/);
  await client.setInvitedPassword('only-a-test-long-password');
  assert.equal(updated,true);
  assert.equal(client.hasSession,true);
  assert.equal(client.invitationSetupPending,false);
 }finally{globalThis.location=oldLoc;globalThis.history=oldHist;}
});

test('Edge Function exige JWT, remetente autorizado e não expõe segredos',()=>{
 const src=readFileSync(new URL('../supabase/functions/lkzisp-user-invitations/index.ts',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(src,/auth\.getUser\(token\)/);
 assert.match(src,/verifiedClaims\.aal!=="aal2"/);
 assert.match(src,/lkz_isp_internal_claim_invite_delivery/);
 assert.match(src,/lkz_isp_internal_accept_user_invitations/);
 assert.match(src,/auth\.admin\.inviteUserByEmail/);
 assert.match(src,/shouldCreateUser:false/);
 assert.match(ui,/cloud\.setInvitedPassword/);
 assert.match(ui,/cloud\.acceptInvitations/);
 assert.match(ui,/Convites da empresa/);
 assert.doesNotMatch(src,/sb_secret_[A-Za-z0-9]+|sk_live_[A-Za-z0-9]+/);
});
