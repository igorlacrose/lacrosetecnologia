import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../admin/client-quotes.js',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/migrations/20261112220200_lkz_adm_propostas_versionadas_sem_cobranca.sql',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../admin/app.js',import.meta.url),'utf8');
class Node{
 constructor(tag){this.tagName=tag;this.children=[];this.parent=null;this.className='';
   this.dataset={};this.textContent='';this.isConnected=true;this.disabled=false;this.value='';}
 append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes)}
 setAttribute(key,value){this[key]=value}
 querySelector(sel){return find(this,n=>sel==='[data-client-quotes]'?('clientQuotes' in n.dataset):false)}
 querySelectorAll(sel){return all(this,n=>sel==='button,textarea'?
   ['button','textarea'].includes(n.tagName):false)}
 focus(){}
}
function find(root,pred){for(const c of root.children){
 if(pred(c))return c;const child=find(c,pred);if(child)return child;
}return null}
function all(root,pred){const res=[];function visit(n){for(const c of n.children){
 if(pred(c))res.push(c);visit(c);
}}visit(root);return res}
function button(root,label){return find(root,n=>n.tagName==='button'&&n.textContent===label)}
function fixture({master=true,draft=2,items=2,quotes=[]}={}){
 const window={},document={createElement:tag=>new Node(tag)};
 let id=0;
 const crypto={randomUUID:()=> '22222222-2222-4222-8222-'+String(++id).padStart(12,'0')};
 vm.runInNewContext(source,{window,document,crypto,console,setTimeout,clearTimeout,Intl});
 const panel=new Node('section'),calls=[],state=[...quotes],frozen=[{
  code:'OCA',name:'OCA',setup_cents:189000,recurring_cents:29000,billing_interval:'monthly'
 }];
 const sb={rpc:async(name,args)=>{
   calls.push({name,args});
   if(name==='lkz_adm_list_client_quotes')return {data:{
     draft_version:draft,draft_item_count:items,quotes:state,
     billing_enabled:false,provisioning_enabled:false,customer_acceptance_enabled:false
   }};
   if(name==='lkz_adm_prepare_client_quote'){
     const q={id:'quote-1',draft_version:draft,status:'prepared',
       items:frozen,current_draft:true,setup_total_cents:189000,
       monthly_total_cents:29000,yearly_total_cents:0,
       prepared_at:'2026-11-12T20:00:00Z'};
     state.push(q);
     return {data:{id:'quote-1',status:'prepared',already_recorded:false,
       billing_enabled:false,provisioning_enabled:false,customer_accepted:false}};
   }
   if(name==='lkz_adm_cancel_client_quote'){
     state[0].status='cancelled';state[0].cancel_reason=args.p_reason;
     return {data:{id:'quote-1',status:'cancelled',already_recorded:false,
       billing_enabled:false,provisioning_enabled:false,customer_accepted:false}};
   }
   throw new Error('Unexpected RPC '+name);
 }};
 const mount=()=>window.LKZClientQuotes.mount({
   panel,contact:{id:'client-1'},sb,isMaster:master,confirm:async()=>true,
   isSessionActive:()=>true
 });
 return {panel,calls,state,mount,generated:()=>id};
}
test('apenas MASTER consegue preparar proposta, sem aceite ou cobrança',async()=>{
 const f=fixture();await f.mount();const root=f.panel.querySelector('[data-client-quotes]');
 assert.ok(root);
 const prepare=button(root,'Preparar proposta (sem envio)');
 assert.ok(prepare);assert.equal(prepare.disabled,false);
 assert.equal(f.calls.length,1);
 await prepare.onclick();
 assert.equal(f.state.length,1);
 assert.equal(f.calls[1].name,'lkz_adm_prepare_client_quote');
 assert.equal(f.calls[1].args.p_expected_version,2);
 assert.ok(find(root,n=>n.className==='client-quote-totals'&&n.textContent.includes('1.890,00')));
 assert.equal(button(root,'Preparar proposta (sem envio)').disabled,true);
 assert.equal(f.generated(),1);
 assert.ok(!f.calls.some(x=>/send|charge|provision|dispatch/.test(x.name)));
});
test('não-MASTER consulta mas não prepara nem cancela',async()=>{
 const f=fixture({master:false,draft:2});await f.mount();
 const root=f.panel.querySelector('[data-client-quotes]');
 assert.equal(button(root,'Preparar proposta (sem envio)'),null);
 assert.equal(button(root,'Cancelar proposta'),null);
 assert.equal(f.calls.length,1);
});
test('minuta vazia bloqueia preparação',async()=>{
 const f=fixture({draft:2,items:0});await f.mount();
 const root=f.panel.querySelector('[data-client-quotes]');
 assert.equal(button(root,'Preparar proposta (sem envio)').disabled,true);
});
test('cancelamento mantém histórico e exige justificativa',async()=>{
 const f=fixture();await f.mount();
 const root=f.panel.querySelector('[data-client-quotes]');
 await button(root,'Preparar proposta (sem envio)').onclick();
 const note=find(root,n=>n.tagName==='textarea');
 assert.ok(note);note.value='Cliente pediu revisão da proposta.';
 await button(root,'Cancelar proposta').onclick();
 assert.equal(f.state[0].status,'cancelled');
 assert.equal(f.calls[f.calls.length-2].name,'lkz_adm_cancel_client_quote');
 assert.ok(find(root,n=>n.className==='client-quote-stale'&&
   n.textContent.includes('Cliente pediu revisão')));
 assert.equal(f.state.length,1);
});
test('snapshot imutável e autorização forte ficam no backend',()=>{
 assert.match(sql,/items_snapshot jsonb not null/);
 assert.match(sql,/create unique index client_quotes_unique_version/);
 assert.match(sql,/lkz_adm_private\.is_master\(\)/);
 assert.match(sql,/lkz_adm_private\.is_operator\(\)/);
 assert.match(sql,/status in \('prepared','cancelled'\)/);
 assert.match(sql,/billing_enabled boolean not null default false check\(billing_enabled=false\)/);
 assert.match(sql,/provisioning_enabled boolean not null default false check\(provisioning_enabled=false\)/);
 assert.match(sql,/customer_accepted boolean not null default false check\(customer_accepted=false\)/);
 assert.match(sql,/revoke all on lkz_adm_private\.client_quotes from public,anon,authenticated/);
 assert.match(app,/window\.LKZClientQuotes\.mount/);
 assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|WebSocket|\.sendMessage\s*\(|\.sendEmail\s*\(|\blocalStorage\b/);
});
