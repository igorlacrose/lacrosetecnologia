import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {detectMapping,buildSnapshot} from '../src/engine.js';
import {buildEmployeeMetrics,cleanEmployeeName} from '../src/employee-analytics.js';
import {parseCsv} from '../src/importer.js';

test('IXC: conta o colaborador e jamais retém colunas de cliente, contato ou credencial',()=>{
 const csv='Status;Assunto;Abertura;Fechamento;Setor;Colaborador;Cliente;Telefone celular;Login;Senha MD5 PPPoE/Hotspot\n'+
 'Finalizada;RT-SEM CONEXÃO;28/10/2026;29/10/2026;Atendimento;Maria Silva;CLIENT-SECRET;73999990000;client-login;PASS-MD5\n'+
 'Aberta;RT-LENTIDÃO;26/10/2026;;Atendimento;Maria Silva;CLIENT-SECRET2;73900000000;client-login2;PASS-MD5-2\n'+
 'Finalizada;RT-SEM CONEXÃO;24/10/2026;24/10/2026;Técnicos Jequié;João Teste;CLIENT-SECRET3;73988888888;client3;PASS-MD5-3';
 const {headers,rows}=parseCsv(csv);
 const mapping=detectMapping(headers);
 assert.equal(headers[mapping.Colaborador],'Colaborador');
 for(const r of rows)assert.ok(!JSON.stringify(r).includes('CLIENT-SECRET')&&!JSON.stringify(r).includes('PASS-MD5')&&!JSON.stringify(r).includes('client-login'));
 const result=buildEmployeeMetrics(rows,mapping,'2026-10-28');
 assert.equal(result.assigned,3);assert.equal(result.unassigned,0);
 assert.equal(result.metrics.length,2);
 const maria=result.metrics.find(x=>x.name==='Maria Silva');
 assert.deepEqual({total:maria.total,finalized:maria.finalized,pending:maria.pending}, {total:2,finalized:1,pending:1});
 assert.ok(!JSON.stringify(result).includes('Cliente')&&!JSON.stringify(result).includes('Senha')&&!JSON.stringify(result).includes('CLIENT-SECRET'));
 const snap=buildSnapshot(rows,mapping,{source:'IXC · Indicadores agregados'});
 assert.equal(snap.total,3);
 assert.equal(snap.availableFields.includes('Colaborador'),false);
 assert.ok(!JSON.stringify(snap).includes('Maria Silva'));
});
test('colaborador invalido e identificador potencialmente sensivel nao entra no banco',()=>{
 for(const name of ['john@example.com','73999991111','https://site.com','<script>alert(1)</script>','123.456.789-00','12345678901','']) {
   assert.equal(cleanEmployeeName(name),null,name);
 }
 assert.equal(cleanEmployeeName('José de Souza'),'José de Souza');
 assert.equal(cleanEmployeeName('Ana Maria (N2)'),'Ana Maria (N2)');
 assert.equal(cleanEmployeeName('Ana-Maria Silva'),'Ana-Maria Silva');
});
test('sem coluna Colaborador o sistema avisa, sem inventar pessoas',()=>{
 const headers=['Status','Assunto','Abertura'];
 const rows=[['Aberta','RT','28/10/2026']];
 const result=buildEmployeeMetrics(rows,detectMapping(headers),'2026-10-28');
 assert.equal(result.missingColumn,true);
 assert.deepEqual(result.metrics,[]);
});
test('métricas preservam escopo por setor e não classificam bonificação automaticamente',()=>{
 const headers=['Status','Assunto','Abertura','Fechamento','Setor','Colaborador'];
 const rows=[
  ['Finalizada','RT','01/10/2026','03/10/2026','Atendimento','Maria Silva'],
  ['Aberta','RT','01/10/2026','','Atendimento','Maria Silva'],
  ['Finalizada','RT','01/10/2026','01/10/2026','Técnicos Jequié','Maria Silva']
 ];
 const result=buildEmployeeMetrics(rows,detectMapping(headers),'2026-10-20');
 assert.equal(result.metrics.length,2);
 const a=result.metrics.find(x=>x.sector==='Atendimento');
 assert.deepEqual({total:a.total,finalized:a.finalized,pending:a.pending,closedOver24:a.closedOver24,pendingOlder7d:a.pendingOlder7d},
 {total:2,finalized:1,pending:1,closedOver24:1,pendingOlder7d:1});
 assert.equal(Object.hasOwn(a,'bonus'),false);
});
test('UI não contém bloqueio LGPD e confirma consulta separada por MFA',()=>{
 const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 const auth=readFileSync(new URL('../src/cloud-auth.js',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 assert.match(app,/function employeeProductivity\(/);
 assert.match(app,/readEmployeeMetrics/);
 assert.match(app,/saveSnapshotWithEmployees/);
 assert.match(app,/data-load-employees/);
 assert.match(auth,/lkz_isp_employee_metrics/);
 assert.match(auth,/lkz_isp_save_snapshot_with_employees/);
 assert.match(auth,/this\.aal!=='aal2'/);
 assert.match(sw,/lkz-isp-static-v100/);
 assert.match(sw,/src\/employee-analytics\.js/);
 assert.doesNotMatch(app,/análise individual está bloqueada neste protótipo/);
});
