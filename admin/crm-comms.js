/* LKZ ADM • comunicação comercial manual.
   Não envia mensagens nem usa armazenamento persistente do navegador.
   Dados acessados somente por RPCs privadas com sessão MFA. */
(function(){
'use strict';

const channels=[
  ['whatsapp','WhatsApp'],['email','E-mail'],['phone','Telefone'],['other','Outro canal']
];

function element(tag,className,text){
  const item=document.createElement(tag);
  if(className)item.className=className;
  if(text!==undefined&&text!==null)item.textContent=text;
  return item;
}
function action(label,style){
  const button=element('button','cta '+style,label);
  button.type='button';
  return button;
}
function labeledControl(label,control){
  const root=element('label','crm-reply-label');
  root.append(element('span','',label),control);
  return root;
}
function describeEvent(parent,channel,summary,formatDate){
  const events=parent.querySelector('[data-lead-events]');
  if(!events||!events.isConnected)return;
  const item=element('div','timeline-event');
  const dot=element('div','timeline-point');
  const copy=element('div');
  copy.append(
    element('strong','','Contato manual · '+(channels.find(c=>c[0]===channel)?.[1]||'Outro canal')),
    element('small','',formatDate(new Date().toISOString())+' · admin'),
    element('p','',summary)
  );
  item.append(dot,copy);
  // Evita perder a confirmação visual mesmo se a lista anterior ainda era vazia.
  const empty=events.querySelector('.support-note');
  if(empty)empty.remove();
  events.prepend(item);
}
async function mount({panel,lead,contact,sb,confirm,isSessionActive,formatDate}){
  if(!panel?.isConnected||!lead?.id||!sb)return;
  if(panel.querySelector('[data-crm-reply]'))return;
  const section=element('section','crm-reply');
  section.dataset.crmReply='';
  const title=element('h3','','Central de contato manual');
  const hint=element('p','crm-reply-hint',
    'Prepare e revise respostas. O painel não envia WhatsApp, e-mails nem SMS.');
  const person=contact
    ?[contact.person_name||contact.company_name,contact.email,contact.phone].filter(Boolean).join(' · ')
    :'Cliente ainda não vinculado a um cadastro';
  const context=element('p','crm-reply-context','Contato: '+person);
  const consent=element('p',contact?.consent_contact?'crm-reply-consent':'crm-reply-warning',
    contact?.consent_contact?'Consentimento para contato registrado no cadastro.':
      'Consentimento não registrado; confira a base legal antes de qualquer abordagem.');
  const channel=document.createElement('select');
  channel.setAttribute('aria-label','Canal do rascunho');
  for(const [value,name] of channels){
    const option=element('option','',name);option.value=value;channel.append(option);
  }
  const message=document.createElement('textarea');
  message.rows=5;message.maxLength=2500;
  message.placeholder='Escreva a resposta a ser revisada antes de utilizá-la.';
  message.setAttribute('aria-label','Rascunho da resposta comercial');
  const field=element('div','crm-reply-fields');
  field.append(labeledControl('Canal',channel),labeledControl('Rascunho — não enviado',message));

  const details=element('div','crm-reply-meta');
  const version=element('span','','Nenhum rascunho salvo');
  const count=element('span','','0 / 2500 caracteres');
  details.append(version,count);
  const actions=element('div','crm-reply-actions');
  const save=action('Salvar rascunho','');
  const copy=action('Copiar texto','secondary');
  const reload=action('Recarregar','secondary');
  const remove=action('Excluir rascunho','danger-outline');
  actions.append(save,copy,reload,remove);
  const info=element('p','crm-reply-status','');
  info.setAttribute('role','status');

  const manual=element('div','crm-manual-contact');
  manual.append(
    element('h4','','Registrar contato realizado'),
    element('p','','Após falar com o cliente por um canal externo, registre o resultado. Esta ação não envia mensagens.')
  );
  const summary=document.createElement('textarea');
  summary.rows=2;summary.maxLength=1500;
  summary.placeholder='Ex.: falei com o responsável, solicitou retorno amanhã.';
  summary.setAttribute('aria-label','Resumo do contato já realizado');
  const log=action('Registrar contato realizado','secondary');
  manual.append(labeledControl('Resumo obrigatório',summary),log);

  section.append(title,hint,context,consent,field,details,actions,info,manual);
  const history=panel.querySelector('.lead-history');
  if(history)history.before(section);else panel.append(section);

  const drafts=new Map();
  let currentChannel=channel.value;
  let busy=false,loaded=false;
  // A mesma tentativa usa a mesma chave, inclusive se a resposta se perder na rede.
  let manualRequest=null;
  const requestForManualContact=(note,channelName)=>{
    if(!manualRequest||manualRequest.note!==note||manualRequest.channel!==channelName){
      manualRequest={note,channel:channelName,id:crypto.randomUUID()};
    }
    return manualRequest.id;
  };
  const active=()=>section.isConnected&&isSessionActive();
  const currentDraft=()=>drafts.get(currentChannel)||null;
  const isDirty=()=>message.value.trim()!==(currentDraft()?.body||'');
  function toggle(){
    const saved=currentDraft();
    version.textContent=saved?'Versão '+saved.version+' · '+formatDate(saved.updated_at):
      'Nenhum rascunho salvo neste canal';
    count.textContent=message.value.length+' / 2500 caracteres';
    save.disabled=busy||!loaded||!message.value.trim()||!isDirty();
    copy.disabled=busy||!message.value.trim();
    remove.disabled=busy||!loaded||!saved;
    reload.disabled=busy;
    log.disabled=busy||summary.value.trim().length<5;
    channel.disabled=busy;
    message.disabled=busy||!loaded;
    summary.disabled=busy;
  }
  function apply(){
    message.value=currentDraft()?.body||'';
    info.textContent='Rascunho interno. Nenhuma mensagem foi enviada pelo LKZ ADM.';
    toggle();
  }
  async function fetchDrafts(){
    if(busy||!active())return;
    busy=true;toggle();info.textContent='Carregando rascunhos...';
    let result;
    try{result=await sb.rpc('lkz_adm_crm_list_reply_drafts',{p_lead:lead.id})}
    catch{result={error:{code:'NETWORK'}}}
    busy=false;
    if(!active())return;
    if(result.error||!Array.isArray(result.data)){
      loaded=false;info.textContent='Falha na consulta dos rascunhos (código '+
        (result.error?.code||'SEM_RESPOSTA')+'). Tente recarregar.';
      toggle();return;
    }
    drafts.clear();
    for(const row of result.data){
      if(row&&channels.some(ch=>ch[0]===row.channel))drafts.set(row.channel,row);
    }
    loaded=true;apply();
  }
  channel.onchange=async()=>{
    const chosen=channel.value;
    channel.value=currentChannel;
    if(isDirty()&&!await confirm({
      title:'Descartar alterações?',
      message:'O texto ainda não foi salvo. Trocar de canal descartará essas alterações.'
    }))return;
    if(!active())return;
    currentChannel=chosen;
    channel.value=chosen;apply();
  };
  message.oninput=()=>{info.textContent=isDirty()?'Texto ainda não salvo.':'Sem alterações pendentes.';toggle()};
  summary.oninput=toggle;
  save.onclick=async()=>{
    const body=message.value.trim();
    if(busy||!loaded||!body||body.length>2500||!active())return;
    const expected=currentDraft()?.version||0;
    busy=true;toggle();info.textContent='Salvando...';
    let result;
    try{result=await sb.rpc('lkz_adm_crm_save_reply_draft',{
      p_lead:lead.id,p_channel:currentChannel,p_body:body,p_expected_version:expected
    })}catch{result={error:{code:'NETWORK'}}}
    busy=false;
    if(!active())return;
    if(result.error||!result.data?.version){
      info.textContent='Rascunho não confirmado (código '+(result.error?.code||'SEM_RESPOSTA')+
        '). Se houve conflito, copie o texto antes de recarregar.';
      toggle();return;
    }
    drafts.set(currentChannel,result.data);
    message.value=result.data.body;
    info.textContent='Rascunho salvo. Ainda não foi enviado.';
    toggle();
  };
  remove.onclick=async()=>{
    const saved=currentDraft();
    if(busy||!loaded||!saved||!active())return;
    if(!await confirm({
      title:'Excluir rascunho salvo',
      message:'Esta exclusão remove apenas o rascunho deste canal, não o cliente nem o histórico.',
      keyword:'EXCLUIR',destructive:true
    }))return;
    if(!active())return;
    busy=true;toggle();info.textContent='Excluindo...';
    let result;
    try{result=await sb.rpc('lkz_adm_crm_delete_reply_draft',{
      p_lead:lead.id,p_channel:currentChannel,p_expected_version:saved.version
    })}catch{result={error:{code:'NETWORK'}}}
    busy=false;
    if(!active())return;
    if(result.error||result.data!==true){
      info.textContent='Exclusão não confirmada (código '+(result.error?.code||'SEM_RESPOSTA')+').';
      toggle();return;
    }
    drafts.delete(currentChannel);message.value='';
    info.textContent='Rascunho excluído. Nenhum cadastro foi alterado.';
    toggle();
  };
  copy.onclick=async()=>{
    const body=message.value.trim();
    if(!body||!active())return;
    try{
      if(!navigator.clipboard?.writeText)throw Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(body);
      info.textContent='Texto copiado. Envie manualmente no canal autorizado; nenhum envio foi feito aqui.';
    }catch{
      info.textContent='Cópia indisponível no navegador. Selecione o texto e copie manualmente.';
      message.focus();message.select();
    }
  };
  reload.onclick=async()=>{
    if(isDirty()&&!await confirm({
      title:'Recarregar rascunhos?',
      message:'O texto não salvo será descartado. Deseja consultar a versão mais recente?'
    }))return;
    if(active())await fetchDrafts();
  };
  log.onclick=async()=>{
    const note=summary.value.trim();
    if(busy||note.length<5||note.length>1500||!active())return;
    if(!await confirm({
      title:'Registrar contato efetivamente realizado?',
      message:'Confirme apenas se você realmente entrou em contato por fora do LKZ ADM. Isso não fará nenhum envio.'
    }))return;
    if(!active())return;
    const requestId=requestForManualContact(note,currentChannel);
    busy=true;toggle();info.textContent='Registrando contato...';
    let result;
    try{result=await sb.rpc('lkz_adm_crm_log_manual_contact_once',{
      p_lead:lead.id,p_channel:currentChannel,p_summary:note,p_request_id:requestId
    })}catch{result={error:{code:'NETWORK'}}}
    busy=false;
    if(!active())return;
    if(result.error||result.data?.registered!==true||result.data?.sent_by_system!==false){
      info.textContent='Registro não confirmado (código '+(result.error?.code||'SEM_RESPOSTA')+
        '). Se repetir sem mudar o resumo, o banco impedirá duplicação.';
      toggle();return;
    }
    summary.value='';
    manualRequest=null;
    info.textContent=result.data.already_recorded?
      'Contato já registrado na primeira tentativa. Nenhuma duplicação foi criada.':
      'Contato manual registrado no histórico. Nenhuma mensagem foi enviada pelo painel.';
    toggle();
    describeEvent(panel,currentChannel,note,formatDate);
  };
  toggle();
  await fetchDrafts();
}
window.LKZCrmComms=Object.freeze({mount});
})();