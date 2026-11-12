/* LKZ ADM · minuta textual privada, hash calculado e verificado no servidor.
 * Não é contrato assinado; não faz upload/download, cobrança ou comunicação externa.
 */
(function(){
'use strict';
function elem(tag,cls,txt){
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(txt!==undefined)n.textContent=String(txt);
  return n;
}
function btn(label){const n=elem('button','cta secondary',label);n.type='button';return n}
async function request(sb,name,args){
  return await sb.rpc(name,args);
}
async function mount({panel,contact,sb,isMaster=false,confirm,isSessionActive}){
  if(!panel?.isConnected||!contact?.id||!sb||!isSessionActive())return;
  if(panel.querySelector('[data-contract-texts]'))return;
  const root=elem('section','contract-texts');
  root.dataset.contractTexts='';
  root.append(
    elem('h3','','Minutas contratuais geradas no servidor'),
    elem('p','contract-texts-note',
      'Prévia técnica baseada na proposta comercial, com conteúdo imutável e SHA-256 calculado pelo banco. Ainda exige revisão jurídica, qualificação das partes e assinatura verdadeira.')
  );
  const alert=elem('p','contract-texts-warning',
    'NÃO ASSINADO · Não há PDF definitivo, link de assinatura, cobrança ou provisionamento.');
  root.append(alert);
  const update=btn('Atualizar documentos');
  const status=elem('p','contract-texts-status','Consultando propostas...');
  status.setAttribute('role','status');
  const list=elem('div','contract-texts-list');
  const reader=elem('section','contract-text-reader');
  root.append(update,status,list,reader);
  panel.append(root);
  const active=()=>root.isConnected&&isSessionActive();
  let busy=false,items=[],requestToken=null;
  const setBusy=flag=>{
    busy=flag;update.disabled=flag;
    for(const b of list.querySelectorAll('button'))b.disabled=flag;
  };
  async function openDocument(id){
    if(busy||!active())return;
    setBusy(true);status.textContent='Lendo a minuta com verificação de integridade...';
    const response=await request(sb,'lkz_adm_read_contract_text_preview',{p_document:id})
      .catch(()=>({error:{code:'NETWORK'}}));
    if(!active())return;
    if(response.error||typeof response.data?.text!=='string'||
      response.data?.legal_approved!==false||
      response.data?.signature_enabled!==false||
      response.data?.billing_enabled!==false||
      response.data?.provisioning_enabled!==false){
      status.textContent='Não foi possível verificar o texto ('+
        (response.error?.code||'RESPOSTA_INVALIDA')+').';
      setBusy(false);return;
    }
    reader.replaceChildren();
    reader.append(elem('h4','','Minuta interna · não assinada'));
    const meta=elem('p','contract-text-hash',
      'Referência: '+response.data.document_ref+' · SHA-256 servidor: '+
      response.data.content_sha256);
    const text=document.createElement('textarea');
    text.readOnly=true;text.spellcheck=false;text.rows=21;text.value=response.data.text;
    text.setAttribute('aria-label','Texto da minuta contratual para revisão jurídica');
    reader.append(meta,text);
    status.textContent='Texto privado consultado. O hash foi recalculado e conferido no banco.';
    setBusy(false);
  }
  function render(){
    list.replaceChildren();
    if(!items.length)list.append(elem('p','contract-texts-empty',
      'Ainda não há proposta comercial para este cliente.'));
    for(const quote of items){
      const box=elem('article','contract-text-item');
      box.append(elem('strong','','Proposta · versão '+quote.draft_version));
      if(quote.status==='cancelled')
        box.append(elem('small','contract-texts-warning','Proposta cancelada.'));
      else if(!quote.current_draft)
        box.append(elem('small','contract-texts-warning','Versão antiga da minuta.'));
      if(quote.document){
        const d=quote.document;
        box.append(elem('small','','Documento interno: '+d.document_ref),
          elem('small','contract-text-hash','SHA-256: '+d.content_sha256));
        const view=btn('Consultar texto privado');
        view.onclick=()=>openDocument(d.id);
        box.append(view);
      }else if(isMaster&&quote.can_prepare){
        box.append(elem('p','contract-texts-empty',
          'Ainda não existe minuta textual gerada no servidor.'));
        const make=btn('Gerar minuta para revisão (sem envio)');
        make.onclick=async()=>{
          if(busy||!active())return;
          if(!requestToken||requestToken.quote!==quote.id)
            requestToken={quote:quote.id,id:crypto.randomUUID()};
          const approved=await confirm({
            title:'Gerar minuta interna para revisão?',
            message:'O texto será construído a partir da proposta atual e armazenado em tabela privada. As cláusulas pendentes exigem aprovação jurídica. Isso não envia, assina ou cobra.'
          });
          if(!approved||!active())return;
          setBusy(true);status.textContent='Gerando texto e hash no servidor...';
          const response=await request(sb,'lkz_adm_generate_contract_text_preview',{
            p_quote:quote.id,p_request_id:requestToken.id
          }).catch(()=>({error:{code:'NETWORK'}}));
          if(!active())return;
          if(response.error||!response.data?.id||
            response.data?.status!=='internal_review'||
            response.data?.legal_approved!==false||
            response.data?.billing_enabled!==false||
            response.data?.signature_enabled!==false||
            response.data?.provisioning_enabled!==false){
            const code=response.error?.code||'RESPOSTA_INVALIDA';
            if(!['NETWORK','TIMEOUT','08P01'].includes(code))requestToken=null;
            status.textContent='Geração não confirmada ('+code+
              '). Consulte o histórico antes de repetir.';
            setBusy(false);return;
          }
          requestToken=null;
          await reload('Minuta interna registrada. Nenhum documento foi enviado.');
        };
        box.append(make);
      }else{
        box.append(elem('small','contract-texts-empty',
          'Indisponível: proposta cancelada, antiga, sem permissão ou com dossiê anterior.'));
      }
      list.append(box);
    }
    setBusy(false);
  }
  async function reload(message=''){
    if(!active())return;
    setBusy(true);status.textContent='Consultando documentos privados...';
    const response=await request(sb,'lkz_adm_list_contract_text_previews',{
      p_contact:contact.id
    }).catch(()=>({error:{code:'NETWORK'}}));
    if(!active())return;
    const data=response.data;
    if(response.error||!Array.isArray(data?.quotes)||
      data?.legal_approved!==false||data?.signature_enabled!==false||
      data?.billing_enabled!==false||data?.provisioning_enabled!==false){
      status.textContent='Documentos indisponíveis ('+
        (response.error?.code||'RESPOSTA_INVALIDA')+').';
      setBusy(false);return;
    }
    items=data.quotes;reader.replaceChildren();render();
    status.textContent=message||'Documentos atualizados. Nenhuma assinatura foi realizada.';
  }
  update.onclick=()=>reload();
  await reload();
}
window.LKZContractTexts=Object.freeze({mount});
})();