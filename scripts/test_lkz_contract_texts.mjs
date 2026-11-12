import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../admin/client-contract-texts.js',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/migrations/20261112231933_lkz_adm_contrato_textual_privado_sha_servidor.sql',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../admin/app.js',import.meta.url),'utf8');
class Node{
 constructor(tag){
  this.tagName=tag;this.className='';this.children=[];this.parent=null;
  this.dataset={};this.attrs={};this.textContent='';this.disabled=false;
  this.value='';this.isConnected=true;
 }
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node)}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes)}
 setAttribute(name,value){this.attrs[name]=value}
 querySelector(selector){return find(this,n=>selector==='[data-contract-texts]'?
  ('contractTexts' in n.dataset):false)}
 querySelectorAll(selector){return all(this,n=>selector==='button'&&n.tagName==='button')}
}
function find(root,check){for(const node of root.children){
 if(check(node))return node;const sub=find(node,check);if(sub)return sub;
}return null}
function all(root,check){const result=[];for(const node of root.children){
 if(check(node))result.push(node);result.push(...all(node,check));
}return result}
function button(root,name){return find(root,n=>n.tagName==='button'&&n.textContent===name)}
function fixture({master=true,quotes,readError=false}={}){
 const panel=new Node('section'),window={};
 const document={createElement:tag=>new Node(tag)};
 let seq=0;
 const crypto={randomUUID:()=>'11111111-2222-4333-8444-'+String(++seq).padStart(12,'0')};
 vm.runInNewContext(source,{window,document,crypto,console});
 const rows=quotes??[{id:'quote-test',status:'prepared',draft_version:2,
   current_draft:true,can_prepare:true,document:null}];
 const calls=[];
 const sb={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='lkz_adm_list_contract_text_previews')return {data:{
   quotes:rows,legal_approved:false,signature_enabled:false,billing_enabled:false,
   provisioning_enabled:false
  }};
  if(name==='lkz_adm_generate_contract_text_preview'){
   rows[0].can_prepare=false;
   rows[0].document={id:'doc-1',status:'internal_review',
     document_ref:'CT-LKZ-TEST',content_sha256:'a'.repeat(64)};
   return {data:{id:'doc-1',document_ref:'CT-LKZ-TEST',sha256:'a'.repeat(64),
     status:'internal_review',legal_approved:false,signature_enabled:false,
     billing_enabled:false,provisioning_enabled:false,already_recorded:false}};
  }
  if(name==='lkz_adm_read_contract_text_preview'){
    if(readError)return {error:{code:'40001'}};
    return {data:{id:'doc-1',document_ref:'CT-LKZ-TEST',
      content_sha256:'a'.repeat(64),text:'MINUTA INTERNA, NÃO ASSINADO',
      legal_approved:false,signature_enabled:false,billing_enabled:false,
      provisioning_enabled:false}};
  }
  throw Error('Unknown RPC '+name);
 }};
 return {panel,calls,seq:()=>seq,mount:()=>window.LKZContractTexts.mount({
  panel,contact:{id:'contact-test'},sb,isMaster:master,confirm:async()=>true,
  isSessionActive:()=>true
 })};
}
test('MASTER gera minuta e consulta somente após ação explícita',async()=>{
 const f=fixture();await f.mount();
 const root=f.panel.querySelector('[data-contract-texts]');
 assert.ok(root);
 assert.deepEqual(f.calls.map(x=>x.name),['lkz_adm_list_contract_text_previews']);
 const make=button(root,'Gerar minuta para revisão (sem envio)');
 assert.ok(make);
 await make.onclick();
 assert.equal(f.calls[1].name,'lkz_adm_generate_contract_text_preview');
 assert.equal(f.calls[1].args.p_quote,'quote-test');
 assert.equal(f.seq(),1);
 const view=button(root,'Consultar texto privado');
 assert.ok(view);
 await view.onclick();
 assert.equal(f.calls[3].name,'lkz_adm_read_contract_text_preview');
 const text=find(root,n=>n.tagName==='textarea');
 assert.equal(text.value,'MINUTA INTERNA, NÃO ASSINADO');
 assert.equal(text.readOnly,true);
 assert.ok(!f.calls.some(c=>/send|charge|provision|accept/.test(c.name)));
});
test('ADMIN não prepara, mas pode consultar documento existente',async()=>{
 const rows=[{id:'q1',status:'prepared',draft_version:1,
   current_draft:true,can_prepare:false,document:{
     id:'doc-1',document_ref:'CT-LKZ-TEST',content_sha256:'a'.repeat(64)}}];
 const f=fixture({master:false,quotes:rows});await f.mount();
 const root=f.panel.querySelector('[data-contract-texts]');
 assert.equal(button(root,'Gerar minuta para revisão (sem envio)'),null);
 assert.ok(button(root,'Consultar texto privado'));
 await button(root,'Consultar texto privado').onclick();
 assert.equal(f.calls[1].name,'lkz_adm_read_contract_text_preview');
});
test('proposta cancelada/antiga não oferece botão de geração',async()=>{
 const rows=[{id:'q1',status:'cancelled',draft_version:1,
   current_draft:false,can_prepare:false,document:null}];
 const f=fixture({quotes:rows});await f.mount();
 const root=f.panel.querySelector('[data-contract-texts]');
 assert.equal(button(root,'Gerar minuta para revisão (sem envio)'),null);
});
test('consulta falha fechada em erro de integridade',async()=>{
 const rows=[{id:'q1',status:'prepared',draft_version:1,
   current_draft:true,can_prepare:false,document:{
     id:'doc-1',document_ref:'CT-LKZ-TEST',content_sha256:'a'.repeat(64)}}];
 const f=fixture({quotes:rows,readError:true});await f.mount();
 const root=f.panel.querySelector('[data-contract-texts]');
 await button(root,'Consultar texto privado').onclick();
 assert.equal(find(root,n=>n.tagName==='textarea'),null);
 assert.ok(find(root,n=>n.className==='contract-texts-status'&&
   n.textContent.includes('40001')));
});
test('segurança e assinatura bloqueada em SQL/JS',()=>{
 assert.match(sql,/enable row level security/);
 assert.match(sql,/revoke all on table lkz_adm_private\.contract_text_previews from public,anon,authenticated/);
 assert.match(sql,/contract_text_immutable/);
 assert.match(sql,/sha256\(convert_to\(v_doc,'UTF8'\)\)/);
 assert.match(sql,/sha256\(convert_to\(a\.content_text,'UTF8'\)\)/);
 assert.match(sql,/lkz_adm_private\.is_master\(\)/);
 assert.match(sql,/lkz_adm_private\.is_operator\(\)/);
 assert.match(sql,/legal_approved boolean not null default false check\(legal_approved=false\)/);
 assert.match(sql,/signature_enabled boolean not null default false check\(signature_enabled=false\)/);
 assert.match(sql,/customer_accepted boolean not null default false check\(customer_accepted=false\)/);
 assert.match(sql,/billing_enabled boolean not null default false check\(billing_enabled=false\)/);
 assert.match(sql,/provisioning_enabled boolean not null default false check\(provisioning_enabled=false\)/);
 assert.match(app,/LKZContractTexts\.mount/);
 assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|WebSocket|\.sendMessage\s*\(|localStorage|sessionStorage/);
});
