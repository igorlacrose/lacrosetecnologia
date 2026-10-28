import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSnapshot,detectMapping} from '../src/engine.js';
import {evaluateDataQuality} from '../src/quality.js';
const map=detectMapping(['Status','Assunto','Setor','Abertura','Fechamento']);
const fixture=[['Finalizada','RT-SEM CONEXÃO','Financeiro',46318,46319],['Aberta','RT-SEM CONEXÃO','Financeiro',46318,null]];
test('auditoria não declara precisão financeira com relatório de chamados',()=>{
 const s=buildSnapshot(fixture,map);const q=evaluateDataQuality(s,[s]);
 assert.equal(q.precise,false);
 assert.equal(q.issues.find(i=>i.id==='financial').status,'blocked');
 assert.equal(q.issues.find(i=>i.id==='person').status,'blocked');
 assert.equal(q.issues.find(i=>i.id==='closing').status,'ready');
 assert.equal(q.issues.find(i=>i.id==='trend').status,'blocked');
 assert.deepEqual(s.availableFields,['Status','Assunto','Setor','Abertura','Fechamento']);
});
test('coluna de fechamento ausente é detectada, sem criar data fictícia',()=>{
 const m=detectMapping(['Status','Assunto','Abertura']);const s=buildSnapshot([['Finalizada','Entrega de boleto',46318]],m);
 const q=evaluateDataQuality(s);const closing=q.issues.find(i=>i.id==='closing');
 assert.equal(closing.status,'blocked');assert.ok(closing.missing.some(x=>x.includes('Fechamento')));
});
test('nenhuma fonte nem identificador sensível é emitido pelo checklist',()=>{
 const q=evaluateDataQuality(null);const serialized=JSON.stringify(q);
 assert.equal(q.counts.ready,0);assert.equal(serialized.includes('CPF 000.000.000-00'),false);
 assert.equal(serialized.includes('senha MD5 PPPoE'),false);
});
