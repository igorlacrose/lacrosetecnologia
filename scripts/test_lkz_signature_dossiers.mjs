import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const base=new URL('../admin/client-signature-dossiers.js',import.meta.url);
const source=fs.readFileSync(base,'utf8');
const root=new URL('../supabase/migrations/',import.meta.url);
const fname=fs.readdirSync(root).find(x=>x.endsWith('_lkz_adm_dossie_pre_assinatura_sem_aceite.sql'));
assert.ok(fname,'Dossiê precisa ter migração versionada');
const sql=fs.readFileSync(new URL(fname,root),'utf8');
const app=fs.readFileSync(new URL('../admin/app.js',import.meta.url),'utf8');

class E {
 constructor(tag){
  this.tagName=tag;this.children=[];this.parent=null;this.className='';
  this.dataset={};this.attrs={};this.value='';this.checked=false;this.disabled=false;
  this.isConnected=true;this.textContent='';this.type='';this.open=false;
 }
 append(...elements){for(const el of elements){el.parent=this;this.children.push(el);
  if(this.tagName==='select'&&this.children.length===1)this.value=el.value}}
 replaceChildren(...elements){this.children=[];this.append(...elements)}
 setAttribute(n,v){this.attrs[n]=v}
 querySelector(selector){return find(this,n=>selector==='[data-signature-dossiers]'?
   Object.hasOwn(n.dataset,'signatureDossiers'):false)}
 querySelectorAll(selector){return all(this,n=>selector==='input,select,button'?
   ['input','select','button'].includes(n.tagName):
   selector==='textarea,button'?['textarea','button'].includes(n.tagName):false)}
 focus(){}
}
function find(root,match){for(const c of root.children){
 if(match(c))return c;const sub=find(c,match);if(sub)return sub
}return null}
function all(root,match){let result=[];for(const c of root.children){
 if(match(c))result.push(c);result=result.concat(all(c,match))
}return result}
function label(root,name){return find(root,n=>n.attrs['aria-label']===name)}
function action(root,text){return find(root,n=>n.tagName==='button'&&n.textContent===text)}
function fixture({master=true,quotes=null}={}){
 const window={},document={createElement:tag=>new E(tag)};
 let serial=0;
 const crypto={randomUUID:()=>'11111111-1111-4111-8111-'+String(++serial).padStart(12,'0')};
 vm.runInNewContext(source,{window,document,crypto,setTimeout,clearTimeout,Date,Intl,console});
 const panel=new E('section'),calls=[];
 const records=quotes??[{id:'quote-1',draft_version:2,status:'prepared',
   current:true,eligible:true,dossier:null}];
 const sb={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='lkz_adm_list_signature_dossiers')return {data:{
    signature_enabled:false,customer_accepted:false,
    billing_enabled:false,provisioning_enabled:false,quotes:records
  }};
  if(name==='lkz_adm_prepare_signature_dossier'){
    records[0].eligible=false;
    records[0].dossier={id:'dossier-1',status:'prepared',
      terms_version:args.p_terms_version,document_ref:args.p_document_ref,
      document_sha256:args.p_document_sha256,prepared_at:'2026-11-12T22:00:00Z'};
    return {data:{id:'dossier-1',status:'prepared',already_recorded:false,
      signature_enabled:false,customer_accepted:false,
      billing_enabled:false,provisioning_enabled:false}};
  }
  if(name==='lkz_adm_void_signature_dossier'){
    records[0].dossier.status='void';
    records[0].dossier.void_reason=args.p_reason;
    return {data:{id:'dossier-1',status:'void',already_recorded:false,
      signature_enabled:false,customer_accepted:false}};
  }
  throw Error('Unexpected RPC '+name);
 }};
 return {panel,calls,records,serial:()=>serial,mount:()=>window.LKZSignatureDossiers.mount({
  panel,contact:{id:'contact-test'},sb,confirm:async()=>true,
  isMaster:master,isSessionActive:()=>true
 })};
}
test('sem referência/sha/atestado o botão permanece desativado',async()=>{
 const f=fixture();await f.mount();const root=f.panel.querySelector('[data-signature-dossiers]');
 assert.ok(root);
 assert.equal(f.calls.length,1);
 const prepare=action(root,'Preparar dossiê (sem envio)');
 assert.ok(prepare);
 assert.equal(prepare.disabled,true);
 const version=label(root,'Versão do documento contratual');
 const doc=label(root,'Referência interna do documento');
 const hash=label(root,'Hash SHA-256 do documento');
 const check=find(root,n=>n.tagName==='input'&&n.type==='checkbox');
 version.value='v1';version.oninput();
 doc.value='DOC-2026-0001';doc.oninput();
 hash.value='xyz';hash.oninput();check.checked=true;check.onchange();
 assert.equal(prepare.disabled,true);
 hash.value='a'.repeat(64);hash.oninput();
 assert.equal(prepare.disabled,false);
});
test('MASTER prepara referência sem qualquer envio ou aceite',async()=>{
 const f=fixture();await f.mount();const root=f.panel.querySelector('[data-signature-dossiers]');
 const version=label(root,'Versão do documento contratual');
 const doc=label(root,'Referência interna do documento');
 const hash=label(root,'Hash SHA-256 do documento');
 const check=find(root,n=>n.tagName==='input'&&n.type==='checkbox');
 version.value='v1';version.oninput();
 doc.value='DOC-2026-0001';doc.oninput();
 hash.value='a'.repeat(64);hash.oninput();
 check.checked=true;check.onchange();
 await action(root,'Preparar dossiê (sem envio)').onclick();
 assert.equal(f.calls.filter(c=>c.name==='lkz_adm_prepare_signature_dossier').length,1);
 assert.equal(f.records[0].dossier.status,'prepared');
 assert.ok(find(root,n=>n.className==='signature-state'&&n.textContent.includes('NÃO ASSINADO')));
 assert.ok(f.calls.every(c=>[
   'lkz_adm_list_signature_dossiers',
   'lkz_adm_prepare_signature_dossier',
   'lkz_adm_void_signature_dossier'
 ].includes(c.name)), 'Somente RPCs administrativas de dossiês são permitidas');
});
test('MASTER pode invalidar com motivo; não converte em aceite',async()=>{
 const f=fixture({quotes:[{id:'quote-1',draft_version:2,status:'prepared',current:true,eligible:false,
  dossier:{id:'dossier-1',status:'prepared',terms_version:'v1',document_ref:'DOC-2026-0001',
   document_sha256:'a'.repeat(64),prepared_at:'2026-11-12T22:00:00Z'}}]});
 await f.mount();const root=f.panel.querySelector('[data-signature-dossiers]');
 const reason=find(root,n=>n.tagName==='textarea');
 reason.value='Documento substituído após revisão.';
 await action(root,'Invalidar referência').onclick();
 assert.equal(f.records[0].dossier.status,'void');
 assert.ok(find(root,n=>n.className==='signature-notice'&&n.textContent.includes('Documento substituído')));
 assert.ok(f.calls.every(c=>[
   'lkz_adm_list_signature_dossiers',
   'lkz_adm_prepare_signature_dossier',
   'lkz_adm_void_signature_dossier'
 ].includes(c.name)), 'Somente RPCs administrativas de dossiês são permitidas');
});
test('ADMIN sem MASTER não prepara nem invalida documentos',async()=>{
 const f=fixture({master:false,quotes:[{id:'quote-1',draft_version:1,status:'prepared',
  current:true,eligible:false,dossier:{id:'dossier-1',status:'prepared',
  terms_version:'v1',document_ref:'DOC-2026-0001',
  document_sha256:'a'.repeat(64),prepared_at:'2026-11-12T22:00:00Z'}}]});
 await f.mount();const root=f.panel.querySelector('[data-signature-dossiers]');
 assert.equal(action(root,'Preparar dossiê (sem envio)'),null);
 assert.equal(action(root,'Invalidar referência'),null);
 assert.deepEqual(f.calls.map(x=>x.name),['lkz_adm_list_signature_dossiers']);
});
test('backend bloqueia aceite, pagamento e provisionamento',()=>{
 assert.match(sql,/enable row level security/);
 assert.match(sql,/revoke all on table lkz_adm_private\.signature_dossiers from public,anon,authenticated/);
 assert.match(sql,/lkz_adm_private\.is_master\(\)/);
 assert.match(sql,/lkz_adm_private\.is_operator\(\)/);
 assert.match(sql,/customer_accepted boolean not null default false check\(customer_accepted=false\)/);
 assert.match(sql,/payment_confirmed boolean not null default false check\(payment_confirmed=false\)/);
 assert.match(sql,/signature_enabled boolean not null default false check\(signature_enabled=false\)/);
 assert.match(sql,/provisioning_enabled boolean not null default false check\(provisioning_enabled=false\)/);
 assert.match(sql,/q\.draft_version is distinct from v_draft_version/);
 assert.match(sql,/on conflict do nothing/);
 assert.match(app,/window\.LKZSignatureDossiers\.mount/);
 assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|WebSocket|\.sendMessage\s*\(|\.sendEmail\s*\(|localStorage|sessionStorage/);
});
