import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CloudAccess} from '../src/cloud-auth.js';
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const tenant='8f2fa969-a686-471d-99de-247bdc2cd15e';
const sector='6fbc92a8-9a6c-465c-ae12-a87a50b92889';
const jwt=aal=>['h',Buffer.from(JSON.stringify({aal,sub:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'})).toString('base64url'),'s'].join('.');
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});

test('setores disponíveis são consultados sob JWT e tenant com MFA AAL2',async()=>{
 const calls=[];const client=new CloudAccess(async(url,opts)=>{
  calls.push({url,opts});
  if(url.includes('grant_type=password'))return response({access_token:jwt('aal2'),refresh_token:'test-refresh',expires_in:3600,user:{id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',email:'master@example.invalid'}});
  if(url.includes('lkz_isp_sectors'))return response([{id:sector,tenant_id:tenant,name:'Financeiro'}]);
  throw Error('Endpoint não esperado');
 });
 await client.signIn('master@example.invalid','senha-exemplo');
 const sectors=await client.listSectors(tenant);
 assert.deepEqual(sectors,[{id:sector,name:'Financeiro'}]);
 const query=calls.find(x=>x.url.includes('lkz_isp_sectors'));
 assert.ok(query.url.includes('tenant_id=eq.'+tenant));
 assert.match(query.opts.headers.Authorization,/^Bearer /);
 assert.doesNotMatch(query.url,/employee|snapshot|password/i);
});
test('setores bloqueados sem MFA ou com empresa inválida',async()=>{
 const client=new CloudAccess(async(url)=>{
  if(url.includes('grant_type=password'))return response({access_token:jwt('aal1'),refresh_token:'refresh',expires_in:3600,user:{id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'}});
  throw Error('Consulta proibida');
 });
 await client.signIn('viewer@example.invalid','senha-exemplo');
 await assert.rejects(client.listSectors(tenant),/MFA/);
 await assert.rejects(client.listSectors('uuid-invalido'),/MFA/);
});
test('fail closed para setor de outro tenant ou payload inválido',async()=>{
 const client=new CloudAccess(async(url)=>{
  if(url.includes('grant_type=password'))return response({access_token:jwt('aal2'),refresh_token:'refresh',expires_in:3600,user:{id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'}});
  return response([{id:sector,tenant_id:'11111111-2222-4333-8444-555555555555',name:'Financeiro'}]);
 });
 await client.signIn('master@example.invalid','senha-exemplo');
 await assert.rejects(client.listSectors(tenant),/inválido/);
});
test('UI usa dropdown por nome para Líder/Financeiro e não pede UUID',()=>{
 assert.match(app,/id="invite-sector-field"/);
 assert.match(app,/id="invite-sector" disabled/);
 assert.match(app,/cloudUi\.inviteSectors\.map\(s=>/);
 assert.match(app,/syncInviteSectorField/);
 assert.match(app,/select\.required=required/);
 assert.match(app,/!cloudUi\.inviteSectors\.some\(s=>s\.id===sector_id\)/);
 assert.doesNotMatch(app,/Identificador UUID do setor/);
 assert.match(app,/needSector\?\(document\.getElementById\('invite-sector'\)/);
});
