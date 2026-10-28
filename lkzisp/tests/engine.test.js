import test from 'node:test';import assert from 'node:assert/strict';
import {buildSnapshot,detectMapping,cleanSubject,cleanCity,radarItems,calculateCost,parseDate} from '../src/engine.js';
const headers=['ID','Status','Cliente','Assunto','Setor','Cidade','Abertura','Fechamento','Senha MD5 PPPoE/Hotspot','Mensagem'];
const map=detectMapping(headers);
const rows=[
 [123,'Finalizada','Fulano de Tal','RT-SEM CONEXÃO','Técnicos Jequié','Jequié',46318.1,46318.3,'123456','CPF 000.000.000-00'],
 [124,'Encaminhada','Maria Souza','RT - MANUNTENÇÃO DB ALTO','Técnicos Itagiba','Itagibá',46310.2,null,'abcd','senha'],
 [125,'Aberta','José Pereira','RT - MANUNTENÇÃO DB ALTO','Técnicos Itagiba','Itagibá',46315,null,'abc','telefone']];

test('mapeamento detecta apenas campos aprovados',()=>{assert.equal(map.Status,1);assert.equal(map.Assunto,3);assert.equal(map.Abertura,6);assert.equal(map.Cliente,undefined);});
test('motor retorna somente agregados, sem senha e PII',()=>{
 const s=buildSnapshot(rows,map);assert.equal(s.total,3);assert.equal(s.pending,2);assert.equal(s.finalized,1);assert.equal(s.subjects['DB alto'].pending,2);
 const j=JSON.stringify(s);for(const secret of ['Fulano','Maria Souza','José Pereira','123456','CPF 000','telefone'])assert.equal(j.includes(secret),false,secret);
 assert.equal(s.referenceDate,'2026-10-23');
});
test('datas, categorias e custo',()=>{assert.equal(cleanSubject('RT-LENTIDÃO'),'Lentidão');assert.equal(cleanCity('jequie'),'Jequié');assert.ok(parseDate(46318)>0);assert.equal(calculateCost({hours:'1,5',hourCost:'32',travel:'18',materials:'12',overhead:'0'}),78);});
test('radares nunca declaram custo monetário',()=>{const s=buildSnapshot(Array.from({length:15},(_,i)=>['Encaminhada','','','RT - MANUNTENÇÃO DB ALTO','Técnicos Itagiba','Itagibá',46300+i/100,null,'','']),map);const signals=radarItems(s);assert.ok(signals.length>0);assert.equal(JSON.stringify(signals).includes('R$'),false);});

test('CSV separador ; e textos entre aspas',async()=>{
 const {parseCsv}=await import('../src/importer.js');
 const p=parseCsv('Status;Assunto;Abertura\nFinalizada;"RT-SEM CONEXÃO";46318\nAberta;"FN-ENTREGA DE BOLETO";46319\n');
 assert.equal(p.headers.length,3);assert.equal(p.rows.length,2);assert.equal(p.rows[0][1],'RT-SEM CONEXÃO');
 const snap=buildSnapshot(p.rows,detectMapping(p.headers));assert.equal(snap.total,2);assert.equal(snap.pending,1);
});
