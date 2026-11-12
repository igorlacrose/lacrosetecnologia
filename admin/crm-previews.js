/* LKZ ADM • revisão supervisionada de prévias comerciais.
 * Sem envio, webhook, worker ou acesso direto a tabelas privadas.
 * Todos os dados vêm de RPCs com autorização/MFA no banco. */
(function(){
'use strict';

function node(tag,cls,text){
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(text!==undefined)el.textContent=String(text);
  return el;
}
function btn(label,cls){
  const el=node('button','cta '+(cls||''),label);
  el.type='button';
  return el;
}
function row(parent,tag,cls,text){
  const el=node(tag,cls,text);parent.append(el);return el;
}
const titles={pending:'Pendente de revisão',approved:'Aprovada — NÃO enviada',
  rejected:'Rejeitada',cancelled:'Cancelada'};
const channelTitle={whatsapp:'WhatsApp',email:'E-mail'};

async function readWithDeadline(requests,timeoutMs=15000){
  if(typeof setTimeout!=='function'||typeof clearTimeout!=='function')
    return Promise.all(requests);
  let timer;
  try{
    return await Promise.race([
      Promise.all(requests),
      new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(Object.assign(new Error('Timeout'),{code:'TIMEOUT'})),
          timeoutMs);
      })
    ]);
  }finally{clearTimeout(timer)}
}

async function mount({panel,lead,contact=null,sb,confirm,isMaster=false,isSessionActive,formatDate,openClient=null}){
  if(!panel?.isConnected||!lead?.id||!sb||!isSessionActive())return;
  if(panel.querySelector('[data-crm-preview]'))return;
  const shell=node('section','crm-preview');
  shell.dataset.crmPreview='';
  row(shell,'span','eyebrow','CONTROLE COMERCIAL');
  row(shell,'h3','','Pré-envio e aprovação');
  row(shell,'p','crm-preview-explain',
    'Revise destino, texto e consentimento antes de uma futura integração. Aprovar não envia mensagens.');
  const warn=row(shell,'p','crm-preview-disabled',
    'Transporte DESABILITADO: nenhuma prévia será transmitida por WhatsApp ou e-mail.');
  warn.setAttribute('role','status');
  const toolbar=node('div','crm-preview-toolbar');
  const channel=document.createElement('select');
  channel.setAttribute('aria-label','Canal para revisão');
  for(const [value,label] of [['whatsapp','WhatsApp'],['email','E-mail']]){
    const opt=node('option','',label);opt.value=value;channel.append(opt);
  }
  const request=btn('Solicitar revisão','');
  const reload=btn('Atualizar revisões','secondary');
  toolbar.append(channel,request,reload);shell.append(toolbar);
  const readiness=row(shell,'div','crm-preview-readiness','');
  readiness.setAttribute('aria-label','Requisitos para solicitar revisão e aprovação');
  const feedback=row(shell,'p','crm-preview-feedback','');
  feedback.setAttribute('role','status');
  const entries=row(shell,'div','crm-preview-list','');
  const existing=panel.querySelector('.lead-history');
  if(existing)existing.before(shell);else panel.append(shell);
  let busy=false,loaded=false,drafts=new Map(),items=[],requestToken=null;
  const destination=ch=>{
    if(!contact)return '';
    return ch==='email'?String(contact.email||'').trim().toLowerCase():
      String(contact.phone||'').replace(/\D/g,'');
  };
  const validDestination=ch=>{
    const value=destination(ch);
    return ch==='email'?value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value):
      /^[0-9]{10,13}$/.test(value);
  };
  const linked=()=>Boolean(lead.contact_id&&contact?.id===lead.contact_id);
  const consentReady=()=>Boolean(contact?.consent_contact&&contact?.consent_at);
  const pending=()=>items.some(item=>item.status==='pending'&&item.channel===channel.value);
  const active=()=>shell.isConnected&&isSessionActive();
  const canSubmit=()=>loaded&&linked()&&validDestination(channel.value)&&
    Boolean(drafts.get(channel.value)?.version)&&!pending();
  const setBusy=(flag)=>{
    busy=flag;channel.disabled=flag;
    request.disabled=flag||!canSubmit();
    reload.disabled=flag;
    for(const el of entries.querySelectorAll('button, textarea'))
      el.disabled=flag||el.dataset.previewApprove==='blocked';
  };
  function renderReadiness(){
    readiness.replaceChildren();
    row(readiness,'h4','','Antes de solicitar revisão');
    const steps=node('ol','crm-preview-steps');
    const ch=channel.value;
    const draft=drafts.get(ch);
    const hasLinked=linked(),hasDestination=hasLinked&&validDestination(ch);
    const requirements=[
      {ok:hasLinked,name:'Cliente vinculado',
        help:hasLinked?'Cadastro identificado no CRM.':
          'Vincule a oportunidade a um cliente no atendimento antes de revisar o envio.'},
      {ok:hasDestination,name:'Destino cadastrado e válido',
        help:hasDestination?'Destino disponível no cadastro.':
          'Confira o e-mail ou telefone do cliente no cadastro.'},
      {ok:!!draft?.version,name:'Rascunho salvo no canal',
        help:draft?.version?'Versão '+draft.version+' salva.':
          'Prepare e salve o texto na Central de Contato Manual.'},
      {ok:!pending(),name:'Nenhuma revisão pendente neste canal',
        help:pending()?'Resolva ou cancele a solicitação pendente antes de abrir outra.':
          'Canal liberado para nova solicitação.'}
    ];
    requirements.forEach((step,i)=>{
      const li=node('li',step.ok?'crm-preview-step-ready':'crm-preview-step-missing');
      row(li,'strong','',String(i+1)+'. '+step.name+(step.ok?' · OK':' · Pendente'));
      row(li,'small','',step.help);
      steps.append(li);
    });
    readiness.append(steps);
    const guidance=node('div','crm-preview-next');
    if(!hasLinked||!hasDestination){
      row(guidance,'p','','Próximo passo: completar e conferir o cadastro do cliente.');
      if(typeof openClient==='function'){
        const button=btn(hasLinked?'Abrir cadastro do cliente':'Ver clientes','secondary');
        button.onclick=()=>{if(active())openClient()};
        guidance.append(button);
      }
    }else if(!draft?.version){
      row(guidance,'p','','Próximo passo: salvar uma resposta para este canal.');
      const button=btn('Ir para rascunhos','secondary');
      button.onclick=()=>{
        const reply=panel.querySelector('[data-crm-reply]');
        if(reply?.scrollIntoView)reply.scrollIntoView({behavior:'smooth',block:'start'});
        const input=reply?.querySelector('textarea[aria-label="Rascunho da resposta comercial"]');
        input?.focus();
      };
      guidance.append(button);
    }else if(pending()){
      row(guidance,'p','','Já existe uma revisão aguardando decisão neste canal.');
    }else if(loaded){
      row(guidance,'p','','Pronto para solicitar a análise do texto salvo e do destino cadastrado.');
    }
    const legal=consentReady()?
      'Consentimento com data consta no cadastro (o servidor revalidará na aprovação).':
      'Aprovação exigirá autorização de contato documentada com data. Não registre consentimento sem evidência.';
    row(guidance,'p',consentReady()?'crm-preview-legal-ok':'crm-preview-legal-warning',
      legal);
    readiness.append(guidance);
  }
  function display(){
    entries.replaceChildren();
    if(!items.length)row(entries,'p','crm-preview-empty','Nenhuma prévia solicitada nesta oportunidade.');
    for(const item of items){
      const box=node('article','crm-preview-card');
      row(box,'strong','crm-preview-title',
        (channelTitle[item.channel]||item.channel)+' · '+(titles[item.status]||item.status));
      row(box,'small','crm-preview-meta',
        'Solicitada em '+formatDate(item.requested_at)+
        ' · Versão do rascunho '+item.draft_version);
      row(box,'div','crm-preview-destination','Destino verificado: '+String(item.recipient||''));
      const message=row(box,'p','crm-preview-message',item.body||'');
      message.setAttribute('aria-label','Texto da prévia');
      const warnings=[];
      if(!item.consent_ready)warnings.push('Consentimento com data não registrado ou revogado');
      if(!item.recipient_current)warnings.push('Destino alterado');
      if(!item.draft_current)warnings.push('Rascunho alterado');
      if(item.status==='pending'&&warnings.length)
        row(box,'p','crm-preview-warning','Aprovação bloqueada: '+warnings.join('; ')+'.');
      if(item.status==='approved'&&warnings.length)
        row(box,'p','crm-preview-warning',
          'Aprovação antiga não está mais apta: '+warnings.join('; ')+'. Continua sem envio.');
      if(item.status==='pending'){
        const decision=node('div','crm-preview-decision');
        const reason=document.createElement('textarea');
        reason.maxLength=500;reason.rows=2;
        reason.placeholder='Motivo da rejeição (mín. 5 caracteres)';
        reason.setAttribute('aria-label','Justificativa da decisão');
        const controls=node('div','crm-preview-decision-actions');
        const approve=btn('Aprovar sem enviar','');
        const reject=btn('Rejeitar','danger-outline');
        const cancel=btn('Cancelar solicitação','secondary');
        approve.dataset.previewApprove=(!isMaster||warnings.length>0)?'blocked':'ready';
        approve.disabled=!isMaster||warnings.length>0||busy;
        reject.disabled=!isMaster||busy;
        cancel.disabled=busy;
        const action=async(type)=>{
          if(busy||!active())return;
          const note=reason.value.trim();
          if(type==='reject'&&note.length<5){
            feedback.textContent='Informe pelo menos 5 caracteres para justificar a rejeição.';
            reason.focus();return;
          }
          const approved=await confirm({
            title:type==='approve'?'Aprovar prévia sem envio':'Registrar decisão sobre a prévia',
            message:type==='approve'
              ?'Esta aprovação não envia nenhuma mensagem e não habilita canais externos.'
              :'A decisão será registrada com auditoria e não enviará mensagens.',
            destructive:type!=='approve'
          });
          if(!approved||!active())return;
          setBusy(true);feedback.textContent='Registrando decisão...';
          let response;
          try{response=await sb.rpc('lkz_adm_crm_review_message_preview',
            {p_id:item.id,p_action:type,p_note:note||null});}
          catch{response={error:{code:'NETWORK'}}}
          if(!active())return;
          if(response.error||!response.data?.status){
            feedback.textContent='Decisão não confirmada ('+(response.error?.code||'SEM_RESPOSTA')+
              '). Recarregue antes de repetir.';
            setBusy(false);return;
          }
          await load('Decisão registrada: '+(titles[response.data.status]||response.data.status)+
            '. Nenhuma mensagem foi enviada.');
        };
        approve.onclick=()=>action('approve');
        reject.onclick=()=>action('reject');
        cancel.onclick=()=>action('cancel');
        if(isMaster){
          controls.append(approve,reject,cancel);
          decision.append(reason);
        }else{
          controls.append(cancel);
        }
        decision.append(controls);box.append(decision);
      }else{
        row(box,'p','crm-preview-final',
          'Decisão registrada. Não houve envio automático pelo painel.');
        if(item.review_note)row(box,'small','crm-preview-note','Nota: '+item.review_note);
      }
      entries.append(box);
    }
    renderReadiness();
    setBusy(false);
  }
  async function load(message=''){
    if(!active())return;
    setBusy(true);
    feedback.textContent='Atualizando revisões...';
    let results;
    try{
      results=await readWithDeadline([
        sb.rpc('lkz_adm_crm_list_message_previews',{p_lead:lead.id}),
        sb.rpc('lkz_adm_crm_list_reply_drafts',{p_lead:lead.id})
      ]);
    }catch(error){
      const code=error?.code==='TIMEOUT'?'TIMEOUT':'NETWORK';
      results=[{error:{code}},{error:{code}}];
    }
    if(!active())return;
    const [previews,resultDrafts]=results;
    if(previews.error||resultDrafts.error||
       !Array.isArray(previews.data)||!Array.isArray(resultDrafts.data)){
      loaded=false;
      feedback.textContent='Não foi possível consultar revisões ou rascunhos. Código: '+
        (previews.error?.code||resultDrafts.error?.code||'SEM_RESPOSTA')+
        '. Utilize Atualizar revisões para tentar novamente.';
      renderReadiness();
      setBusy(false);return;
    }
    items=previews.data;drafts=new Map(resultDrafts.data.map(d=>[d.channel,d]));
    loaded=true;
    display();
    feedback.textContent=message||(canSubmit()?
      'Registros atualizados. Pode solicitar a revisão do rascunho salvo.':
      'Registros atualizados. Consulte os requisitos abaixo para habilitar a revisão.');
  }
  channel.onchange=()=>{
    requestToken=null;
    renderReadiness();setBusy(false);
    feedback.textContent=canSubmit()?
      'Canal selecionado. Rascunho salvo disponível para revisão.':
      'Canal selecionado. Confira os requisitos para solicitar revisão.';
  };
  reload.onclick=()=>load('Revisões atualizadas. Confira os requisitos e registros abaixo.');
  request.onclick=async()=>{
    if(busy||!active())return;
    if(!canSubmit()){
      feedback.textContent='Solicitação não iniciada. Corrija os requisitos indicados no checklist.';
      renderReadiness();return;
    }
    const draft=drafts.get(channel.value);
    if(!draft?.version){
      feedback.textContent='Salve um rascunho neste canal na Central de Contato Manual antes de solicitar revisão.';
      return;
    }
    const token=requestToken &&
      requestToken.channel===channel.value&&requestToken.version===draft.version
      ?requestToken
      :{id:crypto.randomUUID(),channel:channel.value,version:draft.version};
    requestToken=token;
    if(!await confirm({
      title:'Solicitar revisão de pré-envio',
      message:'Será criada uma prévia imutável do texto salvo e do destino cadastrado. Nenhuma mensagem será enviada.'
    }))return;
    if(!active())return;
    setBusy(true);feedback.textContent='Registrando solicitação de revisão...';
    let result;
    try{result=await sb.rpc('lkz_adm_crm_submit_message_preview',{
      p_id:token.id,p_lead:lead.id,p_channel:token.channel,p_draft_version:token.version
    })}catch{result={error:{code:'NETWORK'}}}
    if(!active())return;
    if(result.error||!result.data?.id){
      feedback.textContent='Solicitação não confirmada ('+(result.error?.code||'SEM_RESPOSTA')+
        '). Repetir com o mesmo texto não criará uma segunda prévia.';
      setBusy(false);return;
    }
    requestToken=null;
    await load(result.data.already_recorded
      ?'Solicitação já existente; nenhuma duplicação criada.'
      :'Prévia criada para revisão. Transporte permanece desabilitado.');
  };
  renderReadiness();
  await load();
}
window.LKZCrmPreviews=Object.freeze({mount});
})();