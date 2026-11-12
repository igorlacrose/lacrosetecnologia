/* LKZ ADM: propostas comerciais internas, snapshots versionados e cancelamento auditado.
 * Esta interface NÃO registra aceite do cliente, não emite cobranças nem provisiona sistemas.
 */
(function(){
'use strict';
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
  .format((Number(value)||0)/100);
const period={none:'sem recorrência',monthly:'mensal',yearly:'anual'};
function el(tag,cls,txt){
 const node=document.createElement(tag);
 if(cls)node.className=cls;
 if(txt!==undefined)node.textContent=String(txt);
 return node;
}
function button(label,cls='secondary'){
 const item=el('button','cta '+cls,label);item.type='button';return item;
}
function formatDateSafe(value){
 if(!value)return '—';
 const date=new Date(value);
 return Number.isFinite(date.getTime())?date.toLocaleString('pt-BR'):'—';
}
async function fetchWithTimeout(promise,seconds=15){
 let timeout;
 try{
  return await Promise.race([promise,new Promise((_,reject)=>{
    timeout=setTimeout(()=>reject(new Error('TIMEOUT')),seconds*1000);
  })]);
 }finally{clearTimeout(timeout)}
}
async function mount({panel,contact,sb,confirm,isMaster=false,isSessionActive}){
 if(!panel?.isConnected||!contact?.id||!sb||!isSessionActive())return;
 if(panel.querySelector('[data-client-quotes]'))return;
 const root=el('section','client-quotes');root.dataset.clientQuotes='';
 root.append(el('h3','','Propostas comerciais'),
   el('p','client-quotes-description',
     'Congele os sistemas e valores de uma minuta para revisão. Preparar não envia proposta, não registra aceite nem gera cobrança.'));
 const warning=el('p','client-quotes-warning',
   'Envio, assinatura, cobrança e provisionamento permanecem desabilitados.');
 root.append(warning);
 const toolbar=el('div','client-quotes-toolbar');
 const prepare=button('Preparar proposta (sem envio)');
 const refresh=button('Atualizar propostas','secondary');
 if(isMaster)toolbar.append(prepare);
 toolbar.append(refresh);root.append(toolbar);
 const status=el('p','client-quotes-status','Consultando propostas...');
 status.setAttribute('role','status');root.append(status);
 const list=el('div','client-quotes-list');root.append(list);
 panel.append(root);
 const active=()=>root.isConnected&&isSessionActive();
 let busy=false,loaded=false,draftVersion=0,request=null,quotes=[];
 const setBusy=flag=>{
   busy=flag;refresh.disabled=flag;
   prepare.disabled=flag||!loaded||draftVersion===0||
     !dataReady()||quotes.some(q=>q.draft_version===draftVersion);
   for(const n of list.querySelectorAll('button,textarea'))n.disabled=flag;
 };
 let itemCount=0;
 const dataReady=()=>itemCount>0;
 const render=()=>{
   list.replaceChildren();
   if(!quotes.length)list.append(el('p','client-quotes-empty',
     'Ainda não há propostas preparadas para este cliente.'));
   for(const quote of quotes){
     const card=el('article','client-quote-card');
     const line=el('div','client-quote-heading');
     line.append(el('strong','','Proposta · versão '+quote.draft_version),
       el('span',quote.status==='cancelled'?'client-quote-cancelled':'client-quote-prepared',
         quote.status==='cancelled'?'Cancelada':'Preparada internamente'));
     card.append(line);
     card.append(el('small','client-quote-date',
       'Preparada em '+formatDateSafe(quote.prepared_at)));
     if(!quote.current_draft)card.append(el('p','client-quote-stale',
       'A minuta atual mudou: esta proposta mantém os valores antigos.'));
     const products=el('ul','client-quote-items');
     for(const item of quote.items||[]){
       products.append(el('li','',
         String(item.name||item.code||'Sistema')+' — implantação '+money(item.setup_cents)+
         (item.billing_interval==='none'?' · sem recorrência':
           ' · '+(period[item.billing_interval]||'recorrência')+' '+money(item.recurring_cents))));
     }
     card.append(products);
     card.append(el('p','client-quote-totals',
       'Implantação '+money(quote.setup_total_cents)+' · mensal '+money(quote.monthly_total_cents)+
       ' · anual '+money(quote.yearly_total_cents)));
     if(quote.status==='cancelled'){
       card.append(el('p','client-quote-stale',
         'Cancelada: '+String(quote.cancel_reason||'Sem motivo registrado')));
     }else if(isMaster){
       const revoke=el('div','client-quote-cancel');
       const reason=document.createElement('textarea');
       reason.rows=2;reason.maxLength=500;
       reason.setAttribute('aria-label','Motivo para cancelar esta proposta');
       reason.placeholder='Motivo do cancelamento (mínimo 5 caracteres)';
       const cancel=button('Cancelar proposta','danger-outline');
       let cancelRequest=null;
       cancel.onclick=async()=>{
         if(busy||!active())return;
         const note=reason.value.trim();
         if(note.length<5||note.length>500){
           status.textContent='Informe um motivo válido para o cancelamento.';reason.focus();return;
         }
         if(!cancelRequest||cancelRequest.note!==note)
           cancelRequest={note,id:crypto.randomUUID()};
         const authorized=await confirm({
           title:'Cancelar proposta comercial?',
           message:'A proposta será marcada como cancelada e preservada no histórico. Nenhuma cobrança ou provisionamento será realizado.',
           destructive:true
         });
         if(!authorized||!active())return;
         setBusy(true);status.textContent='Registrando cancelamento...';
         let result;
         try{result=await fetchWithTimeout(sb.rpc('lkz_adm_cancel_client_quote',{
           p_quote:quote.id,p_reason:note,p_request_id:cancelRequest.id
         }));}catch{result={error:{code:'NETWORK'}}}
         if(!active())return;
         if(result.error||result.data?.status!=='cancelled'){
           status.textContent='Cancelamento não confirmado ('+
             (result.error?.code||'SEM_RESPOSTA')+'). Consulte o histórico antes de repetir.';
           setBusy(false);return;
         }
         await reload('Proposta cancelada. Nenhuma cobrança ou serviço foi ativado.');
       };
       revoke.append(reason,cancel);card.append(revoke);
     }
     list.append(card);
   }
   setBusy(false);
 };
 async function reload(message=''){
   if(!active())return;
   setBusy(true);status.textContent='Consultando propostas...';
   let result;
   try{result=await fetchWithTimeout(sb.rpc('lkz_adm_list_client_quotes',
     {p_contact:contact.id}));}
   catch{result={error:{code:'NETWORK'}}}
   if(!active())return;
   const data=result.data;
   if(result.error||!Array.isArray(data?.quotes)||
      data.billing_enabled!==false||data.provisioning_enabled!==false||
      data.customer_acceptance_enabled!==false){
     loaded=false;status.textContent='Não foi possível confirmar as propostas ('+
       (result.error?.code||'RESPOSTA_INVALIDA')+'). Tente atualizar.';
     setBusy(false);return;
   }
   loaded=true;draftVersion=Number(data.draft_version)||0;
   itemCount=Number(data.draft_item_count)||0;
   quotes=data.quotes;render();
   status.textContent=message||
     (dataReady()?'Propostas atualizadas. Valores congelados por versão.':
       'Salve uma minuta com ao menos um sistema antes de preparar a proposta.');
   if(quotes.some(q=>q.draft_version===draftVersion))
     status.textContent+=' Para uma nova proposta, salve uma nova versão da minuta.';
 }
 prepare.onclick=async()=>{
   if(!isMaster||busy||!active()||!loaded||!dataReady()||draftVersion<1)return;
   if(quotes.some(q=>q.draft_version===draftVersion))return;
   if(!request||request.version!==draftVersion)
      request={id:crypto.randomUUID(),version:draftVersion};
   if(!await confirm({
     title:'Preparar versão da proposta?',
     message:'Será armazenada uma cópia dos sistemas e valores da minuta. Não envia documento, não aceita contrato nem cobra o cliente.'
   }))return;
   if(!active())return;
   setBusy(true);status.textContent='Preparando proposta...';
   let result;
   try{result=await fetchWithTimeout(sb.rpc('lkz_adm_prepare_client_quote',{
     p_contact:contact.id,p_expected_version:request.version,p_request_id:request.id
   }));}catch{result={error:{code:'NETWORK'}}}
   if(!active())return;
   if(result.error||!result.data?.id||
      result.data?.billing_enabled!==false||
      result.data?.provisioning_enabled!==false||
      result.data?.customer_accepted!==false){
     status.textContent='Proposta não confirmada ('+
       (result.error?.code||'RESPOSTA_INVALIDA')+
       '). Recarregue o histórico se o erro persistir.';
     setBusy(false);return;
   }
   request=null;
   await reload(result.data.already_recorded?
     'Proposta previamente preparada; nenhuma duplicação criada.':
     'Proposta interna preparada. Não houve aceite, cobrança ou entrega.');
 };
 refresh.onclick=()=>reload();
 await reload();
}
window.LKZClientQuotes=Object.freeze({mount});
})();