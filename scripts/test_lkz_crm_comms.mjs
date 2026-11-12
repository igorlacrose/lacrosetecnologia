import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../admin/crm-comms.js',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/migrations/20261112175129_lkz_adm_crm_rascunhos_resposta_manual.sql',import.meta.url),'utf8');

class Node {
  constructor(tag){
    this.tagName=tag;this.children=[];this.parent=null;this.className='';
    this.dataset={};this.attributes={};this.value='';this.textContent='';
    this.disabled=false;this.isConnected=true;
  }
  append(...nodes){
    for(const node of nodes){
      if(node.parent)node.parent.children=node.parent.children.filter(x=>x!==node);
      node.parent=this;this.children.push(node);
      if(this.tagName==='select'&&!this.value&&node.tagName==='option')this.value=node.value;
    }
  }
  prepend(node){node.parent=this;this.children.unshift(node)}
  before(node){
    assert.ok(this.parent,'Node must be attached');
    node.parent=this.parent;
    const i=this.parent.children.indexOf(this);
    this.parent.children.splice(i,0,node);
  }
  setAttribute(name,value){this.attributes[name]=value}
  focus(){}
  select(){}
  remove(){
    if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);
    this.parent=null;
  }
  querySelector(selector){
    function match(node){
      if(selector.startsWith('.'))return node.className.split(' ').includes(selector.slice(1));
      if(selector==='[data-crm-reply]')return 'crmReply' in node.dataset;
      if(selector==='[data-lead-events]')return 'leadEvents' in node.dataset;
      return false;
    }
    const visit=(node)=>{
      for(const child of node.children){
        if(match(child))return child;
        const nested=visit(child);
        if(nested)return nested;
      }
      return null;
    };
    return visit(this);
  }
}
function walk(root,match){
  if(match(root))return root;
  for(const child of root.children){const v=walk(child,match);if(v)return v}
  return null;
}

test('componente CRM monta e executa fluxo manual sem envio',async()=>{
  const window={};
  const created=[];
  const document={createElement:tag=>{const n=new Node(tag);created.push(n);return n}};
  let clipboard='',sentCalls=0;
  const navigator={clipboard:{writeText:async value=>{clipboard=value}}};
  vm.runInNewContext(source,{window,document,navigator,console});
  assert.equal(typeof window.LKZCrmComms.mount,'function');
  const panel=new Node('section');
  const history=new Node('div');history.className='lead-history';
  const events=new Node('div');events.dataset.leadEvents='';
  history.append(events);panel.append(history);
  const draftRecords=new Map();
  const seen=[];
  const fakeRpc={
    rpc:async(name,args)=>{
      seen.push(name);
      if(name==='lkz_adm_crm_list_reply_drafts')return {data:[...draftRecords.values()]};
      if(name==='lkz_adm_crm_save_reply_draft'){
        const old=draftRecords.get(args.p_channel);
        assert.equal(args.p_expected_version,old?.version||0);
        const next={lead_id:args.p_lead,channel:args.p_channel,body:args.p_body,
          version:(old?.version||0)+1,updated_at:'2026-11-12T18:00:00Z'};
        draftRecords.set(args.p_channel,next);return {data:next};
      }
      if(name==='lkz_adm_crm_delete_reply_draft'){
        draftRecords.delete(args.p_channel);return {data:true};
      }
      if(name==='lkz_adm_crm_log_manual_contact')
        return {data:{event_id:8,registered:true,sent_by_system:false}};
      sentCalls++;throw Error('RPC desconhecida: '+name);
    }
  };
  await window.LKZCrmComms.mount({
    panel,lead:{id:'lead-1'},contact:{person_name:'Cliente de teste',consent_contact:false},
    sb:fakeRpc,confirm:async()=>true,isSessionActive:()=>true,formatDate:()=> '12/11/2026'
  });
  const section=panel.querySelector('[data-crm-reply]');
  assert.ok(section);
  const message=walk(section,x=>x.tagName==='textarea'&&x.attributes['aria-label']==='Rascunho da resposta comercial');
  const summary=walk(section,x=>x.tagName==='textarea'&&x.attributes['aria-label']==='Resumo do contato já realizado');
  const save=walk(section,x=>x.tagName==='button'&&x.textContent==='Salvar rascunho');
  const copy=walk(section,x=>x.tagName==='button'&&x.textContent==='Copiar texto');
  const log=walk(section,x=>x.tagName==='button'&&x.textContent==='Registrar contato realizado');
  const del=walk(section,x=>x.tagName==='button'&&x.textContent==='Excluir rascunho');
  assert.ok(message&&summary&&save&&copy&&log&&del);
  message.value='Olá! Podemos conversar sobre sua necessidade?';
  message.oninput();
  await save.onclick();
  assert.equal(draftRecords.get('whatsapp').version,1);
  await copy.onclick();
  assert.equal(clipboard,message.value);
  summary.value='Conversei com o cliente por telefone.';
  summary.oninput();
  await log.onclick();
  assert.equal(events.children.length,1);
  await del.onclick();
  assert.equal(draftRecords.size,0);
  assert.equal(sentCalls,0);
  assert.ok(seen.includes('lkz_adm_crm_log_manual_contact'));
  assert.ok(!seen.some(x=>/send|dispatch|deliver/i.test(x)));
});

test('segurança do backend e ausência de APIs de envio externo',()=>{
  assert.match(migration,/create table if not exists lkz_adm_private\.crm_reply_drafts/i);
  assert.match(migration,/enable row level security/i);
  assert.match(migration,/revoke all on table lkz_adm_private\.crm_reply_drafts from public,anon,authenticated/i);
  assert.match(migration,/lkz_adm_private\.is_operator\(\)/);
  assert.match(migration,/p_expected_version/);
  assert.match(migration,/operator_audit/);
  assert.doesNotMatch(source,/fetch\(|XMLHttpRequest|WebSocket|sendMessage|sendEmail|localStorage|sessionStorage/);
  assert.match(source,/sent_by_system!==false/);
});
