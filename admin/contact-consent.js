/* LKZ ADM · autorizações de contato por canal.
 * Registra somente comprovação referenciada, sem anexos, sem envio e sem armazenamento local.
 * A autorização e sua revogação são validadas pelo banco com MFA.
 */
(function(){
'use strict';
const channels=[['whatsapp','WhatsApp'],['email','E-mail']];
const methods=[
 ['web_form','Formulário com aceite explícito'],
 ['signed_document','Documento assinado'],
 ['email_confirmation','Confirmação por e-mail'],
 ['whatsapp_message','Mensagem do titular no WhatsApp'],
 ['call_recording','Gravação autorizada da manifestação']
];
function el(tag,cls,text){
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(text!==undefined)n.textContent=String(text);
  return n;
}
function button(text,cls='secondary'){
  const n=el('button','cta '+cls,text);n.type='button';return n;
}
function field(label,input){
  const wrapper=el('label','consent-field');
  wrapper.append(el('span','',label),input);
  return wrapper;
}
function selectOf(values){
  const select=document.createElement('select');
  for(const [id,text] of values){
    const opt=el('option','',text);opt.value=id;select.append(opt);
  }
  return select;
}
async function mount({panel,contact,sb,isMaster=false,isSessionActive,confirm,formatDate}){
  if(!panel?.isConnected||!contact?.id||!sb||!isSessionActive())return;
  if(panel.querySelector('[data-contact-consents]'))return;
  const container=el('section','contact-consents');
  container.dataset.contactConsents='';
  container.append(
    el('span','eyebrow','PRIVACIDADE E AUTORIZAÇÕES'),
    el('h3','','Autorizações de contato por canal'),
    el('p','consent-description',
      'Registre somente manifestações verificáveis do titular, com referência ao comprovante. A autorização de um canal não vale para outro.')
  );
  const transport=el('p','consent-transport','Nenhum envio automático está habilitado.');
  transport.setAttribute('role','status');container.append(transport);
  const statuses=el('div','consent-channel-list');container.append(statuses);
  const feedback=el('p','consent-feedback','');feedback.setAttribute('role','status');
  const reload=button('Atualizar autorizações');
  container.append(reload,feedback);

  const grantArea=el('div','consent-grant');
  if(isMaster){
    grantArea.append(el('h4','','Registrar autorização comprovada'));
    const expl=el('p','',
      'Informe somente o identificador interno de uma evidência preservada com segurança. Não cole conversas, dados pessoais, URLs ou credenciais.');
    const channel=selectOf(channels),method=selectOf(methods);
    channel.setAttribute('aria-label','Canal da autorização');
    method.setAttribute('aria-label','Origem da comprovação');
    const ref=document.createElement('input');
    ref.type='text';ref.maxLength=160;ref.autocomplete='off';
    ref.placeholder='Ex.: DOC-2026-001';
    ref.setAttribute('aria-label','Identificador interno do comprovante');
    const date=document.createElement('input');
    date.type='datetime-local';date.setAttribute('aria-label','Data da manifestação comprovada');
    const verified=document.createElement('input');
    verified.type='checkbox';verified.checked=false;
    const checkbox=el('label','consent-check');
    checkbox.append(verified,el('span','',
      'Declaro ter conferido a manifestação livre e inequívoca, sua finalidade e o comprovante indicado.'));
    const form=el('div','consent-form');
    form.append(field('Canal autorizado',channel),field('Tipo de comprovação',method),
      field('Referência interna do comprovante',ref),field('Data e hora da manifestação',date));
    const grant=button('Registrar autorização','');
    grant.disabled=true;
    const update=()=>{grant.disabled=busy||!verified.checked||!ref.value.trim()||!date.value};
    verified.onchange=update;ref.oninput=update;date.oninput=update;
    form.append(checkbox,grant);
    grantArea.append(expl,form);
    let request=null;
    grant.onclick=async()=>{
      const observed=new Date(date.value);
      const value=ref.value.trim();
      if(!verified.checked||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,159}$/.test(value)||
        /^https?:\/\//i.test(value)||Number.isNaN(observed.getTime())||
        observed.getTime()>Date.now()+300000){
        feedback.textContent='Comprovante inválido. Use ID interno, data válida e confirmação expressa.';
        return;
      }
      const params={p_contact:contact.id,p_channel:channel.value,p_method:method.value,
        p_proof_ref:value,p_observed_at:observed.toISOString(),p_evidence_checked:true};
      const key=JSON.stringify(params);
      if(!request||request.key!==key)request={key,id:crypto.randomUUID()};
      if(!await confirm({
        title:'Registrar autorização comprovada?',
        message:'Confirma que conferiu a manifestação do titular para este canal e a evidência está preservada? Não marque autorizações apenas porque o telefone ou e-mail existe.'
      }))return;
      if(!active())return;
      setBusy(true);feedback.textContent='Registrando autorização com auditoria...';
      let result;
      try{result=await sb.rpc('lkz_adm_grant_contact_consent',{
        p_request_id:request.id,...params
      })}catch{result={error:{code:'NETWORK'}}}
      if(!active())return;
      if(result.error||result.data?.status!=='grant'){
        feedback.textContent='Autorização não confirmada ('+(result.error?.code||'SEM_CONFIRMACAO')+
          '). Confira o histórico antes de repetir.';
        setBusy(false);return;
      }
      request=null;verified.checked=false;ref.value='';date.value='';
      feedback.textContent=result.data.already_recorded?
        'Autorização já registrada anteriormente. Nenhuma duplicação criada.':
        'Autorização registrada para este canal. Nenhuma mensagem foi enviada.';
      await load(feedback.textContent);
    };
  }
  container.append(grantArea);
  const historyBox=el('div','consent-history');
  historyBox.append(el('h4','','Histórico de autorizações e revogações'));
  const history=el('div','consent-history-list');
  historyBox.append(history);
  container.append(historyBox);
  const existing=panel.querySelector('.client-history');
  if(existing)existing.after(container);else panel.append(container);
  let busy=false,loaded=false,revocationRequest=null,cache={};
  const active=()=>container.isConnected&&isSessionActive();
  function setBusy(flag){
    busy=flag;reload.disabled=flag;
    for(const n of statuses.querySelectorAll('button,textarea'))n.disabled=flag;
    for(const n of grantArea.querySelectorAll('button,input,select'))n.disabled=flag;
    if(!flag&&isMaster){
      const grant=grantArea.querySelector('button');
      const check=grantArea.querySelector('input[type="checkbox"]');
      const evidence=grantArea.querySelector('input[type="text"]');
      const date=grantArea.querySelector('input[type="datetime-local"]');
      if(grant)grant.disabled=!check?.checked||!evidence?.value.trim()||!date?.value;
    }
  }
  function render(){
    statuses.replaceChildren();
    for(const [id,label] of channels){
      const info=cache.current?.[id],granted=info?.status==='grant';
      const card=el('article','consent-channel-card');
      const stale=info?.status==='stale';
      card.append(el('strong','',label),
        el('span',granted?'consent-active':stale?'consent-stale':info?.status==='revoke'?'consent-revoked':'consent-unknown',
          granted?'Autorização válida para o destino cadastrado':
          stale?'Desatualizada após alteração do destino':
          info?.status==='revoke'?'Revogada / oposição registrada':'Sem comprovação registrada'));
      if(info?.recorded_at)card.append(el('small','',
        'Último evento: '+formatDate(info.recorded_at)));
      if(!granted)card.append(el('p','',
        stale?'Telefone ou e-mail mudou. Registre nova manifestação para o destino atual antes de aprovar qualquer prévia.':
          'Nenhum contato comercial pode ser aprovado neste canal sem nova manifestação comprovada.'));
      const note=document.createElement('textarea');
      note.rows=2;note.maxLength=500;
      note.placeholder='Motivo ou origem do pedido (mín. 5 caracteres)';
      note.setAttribute('aria-label','Motivo da revogação no '+label);
      const revoke=button(granted?'Revogar autorização':'Registrar oposição','danger-outline');
      revoke.disabled=busy;
      revoke.onclick=async()=>{
        const reason=note.value.trim();
        if(reason.length<5||reason.length>500){
          feedback.textContent='Descreva o pedido de revogação/oposição (5 a 500 caracteres).';
          note.focus();return;
        }
        const payload={p_contact:contact.id,p_channel:id,p_reason:reason};
        const key=JSON.stringify(payload);
        if(!revocationRequest||revocationRequest.key!==key)
          revocationRequest={key,id:crypto.randomUUID()};
        if(!await confirm({
          title:'Registrar revogação ou oposição?',
          message:'Essa ação bloqueia a aprovação de mensagens neste canal. Nenhum contato será realizado pelo painel.',
          destructive:true
        }))return;
        if(!active())return;
        setBusy(true);feedback.textContent='Registrando revogação...';
        let result;
        try{result=await sb.rpc('lkz_adm_revoke_contact_consent',{
          p_request_id:revocationRequest.id,...payload
        })}catch{result={error:{code:'NETWORK'}}}
        if(!active())return;
        if(result.error||result.data?.status!=='revoke'){
          feedback.textContent='Revogação não confirmada ('+(result.error?.code||'SEM_CONFIRMACAO')+
            '). Verifique o histórico antes de tentar novamente.';
          setBusy(false);return;
        }
        revocationRequest=null;
        feedback.textContent='Revogação registrada e aplicada à aprovação do canal. Nenhum envio foi feito.';
        await load(feedback.textContent);
      };
      card.append(note,revoke);statuses.append(card);
    }
    history.replaceChildren();
    if(!cache.history?.length){
      history.append(el('p','', 'Nenhuma manifestação documentada até o momento.'));
    }else{
      for(const event of cache.history){
        const item=el('div','consent-history-item');
        item.append(el('strong','',
          (event.channel==='email'?'E-mail':'WhatsApp')+' · '+
          (event.action==='grant'?'Autorização registrada':'Revogação/oposição')));
        item.append(el('small','',formatDate(event.recorded_at)));
        if(event.action==='grant'){
          item.append(el('small','',
            'Método: '+String(event.method||'—')+' · Comprovante: '+String(event.proof_ref||'—')));
        }else item.append(el('small','',String(event.reason||'')));
        history.append(item);
      }
    }
    setBusy(false);
  }
  async function load(message=''){
    if(!active())return;
    setBusy(true);feedback.textContent='Consultando autorizações...';
    let response;
    try{response=await sb.rpc('lkz_adm_list_contact_consents',{p_contact:contact.id})}
    catch{response={error:{code:'NETWORK'}}}
    if(!active())return;
    if(response.error||!response.data?.current||!Array.isArray(response.data.history)){
      loaded=false;
      feedback.textContent='Não foi possível consultar autorizações ('+
        (response.error?.code||'SEM_RESPOSTA')+'). Atualize antes de registrar mudanças.';
      setBusy(false);return;
    }
    loaded=true;cache=response.data;
    render();
    feedback.textContent=message||'Autorizações atualizadas. Nenhum envio automático foi realizado.';
  }
  reload.onclick=()=>load();
  setBusy(false);await load();
}
window.LKZContactConsents=Object.freeze({mount});
})();