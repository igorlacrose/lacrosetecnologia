import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script=fs.readFileSync(new URL('../admin/contact-consent.js',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/migrations/20261112200000_lkz_adm_consentimento_por_canal_com_evidencia.sql',import.meta.url),'utf8');
class N{
 constructor(tag){this.tagName=tag;this.parent=null;this.children=[];this.className='';this.dataset={};this.attrs={};this.value='';
   this.textContent='';this.checked=false;this.disabled=false;this.isConnected=true;}
 append(...items){for(const child of items){child.parent=this;this.children.push(child);
   if(this.tagName==='select'&&!this.value&&child.tagName==='option')this.value=child.value;}}
 after(node){assert.ok(this.parent);const pos=this.parent.children.indexOf(this);this.parent.children.splice(pos+1,0,node);node.parent=this.parent}
 setAttribute(k,v){this.attrs[k]=v}
 replaceChildren(...items){this.children=[];this.append(...items)}
 querySelector(selector){return find(this,n=>
   selector==='[data-contact-consents]'?'contactConsents' in n.dataset:
   selector==='.client-history'?n.className==='client-history':
   selector==='button'?n.tagName==='button':
   selector==='input[type="checkbox"]'?n.tagName==='input'&&n.type==='checkbox':
   selector==='input[type="text"]'?n.tagName==='input'&&n.type==='text':
   selector==='input[type="datetime-local"]'?n.tagName==='input'&&n.type==='datetime-local':false)}
 querySelectorAll(selector){return all(this,n=>selector==='button,textarea'?
   ['button','textarea'].includes(n.tagName):
   selector==='button,input,select'?['button','input','select'].includes(n.tagName):false)}
 focus(){}
}
function find(root,match){for(const child of root.children){if(match(child))return child;
  const found=find(child,match);if(found)return found}return null}
function all(root,match){const found=[];function visit(n){for(const child of n.children){
  if(match(child))found.push(child);visit(child)}}visit(root);return found}
const byLabel=(root,label)=>find(root,x=>x.attrs['aria-label']===label);
const byText=(root,label)=>find(root,x=>x.tagName==='button'&&x.textContent===label);
function harness({isMaster=true}={}){
 const window={};const document={createElement:tag=>new N(tag)};
 let id=0;const crypto={randomUUID:()=> '11111111-2222-4333-8444-'+String(++id).padStart(12,'0')};
 vm.runInNewContext(script,{window,document,crypto,console});
 const panel=new N('section'),history=new N('section');history.className='client-history';panel.append(history);
 const current={},events=[],calls=[];
 const sb={rpc:async(name,args)=>{
   calls.push({name,args});
   if(name==='lkz_adm_list_contact_consents')return {data:{contact_id:args.p_contact,
     current:{...current},history:[...events].reverse(),delivery_enabled:false}};
   if(name==='lkz_adm_grant_contact_consent'){
     const event={id:events.length+1,channel:args.p_channel,action:'grant',
       method:args.p_method,proof_ref:args.p_proof_ref,
       recorded_at:'2026-11-12T19:00:00Z',observed_at:args.p_observed_at};
     events.push(event);current[args.p_channel]={status:'grant',recorded_at:event.recorded_at};
     return {data:{status:'grant',id:event.id,already_recorded:false,delivery_enabled:false}};
   }
   if(name==='lkz_adm_revoke_contact_consent'){
     const event={id:events.length+1,channel:args.p_channel,action:'revoke',reason:args.p_reason,
       recorded_at:'2026-11-12T19:02:00Z'};
     events.push(event);current[args.p_channel]={status:'revoke',recorded_at:event.recorded_at};
     return {data:{status:'revoke',id:event.id,already_recorded:false,delivery_enabled:false}};
   }
   throw Error('Unexpected RPC '+name);
 }};
 return {panel,calls,events,current,mount:()=>window.LKZContactConsents.mount({
   panel,contact:{id:'contact-test',name:'Cliente teste'},sb,isMaster,
   confirm:async()=>true,isSessionActive:()=>true,formatDate:()=> '12/11'
 })};
}
test('MASTER registra autorização por canal com evidência e pode revogar',async()=>{
 const x=harness();await x.mount();const manager=x.panel.querySelector('[data-contact-consents]');
 assert.ok(manager);
 const ref=byLabel(manager,'Identificador interno do comprovante');
 const date=byLabel(manager,'Data da manifestação comprovada');
 const checked=find(manager,n=>n.tagName==='input'&&n.type==='checkbox');
 const method=byLabel(manager,'Origem da comprovação');
 const grant=byText(manager,'Registrar autorização');
 assert.ok(ref&&date&&checked&&method&&grant);
 assert.equal(grant.disabled,true);
 ref.value='DOC-2026-001';ref.oninput();
 date.value='2026-11-12T19:00';date.oninput();
 checked.checked=true;checked.onchange();
 assert.equal(grant.disabled,false);
 await grant.onclick();
 assert.equal(x.events.length,1);
 assert.equal(x.events[0].channel,'whatsapp');
 assert.equal(x.current.whatsapp.status,'grant');
 assert.equal(x.current.email,undefined);
 const card=find(manager,n=>n.className==='consent-active');
 assert.ok(card);
 const reason=byLabel(manager,'Motivo da revogação no WhatsApp');
 assert.ok(reason);
 reason.value='Solicitação expressa do titular.';
 const revoke=byText(manager,'Revogar autorização');
 await revoke.onclick();
 assert.equal(x.events.length,2);
 assert.equal(x.current.whatsapp.status,'revoke');
 assert.ok(x.calls.some(c=>c.name==='lkz_adm_grant_contact_consent'));
 assert.ok(x.calls.some(c=>c.name==='lkz_adm_revoke_contact_consent'));
 assert.ok(!x.calls.some(c=>/send|deliver|dispatch/.test(c.name)));
});
test('operador não-MASTER pode registrar oposição mas não conceder',async()=>{
 const x=harness({isMaster:false});await x.mount();const manager=x.panel.querySelector('[data-contact-consents]');
 assert.equal(byText(manager,'Registrar autorização'),null);
 const reason=byLabel(manager,'Motivo da revogação no E-mail');
 reason.value='Oposição expressa do titular.';
 const buttons=all(manager,n=>n.tagName==='button'&&n.textContent==='Registrar oposição');
 assert.equal(buttons.length,2);
 await buttons[1].onclick();
 assert.equal(x.current.email.status,'revoke');
 assert.equal(x.calls.filter(x=>x.name==='lkz_adm_grant_contact_consent').length,0);
});
test('sem prova e confirmação, grant fica bloqueado',async()=>{
 const x=harness();await x.mount();const root=x.panel.querySelector('[data-contact-consents]');
 const grant=byText(root,'Registrar autorização');
 assert.equal(grant.disabled,true);
 assert.equal(x.events.length,0);
});
test('autorização não é estado global nem envio automático',()=>{
 assert.match(migration,/contact_consent_events/);
 assert.match(migration,/lkz_adm_private\.is_master\(\)/);
 assert.match(migration,/lkz_adm_private\.is_operator\(\)/);
 assert.match(migration,/revoke all on table lkz_adm_private\.contact_consent_events from public,anon,authenticated/i);
 assert.match(migration,/e\.contact_id=p\.contact_id and e\.channel=p\.channel/);
 assert.match(migration,/delivery_enabled',false/);
 const scoped=fs.readFileSync(new URL('../supabase/migrations/20261112201250_lkz_adm_consentimento_vinculado_destino.sql',import.meta.url),'utf8');
 const newer=fs.readFileSync(new URL('../supabase/migrations/20261112201451_lkz_adm_nova_prova_apos_troca_destino.sql',import.meta.url),'utf8');
 assert.match(scoped,/recipient_snapshot/);
 assert.match(scoped,/v_consent_recipient is distinct from v_current/);
 assert.match(scoped,/then 'stale'/);
 assert.match(newer,/p_observed_at<=v_contact.updated_at/);
 assert.match(script,/Desatualizada após alteração do destino/);
 assert.doesNotMatch(script,/\bfetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket|\.sendMessage\s*\(|\.sendEmail\s*\(|\blocalStorage\b/);
});
