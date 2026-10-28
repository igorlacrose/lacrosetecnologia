import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudAccess} from '../src/cloud-auth.js';
import {buildSnapshot,detectMapping} from '../src/engine.js';
import {buildEmployeeMetrics} from '../src/employee-analytics.js';
const user='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const tenant='12345678-1234-4234-8234-123456789abc';
const jwt=aal=>['h',Buffer.from(JSON.stringify({aal,sub:user,role:'authenticated'})).toString('base64url'),'sig'].join('.');
const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
function payload(){
 const headers=['Status','Assunto','Abertura','Fechamento','Setor','Colaborador','Cliente'];
 const mapping=detectMapping(headers);
 const rows=[
 ['Finalizada','RT-SEM CONEXÃO',46305,46306,'Atendimento','Maria Silva','CLIENTE-NAO-PERSISTIR'],
 ['Aberta','RT-SEM CONEXÃO',46306,null,'Atendimento','João Teste','CLIENTE-NAO-PERSISTIR-2']
 ];
 const snapshot=buildSnapshot(rows,mapping,{source:'IXC · Relatório de atendimentos'});
 snapshot.fingerprint='a'.repeat(64);
 const employees=buildEmployeeMetrics(rows,mapping,snapshot.referenceDate).metrics;
 return {snapshot,employees};
}
test('importação composta envia somente resumo canonico e nomes de colaboradores, nunca Cliente',async()=>{
 const data=payload();let saved=null;let employeeRows=[];const calls=[];
 const client=new CloudAccess(async(url,request)=>{
  const method=request.method||'GET';calls.push({url,method,body:request.body});
  if(url.includes('grant_type=password'))return reply({access_token:jwt('aal2'),refresh_token:'r',expires_in:3600,user:{id:user,email:'gestor@example.invalid'}});
  if(url.endsWith('/rpc/lkz_isp_save_snapshot_with_employees')){
   const args=JSON.parse(request.body);
   assert.deepEqual(Object.keys(args).sort(),['p_employees','p_snapshot','p_tenant']);
   assert.equal(args.p_tenant,tenant);
   assert.equal(args.p_employees.length,2);
   assert.ok(!JSON.stringify(args).includes('CLIENTE-NAO-PERSISTIR'));
   assert.ok(!JSON.stringify(args).includes('raw_password'));
   assert.equal(args.p_snapshot.source,'IXC · Indicadores agregados');
   assert.equal(args.p_snapshot.availableFields.includes('Colaborador'),false);
   saved={id:'11111111-2222-4333-8444-555555555555',tenant_id:tenant,fingerprint:args.p_snapshot.fingerprint,snapshot:args.p_snapshot};
   employeeRows=args.p_employees.map(x=>({employee_name:x.name,sector_label:x.sector,total:x.total,
     finalized:x.finalized,pending:x.pending,closed_with_dates:x.closedWithDates,
     closed_over_24:x.closedOver24,pending_older_7d:x.pendingOlder7d}));
   return reply(saved.id);
  }
  if(url.includes('/rest/v1/lkz_isp_aggregate_snapshots'))return reply(saved?[saved]:[]);
  if(url.includes('/rest/v1/lkz_isp_employee_metrics'))return reply(employeeRows);
  throw Error('Unexpected '+url);
 });
 await client.signIn('gestor@example.invalid','senha-teste');
 const result=await client.saveSnapshotWithEmployees(tenant,data.snapshot,data.employees);
 assert.equal(result.records.length,1);
 assert.equal(result.employees.length,2);
 assert.ok(calls.some(c=>c.method==='POST'&&c.url.includes('rpc/lkz_isp_save_snapshot_with_employees')));
 assert.ok(calls.some(c=>c.method==='GET'&&c.url.includes('lkz_isp_employee_metrics')));
});
test('falha de confirmação individual não declara sucesso nem apaga arquivo',async()=>{
 const data=payload();let saved=null;
 const client=new CloudAccess(async(url,req)=>{
  if(url.includes('grant_type=password'))return reply({access_token:jwt('aal2'),refresh_token:'r',expires_in:3600,user:{id:user,email:'gestor@example.invalid'}});
  if(url.includes('/rpc/')){const payload=JSON.parse(req.body);saved={id:'11111111-2222-4333-8444-555555555555',tenant_id:tenant,fingerprint:payload.p_snapshot.fingerprint,snapshot:payload.p_snapshot};return reply('id');}
  if(url.includes('aggregate_snapshots'))return reply(saved?[saved]:[]);
  if(url.includes('employee_metrics'))return reply([]);
  throw Error('unexpected '+url);
 });
 await client.signIn('gestor@example.invalid','senha-teste');
 await assert.rejects(client.saveSnapshotWithEmployees(tenant,data.snapshot,data.employees),/não confirmados|não confirmada/);
});
test('AAL1 não pode enviar nem ler dados individuais',async()=>{
 const requests=[];
 const client=new CloudAccess(async(url)=>{
  requests.push(url);
  if(url.includes('grant_type=password'))return reply({access_token:jwt('aal1'),refresh_token:'r',expires_in:3600,user:{id:user,email:'gestor@example.invalid'}});
  throw Error('should not call '+url);
 });
 await client.signIn('gestor@example.invalid','senha-teste');
 await assert.rejects(client.saveSnapshotWithEmployees(tenant,payload().snapshot,payload().employees),/MFA/);
 await assert.rejects(client.readEmployeeMetrics(tenant,'a'.repeat(64)),/MFA/);
 assert.equal(requests.length,1);
});
