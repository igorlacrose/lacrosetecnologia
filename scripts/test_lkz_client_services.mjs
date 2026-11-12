import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../admin/client-services.js',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/migrations/20261112210946_lkz_adm_catalogo_minutas_contratos_por_cliente.sql',import.meta.url),'utf8');
const financeSql=fs.readFileSync(new URL('../supabase/migrations/20261112211123_lkz_adm_visao_financeira_minutas_nao_cobradas.sql',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../admin/app.js',import.meta.url),'utf8');

class N{
 constructor(tag){
  this.tagName=tag;this.children=[];this.parent=null;this.className='';this.attrs={};
  this.type='';this.value='';this.disabled=false;this.checked=false;this.isConnected=true;
  this.textContent='';this.classList={toggle:()=>{}};
 }
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node)}}
 before(node){if(!this.parent)throw Error('Unattached node');node.parent=this.parent;
  const index=this.parent.children.indexOf(this);this.parent.children.splice(index,0,node)}
 replaceChildren(...nodes){this.children=[];this.append(...nodes)}
 setAttribute(name,value){this.attrs[name]=value}
 querySelector(selector){
  return find(this,n=>selector==='.action-row'?n.className==='action-row':false);
 }
}
function find(n,match){for(const child of n.children){if(match(child))return child;
 const got=find(child,match);if(got)return got;}return null}
function findAll(n,match){let r=[];for(const child of n.children){if(match(child))r.push(child);r=r.concat(findAll(child,match))}return r}
function setup(options={}){
 const document={createElement:tag=>new N(tag)},window={};
 vm.runInNewContext(source,{document,window,Intl,console});
 const form=new N('form');const actions=new N('div');actions.className='action-row';form.append(actions);
 const catalog=[
  {code:'OCA',name:'OCA',description:'Operador comercial',selectable:true,delivery_state:'requires_manual_review'},
  {code:'LCRM',name:'Lacrose CRM',description:'Gestão comercial',selectable:true,delivery_state:'requires_manual_review'}
 ];
 const contract=options.contract||{version:0,items:[]};
 const calls=[];
 const sb={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='lkz_adm_catalog_and_contract')return {data:{catalog,contract}};
  if(name==='lkz_adm_list_contract_drafts')return {data:options.finance||[]};
  throw Error('Unexpected RPC '+name);
 }};
 return {form,sb,calls,api:window.LKZClientServices,document};
}

test('permite selecionar dois produtos e preços independentes',async()=>{
 const t=setup();const f=await t.api.mountForm({form:t.form,sb:t.sb});
 const checks=findAll(t.form,n=>n.tagName==='input'&&n.type==='checkbox');
 assert.equal(checks.length,2);
 assert.equal(f.version,0);
 const picker=find(t.form,n=>n.tagName==='details'&&n.className==='service-picker');
 const cards=findAll(t.form,n=>n.tagName==='section'&&n.className.includes('service-price-card'));
 assert.ok(picker);
 assert.equal(cards.length,2);
 assert.ok(cards.every(n=>n.hidden===true),'Valores devem começar ocultos');
 const oca=cards[0],crm=cards[1];
 const fields=n=>findAll(n,e=>e.tagName==='input'&&e.type==='text');
 checks[0].checked=true;checks[0].onchange();
 assert.equal(oca.hidden,false);
 assert.equal(crm.hidden,true,'Outro sistema sem seleção deve continuar oculto');
 checks[1].checked=true;checks[1].onchange();
 assert.equal(crm.hidden,false);
 const ocaPrices=fields(oca),crmPrices=fields(crm);
 assert.equal(ocaPrices.length,2);
 ocaPrices[0].value='1890,00';
 ocaPrices[1].value='290,00';
 const select=find(oca,n=>n.tagName==='select');
 select.value='monthly';select.onchange();
 crmPrices[0].value='350,00';
 const payload=f.snapshot();
 assert.equal(payload.items.length,2);
 assert.equal(payload.items[0].code,'OCA');
 assert.equal(payload.items[0].setup_cents,189000);
 assert.equal(payload.items[0].recurring_cents,29000);
 assert.equal(payload.items[0].billing_interval,'monthly');
 assert.equal(payload.items[1].setup_cents,35000);
 assert.equal(payload.items[1].recurring_cents,0);
 assert.equal(payload.items[1].billing_interval,'none');
 assert.equal(t.calls.length,1);
});

test('rejeita preço inválido antes de enviar ao banco',async()=>{
 const t=setup();const f=await t.api.mountForm({form:t.form,sb:t.sb});
 const check=find(t.form,n=>n.tagName==='input'&&n.type==='checkbox');
 check.checked=true;check.onchange();
 const card=find(t.form,n=>n.tagName==='section'&&n.className.includes('service-price-card'));
 assert.equal(card.hidden,false);
 const price=find(card,n=>n.tagName==='input'&&n.type==='text');
 price.value='1.900,00';
 assert.throws(()=>f.snapshot(),/Preço inválido/);
 price.value='-4,00';
 assert.throws(()=>f.snapshot(),/Preço inválido/);
});

test('preserva versão e itens existentes ao editar cadastro',async()=>{
 const t=setup({contract:{version:3,items:[{
  code:'LCRM',setup_cents:50000,recurring_cents:12900,billing_interval:'monthly'
 }]}});
 const f=await t.api.mountForm({form:t.form,sb:t.sb,contact:{id:'uuid-customer'}});
 const p=f.snapshot();
 assert.equal(p.version,3);
 assert.equal(p.items.length,1);
 assert.equal(p.items[0].code,'LCRM');
 assert.equal(p.items[0].recurring_cents,12900);
 assert.equal(t.calls[0].args.p_contact,'uuid-customer');
 const cards=findAll(t.form,n=>n.tagName==='section'&&n.className.includes('service-price-card'));
 assert.equal(cards[0].hidden,true);
 assert.equal(cards[1].hidden,false,'Sistema existente deve aparecer para edição');
});

test('mostra somente minuta no financeiro, não cobranças realizadas',async()=>{
 const t=setup({finance:[{
  contact_id:'abc',customer:'Cliente fictício',version:2,
  product_codes:['OCA','LCRM'],total_setup_cents:125000,
  total_monthly_cents:29000,total_yearly_cents:0,status:'draft'
 }]});
 const root=new N('section');
 await t.api.mountFinance({target:root,sb:t.sb});
 const all=findAll(root,n=>n.tagName==='article');
 assert.equal(all.length,1);
 assert.ok(find(root,n=>n.textContent==='Cliente fictício'));
 assert.ok(find(root,n=>n.textContent.includes('não cobrado / não provisionado')));
 assert.deepEqual(t.calls.map(x=>x.name),['lkz_adm_list_contract_drafts']);
});

test('somente minuta, MFA, bloqueios de faturamento e provisionamento no banco',()=>{
 assert.match(sql,/enable row level security/);
 assert.match(sql,/revoke all on table lkz_adm_private\.commercial_products/);
 assert.match(sql,/lkz_adm_private\.is_operator\(\)/);
 assert.match(sql,/billing_enabled boolean not null default false check\(billing_enabled=false\)/);
 assert.match(sql,/provisioning_enabled boolean not null default false check\(provisioning_enabled=false\)/);
 assert.match(sql,/status text not null default 'draft' check\(status='draft'\)/);
 assert.match(sql,/v_code=any\(v_codes\)/);
 assert.match(sql,/p_expected_version/);
 assert.match(financeSql,/status','draft'/);
 assert.match(app,/lkz_adm_create_client_with_draft/);
 assert.match(app,/lkz_adm_edit_client_with_draft/);
 assert.doesNotMatch(source,/\bfetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket|\.sendMessage\s*\(|\.sendEmail\s*\(|\blocalStorage\b/);
});

test('desmarcar e remarcar sistema esconde e preserva valores durante a edição',async()=>{
 const t=setup({contract:{version:2,items:[{
  code:'OCA',setup_cents:123400,recurring_cents:5000,billing_interval:'monthly'
 }]}});
 const f=await t.api.mountForm({form:t.form,sb:t.sb,contact:{id:'customer'}});
 const checkbox=find(t.form,n=>n.tagName==='input'&&n.type==='checkbox');
 const card=find(t.form,n=>n.tagName==='section'&&n.className.includes('service-price-card'));
 assert.equal(card.hidden,false);
 const price=find(card,n=>n.tagName==='input'&&n.type==='text');
 assert.equal(price.value,'1234,00');
 checkbox.checked=false;checkbox.onchange();
 assert.equal(card.hidden,true);
 assert.equal(f.snapshot().items.length,0);
 checkbox.checked=true;checkbox.onchange();
 assert.equal(card.hidden,false);
 assert.equal(price.value,'1234,00');
 assert.equal(f.snapshot().items[0].setup_cents,123400);
});
test('lista suspensa pode ser fechada e indica quantidade selecionada',async()=>{
 const t=setup();await t.api.mountForm({form:t.form,sb:t.sb});
 const picker=find(t.form,n=>n.tagName==='details'&&n.className==='service-picker');
 const chosen=find(picker,n=>n.className==='service-picker-count');
 assert.equal(chosen.textContent,'Nenhum sistema selecionado');
 const check=find(picker,n=>n.tagName==='input'&&n.type==='checkbox');
 check.checked=true;check.onchange();
 assert.equal(chosen.textContent,'OCA');
 const done=find(picker,n=>n.tagName==='button'&&n.textContent==='Concluir seleção');
 picker.open=true;done.onclick();
 assert.equal(picker.open,false);
});
test('nome do cliente é clicável e campo sugere nomes sem sobrescrever outras fichas',()=>{
 assert.match(app,/class="client-name-link" data-open-client/);
 assert.match(app,/id="clientSearch" type="search" list="clientNameSuggestions"/);
 assert.match(app,/const selectExactName=\(\)=>/);
 assert.match(app,/exact\.length===1/);
 assert.match(app,/if\(matches\.length===1/);
 assert.match(app,/clientSearchTerm=search\.value/);
});
