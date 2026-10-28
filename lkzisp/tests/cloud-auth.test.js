import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudAccess,jwtAssurance} from '../src/cloud-auth.js';

function fakeJWT(aal='aal1') {
  const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
  return enc({typ:'JWT'})+'.'+enc({aal,sub:'test-user'})+'.sig';
}
const fakeResponse=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});

test('token vazio e JWT sem AAL2 são negados para dados', async()=>{
  const client=new CloudAccess(async()=>{throw Error('No network calls expected')});
  await assert.rejects(client.readMemberships(),/login/);
  assert.equal(jwtAssurance('token inválido'),'aal1');
  assert.equal(jwtAssurance(fakeJWT('aal1')),'aal1');
  assert.equal(jwtAssurance(fakeJWT('aal2')),'aal2');
});

test('login AAL1 não consulta o banco ou inventa autorização', async()=>{
  const calls=[];
  const fetchStub=async(url,config)=>{
    calls.push({url,body:config.body,headers:config.headers});
    if(url.includes('/token?grant_type=password'))return fakeResponse({access_token:fakeJWT('aal1'),refresh_token:'refresh-test',expires_in:3600,user:{email:'gestor@example.invalid'}});
    throw Error('Unexpected URL '+url);
  };
  const client=new CloudAccess(fetchStub);
  const logged=await client.signIn('gestor@example.invalid','senha-de-teste-nunca-real');
  assert.equal(logged.aal,'aal1');
  await assert.rejects(client.readMemberships(),/autenticação em dois fatores/);
  assert.equal(calls.length,1);
  assert.ok(!client.factor);
  client.clear();
  assert.equal(client.hasSession,false);
  assert.equal(client.email,null);
});

test('após MFA AAL2, consulta apenas escopos permitidos pelo RLS',async()=>{
  const calls=[];
  const manager={access_token:fakeJWT('aal1'),refresh_token:'refresh-test',expires_in:3600,user:{id:'test-user',email:'ok@example.invalid'}};
  const verified={...manager,access_token:fakeJWT('aal2')};
  const fetchStub=async(url,opts)=>{
    calls.push({url,method:opts.method,headers:opts.headers});
    if(url.includes('/token?grant_type=password'))return fakeResponse(manager);
    if(url.endsWith('/auth/v1/user'))return fakeResponse({id:'test-user',email:'ok@example.invalid',factors:[{id:'a'.repeat(20),type:'totp',status:'verified'}]});
    if(url.includes('/challenge'))return fakeResponse({id:'challenge-id'});
    if(url.includes('/verify'))return fakeResponse(verified);
    if(url.includes('/rest/v1/lkz_isp_memberships'))return fakeResponse([{tenant_id:'abc',role:'gestor',sector_id:null}]);
    throw Error('Unexpected URL '+url);
  };
  const client=new CloudAccess(fetchStub);
  await client.signIn('ok@example.invalid','senha-de-teste');
  const f=await client.listFactors();assert.equal(f.length,1);
  await client.verifyTotp('123456',f[0].id);
  assert.equal(client.aal,'aal2');
  const memberships=await client.readMemberships();
  assert.deepEqual(memberships,[{tenant_id:'abc',role:'gestor',sector_id:null}]);
  const r=calls.at(-1);
  assert.ok(r.url.includes('select=tenant_id,role,sector_id'));
  assert.equal(r.headers.Authorization,'Bearer '+fakeJWT('aal2'));
});

test('não guarda sessão em storage e não usa chave secreta',async()=>{
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('../src/cloud-auth.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|sb_secret_|service_role/);
  const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
  assert.match(sw,/cloud-auth\.js/);
  assert.doesNotMatch(sw,/https:\/\/syysqoieyycclpfbadwp\.supabase\.co/);
});

test('gestor registra solicitação de convite sem enviar e-mail ou criar MASTER',async()=>{
  const tenant='12345678-1234-4234-8234-123456789abc';
  const user='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const requests=[];
  const fake=async(url,options)=>{
    requests.push({url,...options});
    if(url.includes('/token?grant_type=password'))return fakeResponse({access_token:fakeJWT('aal2'),refresh_token:'test-refresh',expires_in:3600,user:{id:user,email:'leader@example.invalid'}});
    if(url.includes('/rest/v1/lkz_isp_memberships'))return fakeResponse([{tenant_id:tenant,role:'gestor',sector_id:null}]);
    if(url.endsWith('/rest/v1/lkz_isp_user_invitations'))return fakeResponse({},201);
    throw Error('Unexpected '+url);
  };
  const cloud=new CloudAccess(fake);
  await cloud.signIn('leader@example.invalid','senha-ficticia');
  await cloud.createInvitation({tenant_id:tenant,invited_email:'  NOVO@EXAMPLE.COM  ',requested_role:'gestor'});
  const posted=requests.find(x=>x.url.endsWith('/rest/v1/lkz_isp_user_invitations'));
  assert.ok(posted);
  assert.equal(posted.method,'POST');
  assert.deepEqual(JSON.parse(posted.body),{tenant_id:tenant,invited_email:'novo@example.com',requested_role:'gestor',created_by:user});
  assert.equal(requests.filter(x=>x.url.includes('invite')&&x.url.includes('auth')).length,0);
  await assert.rejects(cloud.createInvitation({tenant_id:tenant,invited_email:'root@example.invalid',requested_role:'master'}),/MASTER/);
});

test('administrador não convida gestor, mas pode solicitar grupos comuns',async()=>{
  const tenant='12345678-1234-4234-8234-123456789abc';
  const user='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  let posts=0;
  const cloud=new CloudAccess(async(url)=>{
    if(url.includes('grant_type=password'))return fakeResponse({access_token:fakeJWT('aal2'),refresh_token:'test-refresh',expires_in:3600,user:{id:user,email:'admin@example.invalid'}});
    if(url.includes('/rest/v1/lkz_isp_memberships'))return fakeResponse([{tenant_id:tenant,role:'administrador',sector_id:null}]);
    if(url.endsWith('lkz_isp_user_invitations')){posts++;return fakeResponse({},201);}
    throw Error('unexpected URL');
  });
  await cloud.signIn('admin@example.invalid','senha-de-exemplo');
  await assert.rejects(cloud.createInvitation({tenant_id:tenant,invited_email:'gestor@example.invalid',requested_role:'gestor'}),/não autoriza/);
  assert.equal(posts,0);
  await cloud.createInvitation({tenant_id:tenant,invited_email:'outro@example.invalid',requested_role:'administrador'});
  assert.equal(posts,1);
});

test('auditoria exige MFA e nunca aceita tenant malformado',async()=>{
  const client=new CloudAccess(async(url)=>{
    if(url.includes('grant_type=password'))return fakeResponse({access_token:fakeJWT('aal1'),refresh_token:'r',expires_in:3600,user:{id:'a',email:'mfa@example.invalid'}});
    throw Error('Unexpected URL');
  });
  await client.signIn('mfa@example.invalid','senha');
  await assert.rejects(client.readAudit('12345678-1234-4234-8234-123456789abc'),/MFA/);
});

test('native browser-style fetch keeps its global receiver',async()=>{
 const original=globalThis.fetch;
 let requests=0;
 globalThis.fetch=function(url,init){
   assert.equal(this,globalThis,'fetch must keep Window/global receiver');
   requests++;
   return Promise.resolve({ok:true,status:200,json:async()=>({access_token:'a.b.c',refresh_token:'testrefresh',expires_in:3600,user:{id:'u',email:'account@example.com'}})});
 };
 try{
   const client=new CloudAccess();
   await client.signIn('account@example.com','test-only');
   assert.equal(requests,1);
 }finally{globalThis.fetch=original;}
});
