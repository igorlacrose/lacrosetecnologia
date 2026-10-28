import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudAccess} from '../src/cloud-auth.js';
import {buildSnapshot,detectMapping} from '../src/engine.js';

const tenant='12345678-1234-4234-8234-123456789abc';
const user='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const jwt=aal=>['h',Buffer.from(JSON.stringify({aal,sub:user,role:'authenticated'})).toString('base64url'),'sig'].join('.');
const ok=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
function fixture(){
 const headers=['Status','Assunto','Abertura','Setor','Cidade','Fechamento','Prioridade'];
 const rows=[['Finalizada','RT-SEM CONEXÃO',46305,'Técnicos Jequié','Jequié',46306,'Normal'],
  ['Aberta','RT-SEM CONEXÃO',46306,'Técnicos Jequié','Jequié',null,'Normal']];
 return {...buildSnapshot(rows,detectMapping(headers)), fingerprint:'a'.repeat(64),raw_password:'FORBIDDEN'};
}
function stub({aal='aal2',duplicate=false,readback=true}={}){
 let row=null;const calls=[];
 const fetcher=async (url,opts)=>{
  const method=opts.method||'GET';calls.push({url,method,body:opts.body});
  if(url.includes('/auth/v1/token?grant_type=password'))return ok({access_token:jwt(aal),refresh_token:'r',expires_in:3600,user:{id:user,email:'demo@example.invalid'}});
  if(url.includes('/rest/v1/lkz_isp_aggregate_snapshots')){
   if(method==='POST'){
    if(duplicate)return ok({code:'23505'},409);
    const data=JSON.parse(opts.body);
    row={id:'11111111-2222-4333-8444-555555555555',tenant_id:tenant,created_at:new Date().toISOString(),fingerprint:data.fingerprint,snapshot:data.snapshot};
    return ok({},201);
   }
   return ok(readback&&row?[row]:[]);
  }
  throw Error('Unexpected '+url);
 };
 const client=new CloudAccess(fetcher);
 return {client,calls,setRow:r=>{row=r}};
}
test('importação inclui SOMENTE campos canônicos e confirma pela leitura do Supabase',async()=>{
 const x=stub();await x.client.signIn('demo@example.invalid','dummy');
 const res=await x.client.saveAggregateSnapshot(tenant,fixture());
 assert.equal(res.records.length,1);assert.equal(res.snapshot.total,2);
 const posted=JSON.parse(x.calls.find(c=>c.method==='POST'&&c.url.includes('snapshots')).body);
 assert.equal(posted.tenant_id,tenant);assert.equal(posted.created_by,user);
 assert.equal(posted.snapshot.raw_password,undefined);
 assert.equal(posted.snapshot.source,'IXC · Indicadores agregados');
 assert.ok(!JSON.stringify(posted).includes('FORBIDDEN'));
 assert.ok(x.calls.find(c=>c.method==='GET'&&c.url.includes('snapshots')));
});
test('não afirma sucesso quando gravação não foi confirmada',async()=>{
 const x=stub({readback:false});await x.client.signIn('demo@example.invalid','dummy');
 await assert.rejects(x.client.saveAggregateSnapshot(tenant,fixture()),/não confirmada|confirmada/i);
});
test('MFA nível 1 impede qualquer leitura ou gravação de indicadores',async()=>{
 const x=stub({aal:'aal1'});await x.client.signIn('demo@example.invalid','dummy');
 await assert.rejects(x.client.listAggregateSnapshots(tenant),/MFA/);
 await assert.rejects(x.client.saveAggregateSnapshot(tenant,fixture()),/MFA/);
 assert.equal(x.calls.filter(c=>c.url.includes('snapshots')).length,0);
});
test('duplicidade é resolvida apenas se leitura confirmar mesmo fingerprint',async()=>{
 const x=stub({duplicate:true});await x.client.signIn('demo@example.invalid','dummy');
 const obj=fixture();x.setRow({tenant_id:tenant,fingerprint:obj.fingerprint,snapshot:{...obj,raw_password:undefined},id:'44444444-4444-4444-8444-444444444444'});
 const r=await x.client.saveAggregateSnapshot(tenant,obj);
 assert.equal(r.duplicate,true);
});
test('snapshot com identificador de outra empresa falha em integridade',async()=>{
 const x=stub();await x.client.signIn('demo@example.invalid','dummy');
 x.setRow({tenant_id:'11111111-2222-4333-8444-555555555555',fingerprint:'a'.repeat(64),snapshot:fixture()});
 await assert.rejects(x.client.listAggregateSnapshots(tenant),/integridade/);
});
