import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../admin/crm-previews.js',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/migrations/20261112192332_lkz_adm_previa_revisao_comercial_sem_envio.sql',import.meta.url),'utf8');

class Node{
  constructor(tag){
    this.tagName=tag;this.children=[];this.parent=null;this.className='';
    this.dataset={};this.attrs={};this.value='';this.textContent='';
    this.disabled=false;this.isConnected=true;
  }
  append(...children){
    for(const child of children){
      if(child.parent)child.parent.children=child.parent.children.filter(x=>x!==child);
      this.children.push(child);child.parent=this;
      if(this.tagName==='select'&&!this.value&&child.tagName==='option')this.value=child.value;
    }
  }
  before(node){
    assert.ok(this.parent);
    const i=this.parent.children.indexOf(this);
    node.parent=this.parent;this.parent.children.splice(i,0,node);
  }
  replaceChildren(...nodes){this.children=[];this.append(...nodes)}
  setAttribute(name,value){this.attrs[name]=value}
  focus(){}
  querySelector(selector){
    return find(this,x=>selector==='.lead-history'?x.className.split(' ').includes('lead-history'):
      selector==='[data-crm-preview]'?'crmPreview' in x.dataset:false);
  }
  querySelectorAll(selector){
    const found=[];
    const walk=node=>{
      for(const child of node.children){
        if(selector==='button, textarea'&&['button','textarea'].includes(child.tagName))found.push(child);
        walk(child);
      }
    };
    walk(this);return found;
  }
}
function find(root,pred){
  for(const child of root.children){
    if(pred(child))return child;
    const nested=find(child,pred);if(nested)return nested;
  }
  return null;
}
const locate=(root,label)=>find(root,node=>node.tagName==='button'&&node.textContent===label);

function setup({isMaster,consent,drafts,stall=false}){
  const lead={id:'lead-test',contact_id:'contact-test'};
  const contact={id:'contact-test',person_name:'Cliente teste',email:'cliente@example.com',
    phone:'73 99999-9999',consent_contact:consent,
    consent_at:consent?'2026-11-12T15:00:00Z':null};
  const window={};
  const document={createElement:tag=>new Node(tag)};
  const crypto={randomUUID:()=> 'a0000000-bbbb-4333-8555-666666666666'};
  const timing=stall?{
    setTimeout:callback=>{queueMicrotask(callback);return 1;},
    clearTimeout:()=>{}
  }:{};
  vm.runInNewContext(source,{window,document,crypto,console,...timing});
  const panel=new Node('section');
  const history=new Node('section');history.className='lead-history';
  panel.append(history);
  const calls=[];
  const saved=drafts??[{channel:'whatsapp',version:1,body:'Olá, cliente.'}];
  let previews=[];
  const sb={rpc:async(name,args)=>{
    calls.push(name);
    if(stall&&name==='lkz_adm_crm_list_message_previews')
      return new Promise(()=>{});
    if(name==='lkz_adm_crm_list_reply_drafts')return {data:saved};
    if(name==='lkz_adm_crm_list_message_previews')return {data:previews};
    if(name==='lkz_adm_crm_submit_message_preview'){
      if(!previews.length)previews=[{id:args.p_id,channel:'whatsapp',
        status:'pending',recipient:'73999999999',body:saved[0].body,draft_version:1,
        consent_ready:consent,recipient_current:true,draft_current:true,
        requested_at:'2026-11-12T18:00:00Z',delivery_enabled:false}];
      return {data:{id:args.p_id,status:'pending',delivery_enabled:false}};
    }
    if(name==='lkz_adm_crm_review_message_preview'){
      previews[0].status=args.p_action==='approve'?'approved':'rejected';
      return {data:{id:args.p_id,status:previews[0].status,delivery_enabled:false}};
    }
    throw Error('Unexpected RPC:'+name);
  }};
  return {panel,sb,calls,mount:window.LKZCrmPreviews.mount,lead,contact,
    updateReadiness:change=>{for(const p of previews)Object.assign(p,change);}};
}

test('sem consentimento pode preparar, mas não aprovar nem enviar',async()=>{
  const t=setup({isMaster:true,consent:false});
  await t.mount({panel:t.panel,lead:t.lead,contact:t.contact,sb:t.sb,isMaster:true,
    confirm:async()=>true,isSessionActive:()=>true,formatDate:()=> '12/11'});
  const box=t.panel.querySelector('[data-crm-preview]');
  assert.ok(box);
  await locate(box,'Solicitar revisão').onclick();
  const approve=locate(box,'Aprovar sem enviar');
  assert.ok(approve);
  assert.equal(approve.disabled,true);
  assert.ok(find(box,x=>x.className==='crm-preview-disabled'&&x.textContent.includes('DESABILITADO')));
  assert.ok(!t.calls.some(x=>/send|deliver|dispatch/i.test(x)));
  assert.ok(t.calls.includes('lkz_adm_crm_submit_message_preview'));
});

test('com consentimento MASTER aprova e transporte continua inativo',async()=>{
  const t=setup({isMaster:true,consent:true});
  await t.mount({panel:t.panel,lead:t.lead,contact:t.contact,sb:t.sb,isMaster:true,
    confirm:async()=>true,isSessionActive:()=>true,formatDate:()=> '12/11'});
  const box=t.panel.querySelector('[data-crm-preview]');
  await locate(box,'Solicitar revisão').onclick();
  const approve=locate(box,'Aprovar sem enviar');
  assert.equal(approve.disabled,false);
  await approve.onclick();
  assert.ok(t.calls.includes('lkz_adm_crm_review_message_preview'));
  assert.ok(!t.calls.some(x=>/send|deliver|dispatch/i.test(x)));
  assert.ok(find(box,x=>x.className==='crm-preview-title'&&x.textContent.includes('NÃO enviada')));
});

test('operação não-master não possui botão de aprovação',async()=>{
  const t=setup({isMaster:false,consent:true});
  await t.mount({panel:t.panel,lead:t.lead,contact:t.contact,sb:t.sb,isMaster:false,
    confirm:async()=>true,isSessionActive:()=>true,formatDate:()=> '12/11'});
  const box=t.panel.querySelector('[data-crm-preview]');
  await locate(box,'Solicitar revisão').onclick();
  assert.equal(locate(box,'Aprovar sem enviar'),null);
});

test('backend nega acesso direto e não implementa transporte',()=>{
  assert.match(migration,/enable row level security/i);
  assert.match(migration,/revoke all on table lkz_adm_private\.crm_message_previews from public,anon,authenticated/i);
  assert.match(migration,/lkz_adm_private\.is_operator\(\)/);
  assert.match(migration,/lkz_adm_private\.is_master\(\)/);
  assert.match(migration,/delivery_enabled',false/);
  assert.match(migration,/draft_version/);
  assert.doesNotMatch(source,/\bfetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket|\.sendMessage\s*\(|\.sendEmail\s*\(/);
});

test('aprovação antiga mostra bloqueio se consentimento for revogado depois',async()=>{
  const t=setup({isMaster:true,consent:true});
  await t.mount({panel:t.panel,lead:t.lead,contact:t.contact,sb:t.sb,isMaster:true,
    confirm:async()=>true,isSessionActive:()=>true,formatDate:()=> '12/11'});
  const box=t.panel.querySelector('[data-crm-preview]');
  await locate(box,'Solicitar revisão').onclick();
  await locate(box,'Aprovar sem enviar').onclick();
  t.updateReadiness({consent_ready:false});
  await locate(box,'Atualizar revisões').onclick();
  assert.ok(find(box,x=>x.className==='crm-preview-warning'&&
    x.textContent.includes('Aprovação antiga não está mais apta')));
});


test('sem rascunho a tela explica o bloqueio e não fica exibindo Atualizando',async()=>{
  const t=setup({isMaster:true,consent:false,drafts:[]});
  await t.mount({panel:t.panel,lead:t.lead,contact:t.contact,sb:t.sb,isMaster:true,
    confirm:async()=>true,isSessionActive:()=>true,formatDate:()=> '12/11'});
  const box=t.panel.querySelector('[data-crm-preview]');
  const request=locate(box,'Solicitar revisão');
  assert.equal(request.disabled,true);
  assert.ok(locate(box,'Ir para rascunhos'));
  const feedback=find(box,x=>x.className==='crm-preview-feedback');
  assert.ok(feedback.textContent.includes('Registros atualizados'));
  assert.ok(!feedback.textContent.includes('Atualizando'));
  assert.ok(!t.calls.includes('lkz_adm_crm_submit_message_preview'));
  await locate(box,'Atualizar revisões').onclick();
  assert.ok(!feedback.textContent.includes('Atualizando'));
  assert.ok(feedback.textContent.includes('Revisões atualizadas'));
});

test('um rascunho salvo habilita solicitação mesmo sem consentimento, mas não aprovação',async()=>{
  const t=setup({isMaster:true,consent:false});
  await t.mount({panel:t.panel,lead:t.lead,contact:t.contact,sb:t.sb,isMaster:true,
    confirm:async()=>true,isSessionActive:()=>true,formatDate:()=> '12/11'});
  const box=t.panel.querySelector('[data-crm-preview]');
  const request=locate(box,'Solicitar revisão');
  assert.equal(request.disabled,false);
  assert.ok(find(box,x=>x.className==='crm-preview-legal-warning'));
  await request.onclick();
  assert.equal(request.disabled,true);
  assert.equal(locate(box,'Aprovar sem enviar').disabled,true);
});


test('timeout encerra estado Atualizando e oferece nova tentativa',async()=>{
  const t=setup({isMaster:true,consent:false,stall:true});
  await t.mount({panel:t.panel,lead:t.lead,contact:t.contact,sb:t.sb,isMaster:true,
    confirm:async()=>true,isSessionActive:()=>true,formatDate:()=> '12/11'});
  const box=t.panel.querySelector('[data-crm-preview]');
  const feedback=find(box,x=>x.className==='crm-preview-feedback');
  assert.ok(feedback);
  assert.ok(feedback.textContent.includes('TIMEOUT'));
  assert.ok(!feedback.textContent.includes('Atualizando'));
  assert.equal(locate(box,'Atualizar revisões').disabled,false);
  assert.equal(locate(box,'Solicitar revisão').disabled,true);
});
