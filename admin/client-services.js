/* LKZ ADM · catálogo e minutas comerciais (sem cobrança/provisionamento).
 * Interface limitada à administração comercial com MFA. Nenhuma chave secreta,
 * dados do cliente em armazenamento local ou envio externo.
 */
(function(){
'use strict';
const money=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(cents)||0)/100);
const periodic={none:'Sem recorrência',monthly:'Mensal',yearly:'Anual'};
function node(tag,cls,value){
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(value!==undefined)el.textContent=String(value);
  return el;
}
function labeled(text,control){
  const wrap=node('label','service-field');
  wrap.append(node('span','',text),control);
  return wrap;
}
function inputMoney(value=0){
  const input=document.createElement('input');
  input.type='text';input.inputMode='decimal';input.autocomplete='off';
  input.value=value?((value/100).toFixed(2)).replace('.',','):'';
  input.placeholder='0,00';input.maxLength=11;
  return input;
}
function cents(text){
  const source=String(text||'').trim();
  if(!source)return 0;
  if(!/^\d{1,7}(?:,\d{1,2})?$/.test(source))
    throw new Error('Preço inválido. Use números sem pontos, com vírgula para centavos (ex.: 1890,00).');
  const [whole,fraction='']=source.split(',');
  const result=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(result)||result>100000000)
    throw new Error('O valor por serviço ultrapassa o limite aceito.');
  return result;
}
function selectInterval(value){
  const select=document.createElement('select');
  select.setAttribute('aria-label','Periodicidade de cobrança prevista');
  for(const [id,name] of Object.entries(periodic)){
    const option=node('option','',name);option.value=id;select.append(option);
  }
  select.value=value||'none';return select;
}
async function read(sb,contact){
  const {data,error}=await sb.rpc('lkz_adm_catalog_and_contract',{p_contact:contact?.id||null});
  if(error||!Array.isArray(data?.catalog)||!Array.isArray(data?.contract?.items))
    throw new Error('Catálogo indisponível. Recarregue para continuar.');
  return data;
}
async function mountForm({form,contact=null,sb}){
  if(!form?.isConnected||!sb)throw new Error('Formulário comercial indisponível.');
  const section=node('fieldset','services-editor');
  section.append(
    node('legend','','Sistemas e serviços'),
    node('p','services-intro','Selecione quantos sistemas forem necessários. Os valores são individuais e editáveis; nenhuma cobrança ou instalação será criada.')
  );
  const info=node('p','services-status','Consultando catálogo...');
  info.setAttribute('role','status');
  section.append(info);
  form.querySelector('.action-row')?.before(section);
  let data;
  try{data=await read(sb,contact)}
  catch(e){info.textContent=e.message;throw e}
  if(!section.isConnected)throw new Error('Formulário mudou durante o carregamento.');
  const saved=new Map(data.contract.items.map(item=>[item.code,item]));
  const fields=[];
  for(const product of data.catalog){
    const savedItem=saved.get(product.code);
    const box=node('div','service-option');
    const selector=node('label','service-option-heading');
    const check=document.createElement('input');check.type='checkbox';
    check.checked=!!savedItem;
    check.disabled=!product.selectable;
    selector.append(check,node('strong','',product.name));
    const description=node('p','service-description',product.description||'Produto sob análise comercial');
    const status=node('small','service-availability',
      product.delivery_state==='unavailable'?'Indisponível para novos pedidos':'Implantação sujeita a análise e aprovação');
    const prices=node('div','service-price-grid');
    const setup=inputMoney(savedItem?.setup_cents||0);
    setup.setAttribute('aria-label','Implantação '+product.name);
    const recurring=inputMoney(savedItem?.recurring_cents||0);
    recurring.setAttribute('aria-label','Recorrência '+product.name);
    const interval=selectInterval(savedItem?.billing_interval||'none');
    interval.setAttribute('aria-label','Periodicidade '+product.name);
    prices.append(
      labeled('Implantação (R$)',setup),
      labeled('Recorrência (R$)',recurring),
      labeled('Periodicidade',interval)
    );
    box.append(selector,description,status,prices);section.append(box);
    const update=()=>{
      box.classList.toggle('service-selected',check.checked);
      setup.disabled=!check.checked;
      interval.disabled=!check.checked;
      recurring.disabled=!check.checked||interval.value==='none';
      if(!check.checked)box.setAttribute('aria-selected','false');
      else box.setAttribute('aria-selected','true');
    };
    check.onchange=update;
    interval.onchange=()=>{if(interval.value==='none')recurring.value='';update()};
    update();
    fields.push({code:product.code,check,setup,recurring,interval});
  }
  info.textContent='Somente minutas comerciais. Serviços não serão ativados, faturados ou provisionados.';
  return {
    version:Number(data.contract.version)||0,
    snapshot(){
      const items=[];
      for(const f of fields){
        if(!f.check.checked)continue;
        const setupCents=cents(f.setup.value);
        const recurrent=f.interval.value==='none'?0:cents(f.recurring.value);
        items.push({code:f.code,setup_cents:setupCents,
          recurring_cents:recurrent,billing_interval:f.interval.value});
      }
      return {items,version:Number(data.contract.version)||0};
    }
  };
}
async function mountDetail({panel,contact,sb}){
  if(!panel?.isConnected||!contact?.id||!sb)return;
  const section=node('section','service-summary');
  section.append(node('h3','','Sistemas vinculados ao cliente'));
  const info=node('p','service-status','Carregando minuta...');
  section.append(info);
  panel.append(section);
  try{
    const data=await read(sb,contact);
    if(!section.isConnected)return;
    info.textContent='';
    const contract=data.contract;
    if(!contract.items.length){
      section.append(node('p','service-empty',
        'Nenhum sistema selecionado. Use “Editar cadastro” para escolher produtos e condições.'));
    }else{
      const catalog=new Map(data.catalog.map(p=>[p.code,p]));
      for(const item of contract.items){
        const product=catalog.get(item.code);
        const row=node('div','service-summary-item');
        row.append(node('strong','',product?.name||item.code),
          node('span','',
          'Implantação: '+money(item.setup_cents)+' · '+
          (item.billing_interval==='none'?'Sem recorrência':
            periodic[item.billing_interval]+': '+money(item.recurring_cents))));
        section.append(row);
      }
    }
    section.append(node('p','service-disclaimer',
      'Status: MINUTA. Sem assinatura formalizada, acesso liberado, faturamento ou ambiente provisionado.'));
  }catch{
    if(section.isConnected)info.textContent='Minuta comercial indisponível. Atualize a ficha para tentar novamente.';
  }
}
async function mountFinance({target,sb}){
  if(!target?.isConnected||!sb)return;
  target.replaceChildren();
  const title=node('section','panel commercial-finance');
  title.append(node('h2','','Minutas de contratos e serviços'),
    node('p','service-description',
      'Valores apenas planejados. Nenhuma cobrança, assinatura ativa ou pagamento confirmado nesta etapa.'));
  const status=node('p','service-status','Consultando minutas...');
  status.setAttribute('role','status');
  title.append(status);target.append(title);
  try{
    const {data,error}=await sb.rpc('lkz_adm_list_contract_drafts');
    if(error||!Array.isArray(data))throw new Error('Dados indisponíveis');
    if(!target.isConnected)return;
    status.textContent=data.length?
      data.length+' minuta(s) cadastrada(s). Não representam receita recebida.':
      'Nenhuma minuta cadastrada até o momento.';
    if(!data.length)return;
    const table=node('div','commercial-finance-table');
    for(const contract of data){
      const row=node('article','commercial-finance-row');
      row.append(node('strong','',contract.customer),
        node('small','',contract.product_codes.join(', ')||'Sem sistemas'),
        node('span','','Implantação prevista: '+money(contract.total_setup_cents)),
        node('span','','Mensal previsto: '+money(contract.total_monthly_cents)),
        node('span','','Anual previsto: '+money(contract.total_yearly_cents)),
        node('small','','Minuta — não cobrado / não provisionado'));
      table.append(row);
    }
    title.append(table);
  }catch{
    if(target.isConnected)status.textContent='Não foi possível carregar minutas. Nenhuma cobrança foi realizada.';
  }
}
window.LKZClientServices=Object.freeze({mountForm,mountDetail,mountFinance});
})();