
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountGestorSimple,gestorSimpleState} from '../src/gestor-simple.js';

function mockUI(){
 const nodes=new Map();
 const node=sel=>{
   if(!nodes.has(sel))nodes.set(sel,{innerHTML:'',textContent:'',value:'',listeners:{},addEventListener(event,fn){this.listeners[event]=fn;}});
   return nodes.get(sel);
 };
 const root={innerHTML:'',listeners:{},querySelector:node,addEventListener(evt,fn){this.listeners[evt]=fn;}};
 const host={attachShadow({mode}){assert.equal(mode,'open');return root;}};
 return {host,root,node};
}
function fixture(overrides={}){
 return {role:'gestor',mfaConfirmed:true,email:'test@example.invalid',tenantId:'tenant-a',review:null,tenants:[],
  snapshot:{id:'snapshot-a',source:'IXC',earliest:'2026-01-01',latest:'2026-01-31',total:100,finalized:76,pending:24,pendingOlder7d:9,
   cities:{'Jequié':{total:60,finalized:50,pending:10},'Ipiaú':{total:40,finalized:26,pending:14}},
   sectors:{'Suporte':{total:70,finalized:55,pending:15},'NOC':{total:30,finalized:21,pending:9}}},
  ...overrides};
}
const handlers={review:async()=>{},export:()=>{},refresh:()=>{},logout:()=>{},switchTenant:()=>{},classic:()=>{}};

test('gestor exige MFA AAL2 e vínculo de gestor/admin, não admite master',()=>{
 for(const model of [fixture({mfaConfirmed:false}),fixture({role:'master'}),fixture({role:'financeiro'})]){
  assert.throws(()=>mountGestorSimple(mockUI().host,model,handlers),/MFA e vínculo/);
 }
});

test('layout aprovado preserva botões grandes sem sidebar e exibe indicadores reais do servidor',()=>{
 const ui=mockUI();
 mountGestorSimple(ui.host,fixture(),handlers);
 assert.match(ui.root.innerHTML,/class="action-grid"/);
 assert.doesNotMatch(ui.root.innerHTML,/class="sidebar"/);
 assert.match(ui.node('#content').innerHTML,/100/);
 assert.match(ui.node('#content').innerHTML,/76%/);
 assert.match(ui.node('#content').innerHTML,/24/);
 assert.match(ui.node('#content').innerHTML,/Ver atendimentos/);
 assert.doesNotMatch(ui.node('#content').innerHTML,/fictíci|simulad/i);
});

test('cidade e setor são filtros independentes: nunca inventa interseção',()=>{
 const ui=mockUI(); mountGestorSimple(ui.host,fixture(),handlers);
 ui.node('#city').listeners.change({target:{value:'Jequié'}});
 assert.equal(ui.node('#sector').value,'');
 assert.match(ui.node('#content').innerHTML,/60/);
 assert.match(ui.node('#content').innerHTML,/50/);
 assert.match(ui.node('#content').innerHTML,/—/);
 ui.node('#sector').listeners.change({target:{value:'NOC'}});
 assert.equal(ui.node('#city').value,'');
 assert.match(ui.node('#content').innerHTML,/30/);
 assert.match(ui.node('#content').innerHTML,/21/);
});

test('sem relatório: não apresenta dados fictícios nem decisões no servidor',()=>{
 const ui=mockUI();mountGestorSimple(ui.host,fixture({snapshot:null}),handlers);
 assert.match(ui.node('.preview-tag').textContent,/SEM RELATÓRIOS/);
 assert.match(ui.node('#content').innerHTML,/Aguardando indicadores da empresa/);
 assert.match(ui.node('#content').innerHTML,/Atualizar indicadores/);
 assert.doesNotMatch(ui.node('#content').innerHTML,/class="metric-grid"/);
});

test('visão clássica e configurações sensíveis são preservadas como alternativa',()=>{
 const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 const auth=readFileSync(new URL('../src/cloud-auth.js',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 assert.match(app,/SIMPLE_GESTOR_DEFAULT=true/);
 assert.match(app,/function simpleManagerMode\(\)\{return !classicManagerUi && executiveMode\(\) && isMfaLinked\(\);\}/);
 assert.match(app,/data-lkz-build|dataset\.lkzBuild/);
 assert.match(app,/sw\.js\?v=137/);
 assert.match(app,/updateViaCache:'none'/);
 assert.match(app,/data-manager-simple/);
 assert.match(app,/classicManagerUi=true/);
 assert.match(app,/submitExecutiveReview\(reason\)/);
 assert.match(app,/cloud\.reviewSnapshot\(tenantId,s\.id,decision,reason\)/);
 assert.match(app,/function executiveDashboard\(/);
 assert.match(sw,/lkz-isp-static-v137/);
 assert.match(sw,/gestor-simple\.css/);
 assert.match(auth,/this\.aal!=='aal2'/);
});

test('no CSV, nenhum cruzamento de cidade/setor é inventado e valores perigosos são escapados',()=>{
 const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(app,/if\(city&&sector\)/);
 assert.match(app,/Não calculável/);
 assert.match(app,/csvValue/);
 assert.match(app,/\^\[\\s\]\*\[=\+@-\]/);
});
