import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code=fs.readFileSync(new URL('../admin/oca-dispatch-preflight.js',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/migrations/20261112203456_lkz_oca_preflight_multitenant_bloqueado.sql',import.meta.url),'utf8');

class Node {
  constructor(tag){
    this.tagName=tag;this.children=[];this.parent=null;this.className='';
    this.dataset={};this.textContent='';this.disabled=false;this.isConnected=true;
  }
  append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n)}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes)}
  setAttribute(k,v){this[k]=v}
  querySelector(selector){
    const match=node=>selector==='[data-oca-preflight]'&&('ocaPreflight' in node.dataset);
    return search(this,match);
  }
}
function search(root,match){
  for(const child of root.children){
    if(match(child))return child;
    const found=search(child,match);if(found)return found;
  }return null;
}
function setup(options={}){
  const document={createElement:tag=>new Node(tag)},window={},id='33333333-3333-4333-8333-333333333333';
  const generated=[];
  const crypto={randomUUID:()=>{generated.push(id);return id}};
  vm.runInNewContext(code,{window,document,crypto,console});
  const card=new Node('article');
  const calls=[],responses=options.responses||[];
  const sb={rpc:async(name,args)=>{
    calls.push({name,args});
    const result=responses.length?responses.shift():{data:{
      request_id:args.p_request_id,preview_id:args.p_preview,
      status:'blocked',blockers:['workspace_unassigned','transport_disabled'],
      already_recorded:false,delivery_enabled:false,dry_run_only:true
    }};
    return result;
  }};
  const mount=preview=>window.LKZOcaPreflight.mount({
    target:card,preview,sb,isSessionActive:()=>true
  });
  return {card,calls,generated,mount};
}
test('aprovado: só consulta por clique, relata bloqueios sem enviar',async()=>{
  const x=setup();x.mount({id:'preview-1',status:'approved'});
  assert.equal(x.calls.length,0);
  const root=x.card.querySelector('[data-oca-preflight]');
  assert.ok(root);
  const trigger=search(root,n=>n.tagName==='button');
  assert.equal(trigger.textContent,'Verificar bloqueios');
  await trigger.onclick();
  assert.equal(x.calls.length,1);
  assert.equal(x.calls[0].name,'lkz_adm_oca_comm_preflight');
  assert.equal(x.calls[0].args.p_preview,'preview-1');
  const rendered=search(root,n=>n.tagName==='ul');
  assert.equal(rendered.children.length,2);
  assert.ok(rendered.children.some(x=>x.textContent.includes('transporte continua desabilitado')));
  assert.ok(!x.calls.some(x=>/send|dispatch|deliver/i.test(x.name)));
});
test('retentativa depois de falha preserva a mesma chave UUID',async()=>{
  const x=setup({responses:[
    {error:{code:'NETWORK'}},
    {data:{status:'blocked',delivery_enabled:false,dry_run_only:true,
      blockers:['transport_disabled'],already_recorded:true}}
  ]});
  x.mount({id:'preview-2',status:'approved'});
  const root=x.card.querySelector('[data-oca-preflight]');
  const button=search(root,n=>n.tagName==='button');
  await button.onclick();
  assert.ok(search(root,n=>n.className==='oca-preflight-status').textContent.includes('não confirmado'));
  await button.onclick();
  assert.equal(x.calls.length,2);
  assert.equal(x.calls[0].args.p_request_id,x.calls[1].args.p_request_id);
  assert.equal(x.generated.length,1);
  assert.ok(search(root,n=>n.className==='oca-preflight-status').textContent.includes('sem duplicação'));
});
test('prévia pendente ou rejeitada não oferece pré-despacho',()=>{
  for(const status of ['pending','rejected','cancelled']){
    const x=setup();x.mount({id:'preview-3',status});
    assert.equal(x.card.querySelector('[data-oca-preflight]'),null);
    assert.equal(x.calls.length,0);
  }
});
test('proibição de envio, RLS e isolamento por tenant no backend',()=>{
  assert.match(migration,/enable row level security/);
  assert.match(migration,/revoke all on lkz_adm_private\.oca_comm_workspaces/);
  assert.match(migration,/lkz_adm_private\.oca_comm_memberships m/);
  assert.match(migration,/m\.workspace_id=v_workspace and m\.actor_id=auth\.uid\(\) and m\.active/);
  assert.match(migration,/lkz_adm_private\.is_operator\(\)/);
  assert.match(migration,/lkz_adm_private\.is_master\(\)/);
  assert.match(migration,/v_blockers:=array_append\(v_blockers,'transport_disabled'\)/);
  assert.match(migration,/status='blocked'/);
  assert.match(migration,/delivery_enabled=false/);
  assert.doesNotMatch(code,/\bfetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket|\.sendMessage\s*\(|\.sendEmail\s*\(|localStorage|sessionStorage/);
  assert.ok(!migration.includes('pg_net.http_post'));
});
