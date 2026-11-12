/* LKZ ADM • dossiê contratual PRÉ-assinatura.
 * Registro interno de referência+hash; NÃO verifica conteúdo, assina, envia ou cobra.
 */
(function(){
'use strict';
function node(tag,cls,value){
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(value!==undefined)el.textContent=String(value);
  return el;
}
function button(label,variant='secondary'){
  const b=node('button','cta '+variant,label);b.type='button';return b;
}
function field(title,control){
  const label=node('label','signature-field');
  label.append(node('span','',title),control);
  return label;
}
function dateLabel(value){
  if(!value)return '—';
  const d=new Date(value);
  return Number.isFinite(d.getTime())?d.toLocaleString('pt-BR'):'—';
}
async function timed(promise){
  let timeout;
  try{return await Promise.race([promise,new Promise((_,reject)=>{
    timeout=setTimeout(()=>reject(new Error('TIMEOUT')),15000);
  })])}finally{clearTimeout(timeout)}
}
async function mount({panel,contact,sb,confirm,isMaster=false,isSessionActive}){
  if(!panel?.isConnected||!contact?.id||!sb||!isSessionActive())return;
  if(panel.querySelector('[data-signature-dossiers]'))return;
  const root=node('section','signature-dossiers');root.dataset.signatureDossiers='';
  root.append(node('h3','','Documento para futura assinatura'));
  root.append(node('p','signature-description',
    'Prepare um registro interno do documento contratual associado a uma proposta. Ele não é uma assinatura e não registra aceite do cliente.'));
  const notice=node('p','signature-warning',
    'O arquivo original deve estar protegido fora deste formulário. O sistema armazena apenas referência e SHA-256 informados pelo operador; não confere o documento automaticamente.');
  root.append(notice);
  const toolbar=node('div','signature-toolbar');
  const refresh=button('Atualizar dossiês');toolbar.append(refresh);root.append(toolbar);
  const feedback=node('p','signature-feedback','Consultando propostas...');
  feedback.setAttribute('role','status');
  root.append(feedback);
  const createArea=node('div','signature-create-area');
  const history=node('div','signature-history');
  root.append(createArea,history);
  panel.append(root);
  const active=()=>root.isConnected&&isSessionActive();
  let busy=false,items=[],loaded=false,updatePrepareControls=null;
  const setBusy=value=>{
    busy=value;refresh.disabled=value;
    for(const e of createArea.querySelectorAll('input,select,button'))e.disabled=value;
    for(const e of history.querySelectorAll('textarea,button'))e.disabled=value;
    if(!value&&updatePrepareControls)updatePrepareControls();
  };
  function render(){
    updatePrepareControls=null;
    createArea.replaceChildren();history.replaceChildren();
    const eligible=items.filter(q=>q.eligible===true);
    if(isMaster&&eligible.length){
      const heading=node('h4','','Preparar referência contratual (sem envio)');
      const form=node('div','signature-form');
      const select=document.createElement('select');
      select.setAttribute('aria-label','Selecione a proposta para o dossiê');
      for(const item of eligible){
        const opt=node('option','','Proposta · versão '+item.draft_version);
        opt.value=item.id;select.append(opt);
      }
      const version=document.createElement('input');
      version.type='text';version.maxLength=40;version.autocomplete='off';
      version.placeholder='Ex.: v1.0';
      version.setAttribute('aria-label','Versão do documento contratual');
      const reference=document.createElement('input');
      reference.type='text';reference.maxLength=120;reference.autocomplete='off';
      reference.placeholder='Ex.: DOC-2026-0001';
      reference.setAttribute('aria-label','Referência interna do documento');
      const digest=document.createElement('input');
      digest.type='text';digest.maxLength=64;digest.autocomplete='off';
      digest.placeholder='64 caracteres hexadecimais';
      digest.setAttribute('aria-label','Hash SHA-256 do documento');
      const check=document.createElement('input');check.type='checkbox';check.checked=false;
      const checkLabel=node('label','signature-attestation');
      checkLabel.append(check,node('span','',
        'Conferi manualmente a versão, referência e hash do documento original armazenado em local seguro. Entendo que isto não comprova aceite do cliente.'));
      const send=button('Preparar dossiê (sem envio)','');
      const controls=[
        field('Proposta selecionada',select),field('Versão do documento',version),
        field('Referência interna (sem URL)',reference),field('SHA-256 informado',digest)
      ];
      form.append(...controls,checkLabel,send);
      createArea.append(heading,form);
      let preparedRequest=null;
      const eligibleData=()=>({
        p_quote:select.value,p_terms_version:version.value.trim(),
        p_document_ref:reference.value.trim(),p_document_sha256:digest.value.trim().toLowerCase(),
        p_operator_attested:true
      });
      const validate=()=>{
        const data=eligibleData();
        return /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(data.p_terms_version)&&
          /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$/.test(data.p_document_ref)&&
          !/^https?:\/\//i.test(data.p_document_ref)&&
          /^[0-9a-f]{64}$/.test(data.p_document_sha256)&&
          !/^0{64}$/.test(data.p_document_sha256)&&
          eligible.some(q=>q.id===data.p_quote)&&check.checked;
      };
      send.disabled=true;
      const update=()=>{send.disabled=busy||!validate()};
      updatePrepareControls=update;
      for(const e of [select,version,reference,digest])e.oninput=update;
      check.onchange=update;
      send.onclick=async()=>{
        if(busy||!active()||!validate())return;
        const payload=eligibleData(),hash=JSON.stringify(payload);
        if(!preparedRequest||preparedRequest.hash!==hash)
          preparedRequest={hash,id:crypto.randomUUID()};
        if(!await confirm({
          title:'Registrar referência contratual?',
          message:'Confirme que o documento original foi preservado com segurança e que sua referência, versão e hash foram conferidos. Isso NÃO o envia nem registra a assinatura do cliente.'
        }))return;
        if(!active())return;
        setBusy(true);feedback.textContent='Registrando referência do documento...';
        let result;
        try{result=await timed(sb.rpc('lkz_adm_prepare_signature_dossier',{
          ...payload,p_request_id:preparedRequest.id
        }))}catch{result={error:{code:'NETWORK'}}}
        if(!active())return;
        if(result.error||!result.data?.id||result.data?.status!=='prepared'||
            result.data?.signature_enabled!==false||
            result.data?.customer_accepted!==false||
            result.data?.billing_enabled!==false||
            result.data?.provisioning_enabled!==false){
          const code=result.error?.code||'RESPOSTA_INVALIDA';
          if(!['NETWORK','TIMEOUT','08P01'].includes(code))preparedRequest=null;
          feedback.textContent='Dossiê não confirmado ('+code+
            '). Confira o histórico; nenhuma assinatura ou cobrança foi realizada.';
          setBusy(false);return;
        }
        preparedRequest=null;
        await reload('Dossiê interno preparado. O cliente não recebeu o documento.');
      };
    }else if(!isMaster){
      createArea.append(node('p','signature-description',
        'A preparação de referências contratuais é reservada ao MASTER com MFA.'));
    }else{
      createArea.append(node('p','signature-description',
        'Prepare uma proposta atual e ainda não cancelada antes de criar o dossiê. Uma nova referência exige nova versão da proposta.'));
    }
    history.append(node('h4','','Histórico de referências e bloqueios'));
    if(!items.length)history.append(node('p','signature-empty','Nenhuma proposta interna cadastrada.'));
    for(const quote of items){
      const box=node('article','signature-entry');
      box.append(node('strong','','Proposta · versão '+quote.draft_version));
      if(!quote.current)box.append(node('small','signature-notice','Minuta comercial mudou desde esta versão.'));
      if(quote.status==='cancelled')box.append(node('small','signature-notice','Proposta cancelada.'));
      const d=quote.dossier;
      if(!d){
        box.append(node('p','signature-empty','Sem referência contratual registrada.'));
      }else{
        box.append(node('span','signature-state',
          d.status==='void'?'Referência invalidada':'Documento referenciado (NÃO ASSINADO)'));
        box.append(node('small','', 'Versão: '+d.terms_version+' · Referência: '+d.document_ref));
        box.append(node('small','signature-hash','SHA-256 declarado: '+d.document_sha256));
        box.append(node('small','', 'Preparado: '+dateLabel(d.prepared_at)));
        if(d.status==='void'){
          box.append(node('p','signature-notice','Motivo: '+String(d.void_reason||'Sem registro')));
        }else if(isMaster){
          const reason=document.createElement('textarea');
          reason.rows=2;reason.maxLength=500;
          reason.placeholder='Motivo de invalidação (mínimo 5 caracteres)';
          reason.setAttribute('aria-label','Motivo para invalidar o dossiê');
          const voidButton=button('Invalidar referência','danger-outline');
          let localRequest=null;
          voidButton.onclick=async()=>{
            if(busy||!active())return;
            const note=reason.value.trim();
            if(note.length<5||note.length>500){
              feedback.textContent='Informe justificativa entre 5 e 500 caracteres.';reason.focus();return;
            }
            if(!localRequest||localRequest.note!==note)
              localRequest={note,id:crypto.randomUUID()};
            if(!await confirm({
              title:'Invalidar referência contratual?',
              message:'O registro será preservado para auditoria e não poderá ser reutilizado. Uma nova referência exige uma nova proposta.',
              destructive:true
            }))return;
            if(!active())return;
            setBusy(true);feedback.textContent='Invalidando referência...';
            let result;
            try{result=await timed(sb.rpc('lkz_adm_void_signature_dossier',{
              p_dossier:d.id,p_reason:note,p_request_id:localRequest.id
            }))}catch{result={error:{code:'NETWORK'}}}
            if(!active())return;
            if(result.error||result.data?.status!=='void'||
              result.data?.signature_enabled!==false||
              result.data?.customer_accepted!==false){
              feedback.textContent='Invalidação não confirmada. Confira o histórico e tente novamente.';
              setBusy(false);return;
            }
            await reload('Referência invalidada e preservada na auditoria.');
          };
          box.append(reason,voidButton);
        }
      }
      history.append(box);
    }
    setBusy(false);
  }
  async function reload(message=''){
    if(!active())return;
    setBusy(true);feedback.textContent='Consultando referências contratuais...';
    let response;
    try{response=await timed(sb.rpc('lkz_adm_list_signature_dossiers',{
      p_contact:contact.id
    }))}catch{response={error:{code:'NETWORK'}}}
    if(!active())return;
    const data=response.data;
    if(response.error||!Array.isArray(data?.quotes)||
      data.signature_enabled!==false||data.customer_accepted!==false||
      data.billing_enabled!==false||data.provisioning_enabled!==false){
      loaded=false;
      feedback.textContent='Não foi possível consultar os dossiês ('+
        (response.error?.code||'RESPOSTA_INVALIDA')+').';
      setBusy(false);return;
    }
    items=data.quotes;loaded=true;
    render();
    feedback.textContent=message||'Referências atualizadas. Nenhum documento enviado ou assinado.';
  }
  refresh.onclick=()=>reload();
  await reload();
}
window.LKZSignatureDossiers=Object.freeze({mount});
})();