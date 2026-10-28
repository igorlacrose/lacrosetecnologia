import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeRejectedReport} from '../src/review-analysis.js';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261028_lkz_isp_reviewers_and_diagnostics.sql',import.meta.url),'utf8');

test('reprovação mostra evidência, hipóteses e ações sem atribuir culpa',()=>{
 const s={total:100,pending:40,finalized:60,pendingOlder7d:8,closedWithDates:55,closedOver24:19,
  sectors:{Suporte:{total:50,pending:28}},subjects:{Conexao:{total:30,pending:21}},invalidDates:2};
 const r=analyzeRejectedReport(s);
 assert.ok(r.findings.some(x=>x.title.includes('Pendências com mais de sete dias')));
 assert.ok(r.findings.some(x=>x.title.includes('setor: Suporte')));
 assert.ok(r.findings.some(x=>x.title.includes('assunto: Conexao')));
 assert.ok(r.findings.some(x=>x.evidence.includes('40 de 100')));
 assert.ok(r.findings.every(x=>x.hypothesis&&x.action&&x.evidence));
 assert.ok(r.limitations.some(x=>x.includes('não é possível afirmar')));
});
test('nenhum dado não gera causalidade inventada',()=>{
 const empty=analyzeRejectedReport(null);
 assert.deepEqual(empty.findings,[]);
 const noAlerts=analyzeRejectedReport({total:10,pending:1,finalized:9,sectors:{},subjects:{}});
 assert.deepEqual(noAlerts.findings,[]);
 assert.match(noAlerts.limitations[0],/Nenhum indicador/);
});
test('diagnóstico limita setores e assuntos e ignora contagens inválidas',()=>{
 const many=Object.fromEntries(Array.from({length:12},(_,i)=>['S'+i,{total:50,pending:40}]));
 const r=analyzeRejectedReport({total:100,pending:0,sectors:many,subjects:many});
 assert.ok(r.findings.length<=12);
 assert.ok(r.findings.filter(x=>x.title.includes('por setor')).length<=4);
 assert.ok(r.findings.filter(x=>x.title.includes('por assunto')).length<=4);
});
test('Gestor e Administrador avaliam e reprovação abre diagnóstico apenas após leitura de volta',()=>{
 assert.match(app,/\['gestor','administrador'\]\.includes\(activeRole\(\)\)/);
 assert.match(app,/function reviewDiagnosis\(\)/);
 assert.match(app,/state\.view='analysis'/);
 assert.match(app,/state\.reviews\.find\(x=>x\.snapshot_id===s\.id\)/);
 assert.match(app,/verified\.decision!==state\.reviewIntent/);
 assert.match(sql,/m\.role IN \('gestor','administrador'\)/);
 assert.match(sql,/MFA_AAL2_REQUIRED/);
 assert.match(sql,/REPORT_NOT_FOUND/);
 assert.match(sql,/reviewed_by/);
});
