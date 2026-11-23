'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const app=fs.readFileSync('admin/app.js','utf8');
const start=app.indexOf('function siteInboxEntries(');
const end=app.indexOf('function overview(',start);
assert.ok(start>0&&end>start,'A seleção da fila é uma função independente');
const scope=vm.createContext({Date,Set,String});
vm.runInContext(app.slice(start,end),scope);
const list=vm.runInContext('siteInboxEntries',scope);

const data={
  leads:[
    {id:'lead-01',source:'website_agent',status:'new',name:'Sem conversa',
      contact:'—',updated_at:'2026-11-12T10:00:00Z'},
    {id:'lead-01',source:'website_agent',status:'new',name:'Duplicado de consulta',
      updated_at:'2026-11-12T10:00:00Z'},
    {id:'lead-02',source:'website_agent',status:'human_review',name:'Com atendimento',
      contact:'contato@exemplo.com',updated_at:'2026-11-13T12:00:00Z'},
    {id:'lead-03',source:'website_agent',status:'archived',name:'Arquivada'},
    {id:'lead-04',source:'website_agent',status:'won',name:'Fechada'},
    {id:'lead-05',source:'manual',status:'new',name:'Origem diferente'}
  ],
  threads:[{id:'conversa-01',lead_id:'lead-02',folder:'active'}],
  loadMeta:{partialConversations:false}
};
const entries=list(data);
assert.equal(entries.length,2,'Entradas do site abertas sem duplicidade por ID');
assert.equal(entries[0].id,'lead-02','Mais recentes aparecem primeiro');
assert.equal(entries[0].hasConversation,true,'Atendimento vinculado identificado');
assert.equal(entries[1].id,'lead-01','Lead sem conversa continua na fila');
assert.equal(entries[1].hasConversation,false,'Conversa ausente não é inventada');
assert.equal(entries[1].conversationLoadPartial,false);

const partial=list({...data,loadMeta:{partialConversations:true}});
assert.equal(partial.find(x=>x.id==='lead-01').conversationLoadPartial,true,
  'Não declarar ausência de conversa quando o carregamento é parcial');

const overview=app.slice(app.indexOf('function overview('),app.indexOf('function commercial('));
assert.match(overview,/data-site-inbox-lead/,'Fila abre ficha pelo ID da oportunidade');
assert.match(overview,/openOpportunity\(button\.dataset\.siteInboxLead\)/);
assert.match(overview,/esc\(item\.name\)/,'Nome do contato é escapado no HTML');
assert.match(overview,/esc\(item\.contact\)/,'Contato é escapado no HTML');
assert.match(overview,/siteInboxEntries\(state\)/,'Fila usa dados da sessão');
assert.match(overview,/Gerenciar todas as oportunidades/);

const management=app.slice(app.indexOf('async function showOpportunity('),
  app.indexOf('const dateLabel=',app.indexOf('async function showOpportunity(')));
assert.match(management,/data-restore-lead/,'Oportunidade arquivada mostra restauração');
assert.match(management,/data-archive-lead/,'Arquivamento existente é preservado');
assert.match(management,/lkz_adm_update_lead/,'Restauração usa RPC auditada existente');
assert.match(management,/form\.requestSubmit\(\)/,'Restauração segue submissão segura já existente');

const html=fs.readFileSync('admin/index.html','utf8');
assert.match(html,/app\.js\?v=20261113-fila-1/,'Cache do app atualizado');
const catalog=app.slice(app.indexOf('const systemCatalog='),app.indexOf('const esc='));
assert.match(catalog,/LibertyOS/);
assert.match(catalog,/BarbarOS/);
assert.equal((catalog.match(/name:/g)||[]).length,2);
console.log('PASS: fila do site deduplicada, leads sem histórico, restauração e vitrine preservada.');
