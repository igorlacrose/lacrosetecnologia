import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CloudAccess} from '../src/cloud-auth.js';
const read=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');
const app=read('../src/app.js'),server=read('../supabase/functions/lkzisp-master-account-security/index.ts');
const migration=read('../supabase/migrations/20261028_lkz_isp_master_security_actions.sql');
const jwt=()=>['head',Buffer.from(JSON.stringify({sub:'00000000-0000-4000-8000-000000000001',aal:'aal2'})).toString('base64url'),'sig'].join('.');
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});

test('UI somente MASTER com MFA e operação explicitamente confirmada',()=>{
 assert.match(app,/function masterSecurityPanel\(/);
 assert.match(app,/canAdministerLocalWorkspace\(\)/);
 assert.match(app,/id="master-security-code"/);
 assert.match(app,/data-cloud="master-users"/);
 assert.match(app,/window\.confirm\(confirmation\)/);
 assert.match(app,/result\.self&&action==='mfa_reset'/);
 assert.match(app,/await cloud\.signOut\(\)/);
 assert.match(app,/cloudUi\.masterUsers=\[\];cloudUi\.masterFactors=\[\]/);
});

test('Edge não permite reset sem MASTER real e revalidação TOTP recente',()=>{
 assert.match(server,/auth\.getUser\(accessToken\)/);
 assert.match(server,/claims\.aal!=="aal2"/);
 assert.match(server,/lkz_isp_master_security_check/);
 assert.match(server,/auth\/v1\/factors\//);
 assert.match(server,/\/challenge/);
 assert.match(server,/\/verify/);
 assert.match(server,/second_factor_verification_failed/);
 assert.match(server,/lkz_isp_master_security_reserve/);
 assert.match(server,/lkz_isp_master_security_finish/);
 assert.doesNotMatch(server,/console\.(log|error)|localStorage|sessionStorage/);
 assert.doesNotMatch(app,/Deno\\.env\\.get\\(/);
});

test('senha é criada somente pelo titular via recuperação Auth, não pelo MASTER',()=>{
 assert.match(server,/resetPasswordForEmail\(target\.user\.email/);
 assert.match(server,/target\.user\.email_confirmed_at/);
 assert.doesNotMatch(server,/generateLink|updateUserById|password\s*:/);
 assert.match(server,/target_id/);
 assert.match(server,/\bgetUserById\(targetId\)/);
});

test('fatores gerenciados no servidor e exigência de novo MFA preservada',()=>{
 assert.match(server,/admin\.auth\.admin\.mfa\.listFactors\(\{userId:targetId\}\)/);
 assert.match(server,/admin\.auth\.admin\.mfa\.deleteFactor\(\{userId:targetId,id:f\.id\}\)/);
 assert.match(app,/configure um novo autenticador/);
});

test('auditoria privada append-only e limitação de tentativas sem acesso para clientes',()=>{
 assert.match(migration,/lkz_private\.is_system_master_uid\(p_actor\)/);
 assert.match(migration,/phase IN \('reserved','succeeded','failed'\)/);
 assert.match(migration,/pg_advisory_xact_lock/);
 assert.match(migration,/SECURITY_ACTION_RATE_LIMIT/);
 assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
 assert.match(migration,/REVOKE ALL .* FROM PUBLIC,anon,authenticated/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.lkz_isp_master_security_reserve\(uuid,uuid,text\) TO service_role/);
 assert.doesNotMatch(migration,/GRANT EXECUTE .*TO authenticated/);
});

test('cliente não aceita parâmetros inválidos e não expõe chave administrativa',async()=>{
 const calls=[];
 const client=new CloudAccess(async(url,opts)=>{
  calls.push({url,opts});
  if(url.includes('grant_type=password'))return response({access_token:jwt(),refresh_token:'refresh',expires_in:3600,user:{id:'00000000-0000-4000-8000-000000000001',email:'master@example.invalid'}});
  if(url.includes('lkzisp-master-account-security')){
   const body=JSON.parse(opts.body);
   if(body.action==='list')return response({users:[{user_id:'00000000-0000-4000-8000-000000000001',tenant_id:'00000000-0000-4000-8000-000000000002',role:'master',email:'master@example.invalid',is_self:true,email_confirmed:true}]});
   return response({status:'mfa_reset_completed',self:true});
  }
  throw Error('URL inesperada');
 });
 await client.signIn('master@example.invalid','not-a-real-secret');
 const users=await client.listMasterSecurityUsers();
 assert.equal(users.length,1);
 await assert.rejects(client.masterAccountSecurityAction({target_id:users[0].user_id,action:'mfa_reset',factor_id:users[0].user_id,code:'invalid'}),/inválidos/);
 await client.masterAccountSecurityAction({target_id:users[0].user_id,action:'mfa_reset',factor_id:users[0].user_id,code:'123456'});
 const callsToEdge=calls.filter(x=>x.url.includes('lkzisp-master-account-security'));
 assert.equal(callsToEdge.length,2);
 assert.ok(!JSON.stringify(callsToEdge).includes('service_role'));
});
