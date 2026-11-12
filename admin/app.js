'use strict';
const sb=window.supabase.createClient('https://icrtewhazpfauuroswri.supabase.co','sb_publishable_6PdAW2f-dpXhsaZXI0lyBg_PcGtuWgs',{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false}});
const el=id=>document.getElementById(id);
const ADMIN_IDLE_MS=30*60*1000; // trava após 30 minutos de inatividade, sem persistir refresh token
const accessGroups={master:'MASTER',admin:'Administrador',commercial:'Comercial',viewer:'Consulta'};
let user=null,profile=null,factorId=null,challengeId=null,idleTimer=null;
let lastInteractionAt=0,endingForIdle=false;
let state={leads:[],contacts:[],threads:[],followups:[],approvals:[]};
const CONVERSATION_POLL_MS=20000;
let currentView='overview',conversationPollTimer=null,conversationPollBusy=false;
let conversationFolder='active',conversationFocus=null,conversationFlash='';
let followupFilter='pending',followupFocus=null,leadFocus=null;
let trashBusy=false;
let clientFocus=null,clientMode='detail',clientDraft=null;
const systemCatalog=[
  {code:'LISP',name:'LKZ ISP Intelligence',description:'Indicadores gerenciais para provedores de internet.',url:'../lkzisp/'},
  {code:'LCRM',name:'Lacrose CRM',description:'Clientes, oportunidades, tarefas e conversas comerciais.',url:'https://lcrm.lacrosetecnologia.com.br/app/'}
];
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

function normalizedPhone(value){
  let digits=String(value||'').replace(/\D/g,'');
  if(digits.length===13&&digits.startsWith('55'))digits=digits.slice(2);
  return digits.length>=10&&digits.length<=11?digits:'';
}
function recognizedContactCandidates(lead,contacts){
  const d=lead?.structured_data&&typeof lead.structured_data==='object'?lead.structured_data:{};
  const email=String(d.contact_email||'').trim().toLowerCase();
  const phone=normalizedPhone(d.contact_phone);
  if(!email&&!phone)return [];
  return contacts.filter(c=>
    !!(email&&c.email&&c.email.trim().toLowerCase()===email)||
    !!(phone&&normalizedPhone(c.phone)===phone)
  );
}
function contactDisplayName(contact){
  return contact?.person_name||contact?.company_name||'Contato sem identificação';
}
const label=s=>({new:'Novo',diagnosing:'Diagnóstico',qualified:'Qualificado',human_review:'Revisão humana',contacted:'Contato realizado',proposal:'Proposta',won:'Fechado',lost:'Perdido',archived:'Arquivado',pending:'Pendente',approved:'Aprovado',rejected:'Rejeitado',done:'Concluído',cancelled:'Cancelado'})[s]||s;
const tag=s=>{const t=label(s),c=['Fechado','Aprovado','Concluído'].includes(t)?'ok':['Perdido','Rejeitado'].includes(t)?'err':['Pendente','Revisão humana','Proposta'].includes(t)?'warn':'info';return '<span class="tag '+c+'">'+esc(t)+'</span>'};
function msg(node,text){node.textContent=text||''}

let activeDialogCancel=null;
/* Confirmações internas: navegadores incorporados podem bloquear window.prompt/confirm. */
function askConfirmation({title,message,keyword='',destructive=false}){
  if(activeDialogCancel)return Promise.resolve(false);
  return new Promise(resolve=>{
    const previous=document.activeElement;
    const overlay=document.createElement('div');
    overlay.className='lkz-modal-overlay';
    const dialog=document.createElement('section');
    dialog.className='lkz-modal';
    dialog.setAttribute('role','alertdialog');
    dialog.setAttribute('aria-modal','true');
    const heading=document.createElement('h2');
    heading.id='lkz-dialog-heading';
    heading.textContent=title;
    dialog.setAttribute('aria-labelledby',heading.id);
    const body=document.createElement('p');
    body.textContent=message;
    dialog.append(heading,body);
    let input=null;
    if(keyword){
      const label=document.createElement('label');
      label.textContent='Digite '+keyword+' para confirmar:';
      input=document.createElement('input');
      input.type='text';input.autocomplete='off';input.spellcheck=false;
      input.maxLength=32;label.append(input);dialog.append(label);
    }
    const actions=document.createElement('div');
    actions.className='lkz-modal-actions';
    const cancel=document.createElement('button');
    cancel.type='button';cancel.className='cta secondary';cancel.textContent='Cancelar';
    const confirm=document.createElement('button');
    confirm.type='button';confirm.className=destructive?'cta danger':'cta';
    confirm.textContent=destructive?'Confirmar exclusão':'Confirmar';
    if(input)confirm.disabled=true;
    actions.append(cancel,confirm);dialog.append(actions);
    overlay.append(dialog);
    let finished=false;
    const close=value=>{
      if(finished)return;
      finished=true;activeDialogCancel=null;
      document.removeEventListener('keydown',onKey,true);
      overlay.remove();
      if(previous?.isConnected)previous.focus();
      resolve(value);
    };
    const onKey=event=>{
      if(event.key==='Escape'){event.preventDefault();close(false);}
      if(event.key==='Tab'){
        const focusables=[...(input?[input]:[]),cancel,confirm].filter(el=>!el.disabled);
        if(!focusables.length)return;
        const first=focusables[0],last=focusables[focusables.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    };
    activeDialogCancel=()=>close(false);
    document.body.append(overlay);
    cancel.onclick=()=>close(false);
    confirm.onclick=()=>close(!input||input.value===keyword);
    overlay.onclick=event=>{if(event.target===overlay)close(false)};
    input?.addEventListener('input',()=>{confirm.disabled=input.value!==keyword});
    document.addEventListener('keydown',onKey,true);
    (input||cancel).focus();
  });
}

function showLogin(text=''){activeDialogCancel?.();stopConversationPolling();setMenu(false);clearTimeout(idleTimer);el('app').hidden=true;el('content').replaceChildren();el('mfaScreen').hidden=true;el('auth').hidden=false;msg(el('authMsg'),text);el('password').value=''}
async function authorize(u){const {data,error}=await sb.from('profiles').select('full_name,role,active').eq('id',u.id).maybeSingle();if(error)throw error;return data&&data.active&&['master','admin'].includes(data.role)?data:null}
async function enforceMfa(p,u){const {data:aal,error}=await sb.auth.mfa.getAuthenticatorAssuranceLevel();if(error)throw error;if(aal?.currentLevel==='aal2')return enter(p,u);const {data:factors,error:fe}=await sb.auth.mfa.listFactors();if(fe)throw fe;let factor=factors?.totp?.[0];if(!factor){const {data:en,error:ee}=await sb.auth.mfa.enroll({factorType:'totp',friendlyName:'LKZ ADM'});if(ee)throw ee;factor=en;el('enroll').hidden=false;el('qr').src=en.totp?.qr_code||'';el('secret').textContent=en.totp?.secret||'';el('mfaIntro').textContent='Configure o autenticador e confirme o código.'}else{el('enroll').hidden=true;el('mfaIntro').textContent='Digite o código atual do autenticador.'}const {data:ch,error:ce}=await sb.auth.mfa.challenge({factorId:factor.id});if(ce)throw ce;profile=p;user=u;factorId=factor.id;challengeId=ch.id;el('auth').hidden=true;el('mfaScreen').hidden=false;el('code').value='';setTimeout(()=>el('code').focus(),40)}
async function expireIdleSession(){
  if(endingForIdle||!user)return;
  endingForIdle=true;
  clearTimeout(idleTimer);
  try{await sb.auth.signOut()}catch(error){console.warn('Não foi possível concluir o logout no servidor.',error?.code||'REDE')}
  user=null;profile=null;
  showLogin('Sessão encerrada após 24 horas sem atividade.');
  endingForIdle=false;
}
function verifyIdle(){
  if(!user||el('app').hidden)return;
  clearTimeout(idleTimer);
  const elapsed=Date.now()-lastInteractionAt;
  if(elapsed>=ADMIN_IDLE_MS||elapsed<0){void expireIdleSession();return}
  idleTimer=setTimeout(verifyIdle,Math.min(60000,ADMIN_IDLE_MS-elapsed));
}
function resetIdle(){
  if(!user)return;
  verifyIdle();
}
function recordActivity(event){
  if(!user||el('app').hidden)return;
  if(endingForIdle){
    event.preventDefault();event.stopImmediatePropagation();return;
  }
  if(Date.now()-lastInteractionAt>=ADMIN_IDLE_MS){
    event.preventDefault();
    event.stopImmediatePropagation();
    void expireIdleSession();return;
  }
  lastInteractionAt=Date.now();
  resetIdle();
}
document.addEventListener('pointerdown',recordActivity,true);
document.addEventListener('keydown',recordActivity,true);
window.addEventListener('focus',()=>{verifyIdle();void refreshLiveConversations()});
document.addEventListener('pageshow',verifyIdle);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'){verifyIdle();void refreshLiveConversations()}
});
async function enter(p,u){
  profile=p;user=u;lastInteractionAt=Date.now();
  el('auth').hidden=true;el('mfaScreen').hidden=true;el('app').hidden=false;
  el('userName').textContent=p.full_name||u.email;
  el('userRole').textContent=p.role;
  resetIdle();
  await loadCommercial();
  view('overview');
  startConversationPolling();
}
el('loginForm').onsubmit=async e=>{e.preventDefault();el('loginBtn').disabled=true;msg(el('authMsg'),'');try{const {data,error}=await sb.auth.signInWithPassword({email:el('email').value.trim(),password:el('password').value});if(error)throw error;const p=await authorize(data.user);if(!p){await sb.auth.signOut();throw new Error('Conta sem permissão administrativa.')}await enforceMfa(p,data.user)}catch(err){console.error(err);msg(el('authMsg'),err.message||'Falha no login.')}finally{el('loginBtn').disabled=false}};
el('mfaForm').onsubmit=async e=>{e.preventDefault();el('mfaBtn').disabled=true;try{const {error}=await sb.auth.mfa.verify({factorId,challengeId,code:el('code').value.trim()});if(error)throw error;await enter(profile,user)}catch(err){console.error(err);msg(el('mfaMsg'),'Código inválido ou expirado.')}finally{el('mfaBtn').disabled=false}};
el('cancelMfa').onclick=async()=>{await sb.auth.signOut();showLogin()};el('logout').onclick=async()=>{setMenu(false);await sb.auth.signOut();user=null;profile=null;showLogin()};
const LIST_BATCH_SIZE=200;
const LIST_MAX_ROWS=3000;

/* Paginação com limite explícito para impedir dashboards silenciosamente incompletos. */
async function loadPaged(table,fields,sort,ascending=false){
  const data=[];
  let total=null,lastPageSize=0;
  for(let offset=0;offset<LIST_MAX_ROWS;offset+=LIST_BATCH_SIZE){
    const take=Math.min(LIST_BATCH_SIZE,LIST_MAX_ROWS-offset);
    const result=await sb.from(table)
      .select(fields,offset===0?{count:'exact'}:{})
      .order(sort,{ascending})
      .order('id',{ascending:false})
      .range(offset,offset+take-1);
    if(result.error)throw result.error;
    const page=result.data||[];
    if(offset===0&&Number.isSafeInteger(result.count))total=result.count;
    data.push(...page);
    lastPageSize=page.length;
    if(page.length<take || (total!==null&&data.length>=total))break;
  }
  return {data,count:total,loaded:data.length,
    partial:total!==null?data.length<total:lastPageSize===LIST_BATCH_SIZE&&data.length===LIST_MAX_ROWS};
}
function dataScopeNotice(){
  if(!state.loadMeta?.partial)return '';
  return '<p class="operation-feedback" role="status">'+
    'Consulta parcial: alguns módulos atingiram o limite de '+LIST_MAX_ROWS+
    ' registros carregados. Os totais são contagens do banco, mas nem todos os itens estão nesta lista.'+
    ' Use filtros e solicite paginação server-side para volumes maiores.</p>';
}
async function loadCommercial(){
  const [lr,cr,vr,fr,ar,folders,trash,ocaTasks,ocaStatus]=await Promise.all([
    loadPaged('leads','*','updated_at'),
    loadPaged('contacts','id,company_name,person_name,segment,email,phone,city,state,created_at,updated_at,consent_contact','created_at'),
    loadPaged('conversations','id,lead_id,last_message_at,started_at,status,channel','last_message_at'),
    loadPaged('followups','*','due_at',true),
    loadPaged('approvals','*','requested_at'),
    sb.rpc('lkz_adm_list_conversation_folders'),
    sb.rpc('lkz_adm_trash_stats'),
    sb.rpc('lkz_adm_oca_list_tasks'),
    sb.rpc('lkz_adm_oca_status')
  ]);
  const err=folders.error||trash.error||ocaTasks.error||ocaStatus.error;
  if(err)throw err;
  const contacts=cr.data||[],cm=new Map(contacts.map(c=>[c.id,c])),lm=new Map();
  const folderMap=new Map((folders.data||[]).map(entry=>[entry.conversation_id,entry.folder]));
  (lr.data||[]).forEach(l=>{const c=cm.get(l.contact_id)||{};lm.set(l.id,{...l,name:c.company_name||c.person_name||'Contato sem nome',contact:c.phone||c.email||'—'})});
  state={
    contacts,leads:[...lm.values()],trashStats:trash.data||{messages:0,conversations:0},
    ocaTasks:ocaTasks.data||[],ocaStatus:ocaStatus.data||{enabled:false,open_tasks:0},
    loadMeta:{
      partial:[lr,cr,vr,fr,ar].some(item=>item.partial),
      counts:{leads:lr.count,contacts:cr.count,conversations:vr.count,followups:fr.count,approvals:ar.count},
      loaded:{leads:lr.loaded,contacts:cr.loaded,conversations:vr.loaded,followups:fr.loaded,approvals:ar.loaded}
    },
    threads:(vr.data||[]).map(c=>{
      const linkedLead=lm.get(c.lead_id);
      const linkedContact=linkedLead?.contact_id?cm.get(linkedLead.contact_id):null;
      const candidates=linkedContact?[]:recognizedContactCandidates(linkedLead,contacts);
      const suggested=candidates.length===1?candidates[0]:null;
      const verifiedName=linkedContact&&(linkedContact.person_name||linkedContact.company_name);
      const possibleName=suggested&&(suggested.person_name||suggested.company_name);
      return {
        id:c.id,lead_id:c.lead_id,
        lead:verifiedName?verifiedName:possibleName?'Possível: '+possibleName:
          'Atendimento '+c.id.slice(0,8).toUpperCase(),
        contactState:linkedContact?'linked':possibleName?'suggested':'unknown',
        suggestedContactIds:candidates.map(item=>item.id),
        last:c.last_message_at||c.started_at,channel:c.channel||'Site',
        folder:folderMap.get(c.id)||'active'
      };
    }),
    followups:(fr.data||[]).map(f=>({...f,lead:lm.get(f.lead_id)?.name||'Lead'})),
    approvals:(ar.data||[]).map(a=>({...a,lead:lm.get(a.lead_id)?.name||'Lead'}))
  };
}

/* Sincronização de atendimentos com consultas somente leitura.
   A publicação Realtime não está habilitada no banco; não presumir eventos push. */
function threadStampKey(items){
  return JSON.stringify(items.map(item=>[item.id,item.last]));
}
function conversationRefreshBlocked(){
  if(typeof trashBusy!=='undefined'&&trashBusy)return true;
  // Nunca redesenhar um atendimento durante uma confirmação ou vínculo de cliente.
  if(typeof activeDialogCancel!=='undefined'&&activeDialogCancel)return true;
  const root=el('chatWorkspace'),pane=el('messagePane');
  return !root?.isConnected ||
    document.activeElement===el('threadFilter') ||
    !!pane?.querySelector('[data-message-select]:checked') ||
    !!pane?.querySelector('[aria-busy="true"]') ||
    !!pane?.querySelector('[data-single]:disabled') ||
    (pane?.querySelector('[data-notice]')?.textContent||'').startsWith('Processando ');
}
async function refreshLiveConversations(){
  if(!user||endingForIdle||el('app').hidden||currentView!=='conversations'||
     document.visibilityState!=='visible'||conversationPollBusy||conversationRefreshBlocked())return;
  conversationPollBusy=true;
  try{
    const {data,error,count}=await sb.from('conversations')
      .select('id,last_message_at,started_at',{count:'exact'})
      .order('last_message_at',{ascending:false}).limit(100);
    if(error||!user||currentView!=='conversations'||conversationRefreshBlocked())return;
    const remoteKey=JSON.stringify((data||[]).map(item=>[item.id,item.last_message_at||item.started_at]));
    const currentTotal=state.loadMeta?.counts?.conversations;
    const countChanged=Number.isSafeInteger(count)&&Number.isSafeInteger(currentTotal)&&count!==currentTotal;
    if(!countChanged&&remoteKey===threadStampKey(state.threads.slice(0,100)))return;

    const selected=conversationFocus,folder=conversationFolder;
    const messageFolder=el('messagePane')?.querySelector('[data-folder][aria-pressed="true"]')?.dataset.folder||'active';
    const search=el('threadFilter')?.value||'';
    await loadCommercial();
    if(!user||currentView!=='conversations'||conversationRefreshBlocked())return;
    conversations(folder);
    if(search){
      const filter=el('threadFilter');
      filter.value=search;
      filter.dispatchEvent(new Event('input'));
    }
    if(selected&&state.threads.some(item=>item.id===selected&&item.folder===folder)){
      await openThread(selected,messageFolder);
    }
  }catch(error){
    // Não expor dados de atendimento em logs; nova tentativa no próximo ciclo.
    console.warn('lkz_adm_conversation_sync_failed',error?.code||'NETWORK');
  }finally{
    conversationPollBusy=false;
  }
}
function startConversationPolling(){
  stopConversationPolling();
  conversationPollTimer=setInterval(()=>{void refreshLiveConversations()},CONVERSATION_POLL_MS);
}
function stopConversationPolling(){
  if(conversationPollTimer!==null)clearInterval(conversationPollTimer);
  conversationPollTimer=null;
}

const titles={
  overview:['Central de comando','Ações prioritárias, clientes e operações do CRM interno.'],
  crm:['CRM · Pipeline','Oportunidades comerciais e trabalho operacional no próprio LKZ ADM.'],
  oca:['OCA · Operações','Tarefas internas criadas automaticamente pelo motor de regras.'],
  systems:['Sistemas','Acesso operacional aos sistemas da Lacrose.'],
  clients:['Clientes','Cadastros e contatos comerciais.'],
  finance:['Financeiro','Integração de cobrança pendente.'],
  usage:['Atividade','Indicadores dos registros comerciais carregados.'],
  tasks:['Demandas','Pendências comerciais que precisam de ação.'],
  commercial:['Visão comercial','Resumo dos registros comerciais.'],
  leads:['Oportunidades','Leads e estágios comerciais.'],
  conversations:['Atendimentos','Organize as conversas, identifique clientes e gerencie o histórico.'],
  followups:['Agenda de retornos','Agende, reagende, conclua e acompanhe seus retornos aqui.'],
  approvals:['Aprovações e exceções','Decisões humanas do fluxo comercial.'],
  settings:['Configurações','Sessão e gestão de acesso.']
};
const mobileMenu=el('mobileMenu'),sidebarBackdrop=el('sidebarBackdrop');
function setMenu(open){
  document.body.classList.toggle('menu-open',open);
  mobileMenu?.setAttribute('aria-expanded',String(open));
}
mobileMenu?.addEventListener('click',()=>setMenu(!document.body.classList.contains('menu-open')));
sidebarBackdrop?.addEventListener('click',()=>setMenu(false));
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view(b.dataset.view);setMenu(false)});
function view(v){currentView=v;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===v));el('title').textContent=titles[v][0];el('subtitle').textContent=titles[v][1];render(v)}
function k(l,v,m){return '<article class="kpi"><span>'+l+'</span><strong>'+v+'</strong><small>'+m+'</small></article>'}
function render(v){return {overview,crm,oca,systems,clients,finance,usage,tasks,commercial,leads,conversations,followups,approvals,settings}[v]()}

function dailyBrief(data, now=Date.now()){
  const dates=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Bahia',dateStyle:'short'});
  const today=dates.format(now);
  const actions=[];
  const inactive=new Set(data.leads.filter(l=>['won','lost','archived'].includes(l.status)).map(l=>l.id));
  const add=(item,priority,target,reason,stamp)=>{
    if(item.lead_id&&inactive.has(item.lead_id))return;
    actions.push({key:item.lead_id||target+':'+item.id,name:item.lead||item.name||'Oportunidade',
      leadId:item.lead_id||item.id,target,followupId:target==='followups'?item.id:null,
      approvalId:target==='approvals'?item.id:null,
      priority,reason,dueAt:Number.isFinite(stamp)?stamp:Infinity});
  };
  for(const f of data.followups){
    if(f.status!=='pending')continue;
    const due=Date.parse(f.due_at);
    if(due<now)add(f,0,'followups','Retorno atrasado',due);
    else if(Number.isFinite(due)&&dates.format(due)===today)add(f,2,'followups','Retorno hoje',due);
  }
  for(const a of data.approvals){
    if(a.status==='pending')add(a,1,'approvals','Aprovação pendente',Date.parse(a.requested_at));
  }
  for(const l of data.leads){
    if(l.status==='human_review'||l.needs_human_review)
      add({id:l.id,lead_id:l.id,lead:l.name},3,'leads','Necessita revisão comercial',Date.parse(l.updated_at));
  }
  actions.sort((a,b)=>a.priority-b.priority||a.dueAt-b.dueAt||a.key.localeCompare(b.key));
  const grouped=new Map();
  for(const action of actions){
    if(!grouped.has(action.key))grouped.set(action.key,{...action,reasons:new Set()});
    grouped.get(action.key).reasons.add(action.reason);
  }
  return {overdue:actions.filter(a=>a.priority===0).length,
    dueToday:actions.filter(a=>a.priority===2).length,
    approvals:actions.filter(a=>a.priority===1).length,
    priorities:[...grouped.values()]};
}

/* Análise determinística local: identifica ações úteis; nunca envia ou cobra sozinho. */
function ocaInternalTriage(data,now=Date.now()){
  const pending=new Set(data.followups.filter(f=>f.status==='pending').map(f=>f.lead_id));
  const closed=new Set(['won','lost','archived']);
  const results=[];
  for(const lead of data.leads){
    if(closed.has(lead.status))continue;
    const updated=Date.parse(lead.updated_at);
    const ageHours=Number.isFinite(updated)?(now-updated)/3600000:0;
    let action=null,reason='',priority=9;
    if(lead.status==='human_review'||lead.needs_human_review){
      action='review';reason='Exige revisão comercial';priority=0;
    }else if(!lead.contact_id){
      action='identify';reason='Identificação do cliente pendente';priority=1;
    }else if(['qualified','contacted'].includes(lead.status)&&!pending.has(lead.id)){
      action='schedule';reason='Qualificado sem retorno agendado';priority=2;
    }else if(lead.status==='diagnosing'&&ageHours>=48){
      action='review';reason='Diagnóstico sem atualização há 48h';priority=3;
    }else if(lead.status==='new'&&ageHours>=24){
      action='review';reason='Novo lead aguardando análise há 24h';priority=4;
    }
    if(action)results.push({id:lead.id,name:lead.name,reason,action,priority,updated:updated||0});
  }
  return results.sort((a,b)=>a.priority-b.priority||a.updated-b.updated||a.id.localeCompare(b.id));
}
function openTriageAction(id,action){
  const lead=state.leads.find(item=>item.id===id);
  if(!lead)return;
  if(action==='schedule'){
    followupFilter='pending';followupFocus=null;
    view('followups');openFollowupEditor('create',null,id);
    return;
  }
  if(action==='identify'){
    const thread=state.threads.find(t=>t.lead_id===id&&t.folder!=='deleted');
    if(thread){
      conversationFolder=thread.folder;
      view('conversations');
      conversations(thread.folder,thread.id);
      return;
    }
  }
  openOpportunity(id);
}
function navigatePriority(target,followupId,leadId){
  if(target==='followups'){
    followupFocus=followupId||null;followupFilter='all';view('followups');

  }else if(target==='leads'||target==='approvals'){
    if(target==='approvals'&&!leadId){view('approvals');return}
    openOpportunity(leadId);
  }else view('crm');
}
function overview(){
  const info=dailyBrief(state);
  const suggestions=ocaInternalTriage(state);
  const list=info.priorities.slice(0,12).map(item=>
    '<article class="priority-item"><span class="priority-dot'+(item.priority===0?' overdue':'')+'"></span>'+
      '<div><strong>'+esc(item.name)+'</strong><small>'+esc([...item.reasons].join(' · '))+'</small></div>'+
      '<button class="cta secondary" type="button" data-priority="'+esc(item.key)+'">Abrir ficha</button></article>').join('');
  const pending=state.followups.filter(f=>f.status==='pending').length;
  el('content').innerHTML=
    '<section class="welcome-strip"><div><span class="eyebrow">OPERAÇÃO COMERCIAL</span>'+
    '<h2>Seu negócio, em uma única central.</h2>'+
    '<p>Clientes, conversas, oportunidades e agenda trabalhando juntos — sem depender de outro CRM.</p></div>'+
    '<div class="welcome-actions"><button type="button" class="cta" data-overview="crm">Abrir CRM</button>'+
    '<button type="button" class="cta secondary" data-overview="followups">Agenda</button></div></section>'+
    dataScopeNotice()+'<div class="grid dashboard-kpis">'+
      k('Oportunidades',state.loadMeta?.counts.leads??state.leads.length,'Registros comerciais')+
      k('Atendimentos',state.threads.filter(t=>t.folder==='active').length,'Na caixa de entrada carregada')+
      k('Retornos pendentes',pending,'Aguardando ação')+
      k('Clientes',state.loadMeta?.counts.contacts??state.contacts.length,'Cadastros disponíveis')+
    '</div><div class="dashboard-lower">'+
      '<section class="panel priorities-panel"><div class="panel-head"><div><span class="eyebrow">O QUE FAZER AGORA</span>'+
      '<h2>Prioridades do dia</h2></div><span class="mini-count">'+info.priorities.length+' pendência(s)</span></div>'+
      (list||'<div class="empty-state"><strong>Tudo em dia por aqui.</strong><p>Nenhum retorno ou aprovação pendente nesta consulta.</p></div>')+
      '</section><section class="panel next-actions"><span class="eyebrow">ACESSO RÁPIDO</span>'+
      '<h2>Trabalho operacional</h2>'+
      '<button type="button" data-overview="conversations"><span>Atendimentos</span><small>Conversas, histórico e lixeiras</small></button>'+
      '<button type="button" data-overview="leads"><span>Oportunidades</span><small>Negociação, notas e histórico</small></button>'+
      '<button type="button" data-overview="followups"><span>Agenda de retornos</span><small>Agendar, reagendar e concluir</small></button>'+
      '<button type="button" data-overview="clients"><span>Clientes</span><small>Cadastro, contatos e relacionamento</small></button>'+ 
      '<button type="button" data-overview="oca"><span>OCA · Operações</span><small>Tarefas internas automáticas, auditoria e controle</small></button>'+
      '</section></div>'+
      '<section class="panel oca-triage"><div class="panel-head"><div><span class="eyebrow">OCA · TRIAGEM INTERNA</span>'+
        '<h2>Próximas ações sugeridas</h2></div><span class="mini-count">'+suggestions.length+' pendência(s)</span></div>'+
        '<p class="support-note">Análise automática dos registros carregados. Nenhuma mensagem, cobrança ou mudança comercial é enviada sem confirmação.</p>'+
        '<div class="oca-triage-grid">'+
        (suggestions.slice(0,8).map(item=>'<article class="oca-triage-item">'+
          '<div><strong>'+esc(item.name)+'</strong><small>'+esc(item.reason)+'</small></div>'+
          '<button type="button" class="cta secondary" data-oca-lead="'+esc(item.id)+'" data-oca-action="'+item.action+'">'+
          (item.action==='schedule'?'Preparar retorno':item.action==='identify'?'Identificar cliente':'Revisar ficha')+
          '</button></article>').join('')||
          '<p class="empty-state">Nenhuma ação interna sugerida para os registros carregados.</p>')+
        '</div></section>';
  el('content').querySelectorAll('[data-oca-lead]').forEach(button=>button.onclick=()=>openTriageAction(button.dataset.ocaLead,button.dataset.ocaAction));
  el('content').querySelectorAll('[data-overview]').forEach(b=>b.onclick=()=>view(b.dataset.overview));
  el('content').querySelectorAll('[data-priority]').forEach(b=>b.onclick=()=>{
    const p=info.priorities.find(a=>a.key===b.dataset.priority);
    if(p)navigatePriority(p.target,p.followupId,p.leadId);
  });
}
function commercial(){
  const pending=state.approvals.filter(item=>item.status==='pending');
  const review=state.leads.filter(item=>!['lost','won','archived'].includes(item.status)&&
    (item.needs_human_review===true||item.status==='human_review'));
  const actions=[
    ...pending.map(item=>({name:item.lead,detail:'Aprovação pendente',view:'approvals'})),
    ...review.filter(item=>!pending.some(approval=>approval.lead_id===item.id))
      .map(item=>({name:item.name,detail:'Escopo para revisar',view:'leads'}))
  ];
  const tools=[
    ['clients','Clientes','Cadastros do agente e registros manuais.'],
    ['leads','Leads','Oportunidades, interesse e estágio comercial.'],
    ['conversations','Conversas','Histórico e organização das mensagens.'],
    ['followups','Follow-ups','Prazos e retornos do comercial.'],
    ['approvals','Aprovações','Decisões de contato e propostas.'],
    ['tasks','Demandas','Prioridades comerciais do dia.']
  ];
  el('content').innerHTML='<div class="grid">'+
    k('Leads',state.leads.length,'Registros carregados')+k('Conversas',state.threads.length,'Registros carregados')+
    k('Revisão humana',review.length,'Oportunidades abertas')+k('Follow-ups',state.followups.filter(f=>f.status==='pending').length,'Pendentes')+
    k('Aprovações',pending.length,'Pendentes')+k('Fechados',state.leads.filter(l=>l.status==='won').length,'Nos registros carregados')+
    '</div><section class="panel commercial-panel"><h2>Decisões humanas</h2>'+
    '<p>Revisões e aprovações pendentes no fluxo comercial.</p>'+
    (actions.slice(0,12).map(item=>'<div class="row"><span><b>'+esc(item.name)+'</b><br>'+esc(item.detail)+
      '</span><button type="button" class="cta" data-commercial-view="'+item.view+'">Abrir</button></div>').join('')||
      '<p>Nenhuma decisão encontrada nos registros carregados.</p>')+
    '</section><section class="panel commercial-panel"><h2>Ferramentas comerciais</h2><div class="commercial-tools">'+
    tools.map(([viewId,title,description])=>'<article><h3>'+title+'</h3><p>'+description+
      '</p><button class="cta" type="button" data-commercial-view="'+viewId+'">Abrir '+title+'</button></article>').join('')+
    '<article><h3>CRM do LKZ ADM</h3><p>Pipeline e operações comerciais no painel.</p>'+
    '<button class="cta" type="button" data-commercial-view="crm">Abrir CRM</button></article></div></section>';
  el('content').querySelectorAll('[data-commercial-view]').forEach(button=>button.onclick=()=>view(button.dataset.commercialView));
}


const ocaRuleLabels={
 human_review:'Revisão comercial pendente',
 identify_contact:'Identificar o cliente',
 schedule_followup:'Preparar retorno comercial',
 stalled_diagnosis:'Diagnóstico parado há mais de 48h',
 stalled_new:'Novo lead sem análise há mais de 24h'
};
const ocaActionForRule=rule=>
 rule==='identify_contact'?'identify':rule==='schedule_followup'?'schedule':'review';
function oca(feedback=''){
 const tasks=state.ocaTasks||[];
 const status=state.ocaStatus||{};
 const opens=tasks.filter(t=>t.status==='open');
 const leadMap=new Map(state.leads.map(l=>[l.id,l]));
 const count=status.open_tasks??opens.length;
 const taskRows=opens.map(t=>{
   const lead=leadMap.get(t.lead_id);
   return '<article class="oca-worker-item">'+
      '<div class="oca-worker-item-body"><strong>'+esc(lead?.name||'Oportunidade não carregada')+'</strong>'+
      '<small>'+esc(ocaRuleLabels[t.rule_code]||t.rule_code)+' · '+esc(dateLabel(t.created_at))+'</small>'+
      '</div><div class="oca-worker-actions">'+
      (lead?'<button class="cta secondary" type="button" data-oca-open="'+esc(t.id)+'">Abrir ficha</button>':'')+
      '<button class="cta secondary" type="button" data-oca-resolve="'+esc(t.id)+'" data-oca-action="done">Concluir</button>'+
      '<button class="cta danger-outline" type="button" data-oca-resolve="'+esc(t.id)+'" data-oca-action="dismissed">Dispensar</button>'+
      '</div></article>';
 }).join('');
 el('content').innerHTML=
  '<section class="crm-topbar"><div><span class="eyebrow">OCA · EXECUÇÃO AUTÔNOMA CONTROLADA</span>'+
   '<h2>Operações internas</h2><p>O motor identifica pendências, cria tarefas e registra decisões sem enviar mensagens ou cobrar clientes.</p></div>'+
   '<button type="button" class="cta secondary" data-oca-refresh>Atualizar tarefas</button></section>'+
  '<div class="grid crm-mini-stats">'+
   k('Motor',status.enabled?'Ativo':'Pausado','Execução programada')+
   k('Tarefas abertas',count,'Pendências registradas')+
   k('Última execução',status.last_run_at?dateLabel(status.last_run_at):'Ainda não houve','Motor do banco')+
  '</div>'+
  '<section class="panel oca-worker-controls"><div><h2>Controle do motor</h2>'+
   '<p>Verificação de segunda a sexta, às 11h10 (horário da Bahia). Limite de 25 novas tarefas por execução e uma tarefa aberta por oportunidade.</p>'+
   '<p class="support-note">As tarefas são internas. Nenhuma ação altera o estágio comercial nem envia WhatsApp, Telegram ou cobrança automaticamente.</p></div>'+
   (profile?.role==='master'?'<div class="oca-worker-control-buttons">'+
     '<button class="cta" type="button" data-oca-run>Executar verificação agora</button>'+
     '<button class="cta secondary" type="button" data-oca-toggle="'+(status.enabled?'off':'on')+'">'+
      (status.enabled?'Pausar motor':'Ativar motor')+'</button></div>':'')+
  '</section>'+
  '<p class="operation-feedback" data-oca-feedback role="status">'+esc(feedback)+'</p>'+
  dataScopeNotice()+
  '<section class="panel oca-worker-list"><div class="panel-head"><h2>Fila de tarefas abertas</h2><span class="mini-count">'+count+' no banco</span></div>'+
   (taskRows||'<p class="empty-state">Nenhuma tarefa aberta. O motor continuará verificando novas oportunidades nos horários programados.</p>')+
  '</section>';
 const root=el('content');
 root.querySelector('[data-oca-refresh]').onclick=()=>reloadOca();
 root.querySelectorAll('[data-oca-open]').forEach(button=>button.onclick=()=>{
  const task=opens.find(t=>t.id===button.dataset.ocaOpen);
  if(task)openTriageAction(task.lead_id,ocaActionForRule(task.rule_code));
 });
 root.querySelectorAll('[data-oca-resolve]').forEach(button=>button.onclick=async()=>{
  const task=opens.find(t=>t.id===button.dataset.ocaResolve);
  if(!task)return;
  const action=button.dataset.ocaAction;
  if(!await askConfirmation({title:action==='done'?'Concluir tarefa':'Dispensar tarefa',
    message:action==='done'?'Marcar esta ação interna como concluída?':'Dispensar a tarefa? Ela poderá reaparecer em uma semana se a pendência continuar.',
    destructive:action==='dismissed'}))return;
  await ocaRpc('lkz_adm_oca_resolve_task',{p_id:task.id,p_action:action},'Tarefa atualizada com auditoria.');
 });
 root.querySelector('[data-oca-run]')?.addEventListener('click',async()=>{
  if(!await askConfirmation({title:'Executar triagem OCA',
    message:'Criar agora tarefas internas de acordo com as regras. Nenhum contato ou pagamento será enviado.'}))return;
  await ocaRpc('lkz_adm_oca_run_now',{},'Verificação executada. A fila foi atualizada.');
 });
 root.querySelector('[data-oca-toggle]')?.addEventListener('click',async event=>{
  const enable=event.currentTarget.dataset.ocaToggle==='on';
  if(!await askConfirmation({title:enable?'Ativar motor':'Pausar motor',
    message:enable?'Habilitar geração automática de tarefas internas nos dias úteis?':
      'Pausar a criação de novas tarefas automáticas? As existentes serão mantidas.'}))return;
  await ocaRpc('lkz_adm_oca_set_enabled',{p_enabled:enable},enable?'Motor ativado.':'Motor pausado.');
 });
}
async function ocaRpc(name,args,message){
 const root=el('content');
 root.querySelectorAll('[data-oca-run],[data-oca-toggle],[data-oca-resolve]').forEach(b=>b.disabled=true);
 let result;
 try{result=await sb.rpc(name,args)}
 catch{result={error:{code:'REDE'}}}
 if(!user||currentView!=='oca')return;
 if(result.error){
   oca('Falha na operação. Código: '+esc(result.error?.code||'SEM_RESPOSTA')+'. Atualize para verificar o estado.');
   return;
 }
 await reloadOca(message);
}
async function reloadOca(feedback=''){
 const [tasks,status]=await Promise.all([
  sb.rpc('lkz_adm_oca_list_tasks'),sb.rpc('lkz_adm_oca_status')
 ]);
 if(!user||currentView!=='oca')return;
 if(tasks.error||status.error){
  const text='Falha ao atualizar tarefas. Código: '+(tasks.error?.code||status.error?.code||'REDE');
  const target=el('content').querySelector('[data-oca-feedback]');
  if(target)target.textContent=text;
  return;
 }
 state.ocaTasks=tasks.data||[];
 state.ocaStatus=status.data||{enabled:false};
 oca(feedback);
}
const crmStages=[
  ['new','Novos'],['diagnosing','Diagnóstico'],['qualified','Qualificados'],
  ['human_review','Revisão'],['contacted','Contato feito'],['proposal','Propostas'],['won','Fechados']
];
function openOpportunity(id){
  leadFocus=id;el('search').value='';view('leads');
}
function crm(){
  const active=state.leads.filter(l=>!['archived','lost'].includes(l.status));
  const closed=state.leads.filter(l=>['archived','lost'].includes(l.status)).length;
  const cols=crmStages.map(([status,title])=>{
    const matches=active.filter(l=>l.status===status);
    return '<section class="pipeline-column"><div class="pipeline-col-head"><span>'+esc(title)+'</span>'+
      '<b>'+matches.length+'</b></div><div class="pipeline-col-body">'+
      (matches.map(l=>
        '<button type="button" class="pipeline-card" data-crm-lead="'+esc(l.id)+'">'+
        '<strong>'+esc(l.name)+'</strong><small>'+esc(l.suggested_solution||l.intent||'Interesse não informado')+'</small>'+
        '<span>'+esc(dateLabel(l.updated_at))+'</span></button>').join('')||
        '<p class="pipeline-empty">Sem oportunidades</p>')+'</div></section>';
  }).join('');
  el('content').innerHTML=
    '<section class="crm-topbar"><div><span class="eyebrow">CRM LACROSE</span>'+
    '<h2>Funil comercial</h2><p>Etapas e registros reais do banco — movimentação com autorização e histórico.</p></div>'+
    '<div><button type="button" class="cta" data-crm-goto="leads">Gerenciar oportunidades</button>'+
    '<button type="button" class="cta secondary" data-crm-goto="followups">Nova atividade</button></div></section>'+
    dataScopeNotice()+'<div class="grid crm-mini-stats">'+k('Oportunidades abertas',active.length,'Carregadas em atendimento')+
      k('Retornos pendentes',state.followups.filter(f=>f.status==='pending').length,'Na agenda')+
      k('Encerrados / arquivados',closed,'Histórico preservado')+'</div>'+
    '<div class="pipeline-board" aria-label="Funil comercial">'+cols+'</div>'+
    '<p class="support-note">Negociação, notas, mudanças de etapa e agendamento são feitos na ficha de cada oportunidade.</p>';
  el('content').querySelectorAll('[data-crm-lead]').forEach(b=>b.onclick=()=>openOpportunity(b.dataset.crmLead));
  el('content').querySelectorAll('[data-crm-goto]').forEach(b=>b.onclick=()=>{
    view(b.dataset.crmGoto);
    if(b.dataset.crmGoto==='followups')openFollowupEditor('create');
  });
}

function leads(){
  const query=(el('search')?.value||'').trim().toLowerCase();
  const records=query?state.leads.filter(l=>
    [l.name,l.contact,l.intent,l.category,l.suggested_solution,l.problem]
      .some(v=>String(v||'').toLowerCase().includes(query))):state.leads;
  const table=records.map(l=>
    '<tr><td><div class="client-name-cell"><strong>'+esc(l.name)+'</strong>'+
      '<small>'+esc(l.source||'Origem não informada')+'</small></div></td>'+
    '<td>'+esc(l.contact)+'</td><td>'+esc(l.suggested_solution||l.intent||l.category||'—')+'</td>'+
    '<td>'+tag(l.status)+'</td><td>'+esc(dateLabel(l.updated_at))+'</td>'+
    '<td><button class="cta secondary" type="button" data-lead="'+esc(l.id)+'">Abrir ficha</button></td></tr>').join('');
  el('content').innerHTML=
    '<section class="crm-topbar"><div><span class="eyebrow">RELACIONAMENTO</span><h2>Oportunidades</h2>'+
    '<p>Registre a evolução comercial, acompanhe o histórico e programe retornos.</p></div>'+
    '<button class="cta secondary" type="button" data-go-pipeline>Ver pipeline</button></section>'+
    dataScopeNotice()+'<p class="result-count">'+records.length+' oportunidade(s) encontrada(s) nos registros carregados</p>'+
    '<div id="leadDetails"></div><div class="table opportunity-table"><table>'+
    '<thead><tr><th>Oportunidade</th><th>Contato</th><th>Interesse</th><th>Etapa</th><th>Atualização</th><th>Ação</th></tr></thead>'+
    '<tbody>'+table+'</tbody></table></div>';
  el('content').querySelectorAll('[data-lead]').forEach(b=>b.onclick=()=>showOpportunity(b.dataset.lead));
  el('content').querySelector('[data-go-pipeline]').onclick=()=>view('crm');
  if(leadFocus&&records.some(l=>l.id===leadFocus))showOpportunity(leadFocus);
}
async function showOpportunity(id,feedback=''){
  const lead=state.leads.find(l=>l.id===id),container=el('leadDetails');
  if(!lead||!container)return;
  leadFocus=id;
  const current=lead.status;
  const statuses=[['new','Novo'],['diagnosing','Diagnóstico'],['qualified','Qualificado'],
    ['human_review','Revisão humana'],['contacted','Contatado'],['lost','Perdido'],['archived','Arquivado']];
  const locked=['proposal','won'].includes(current);
  const options=locked
    ?'<option value="'+esc(current)+'">'+esc(label(current))+' (fluxo protegido)</option>'
    :statuses.map(([value,text])=>'<option value="'+value+'"'+(value===current?' selected':'')+'>'+text+'</option>').join('');
  container.innerHTML=
    '<section class="panel opportunity-profile"><div class="client-panel-head"><div>'+
      '<span class="eyebrow">FICHA COMERCIAL</span><h2>'+esc(lead.name)+'</h2>'+
      '<p>'+tag(lead.status)+' · '+esc(lead.contact)+'</p></div>'+
      '<div class="action-row"><button class="cta secondary" type="button" data-lead-followup>Agendar retorno</button>'+
        '<button class="cta secondary" type="button" data-close-lead>Fechar</button></div></div>'+
      '<div class="lead-detail-grid">'+
        '<article><span>Necessidade identificada</span><strong>'+esc(lead.problem||lead.intent||'Não informada')+'</strong></article>'+
        '<article><span>Solução sugerida</span><strong>'+esc(lead.suggested_solution||'Não definida')+'</strong></article>'+
        '<article><span>Segmento</span><strong>'+esc(lead.category||'Não informado')+'</strong></article>'+
        '<article><span>Prioridade / pontuação</span><strong>'+esc(lead.priority||'normal')+' · '+esc(lead.score??'—')+'</strong></article>'+
      '</div>'+
      '<form id="leadManagementForm" class="lead-management-form">'+
        '<h3>Registrar atividade comercial</h3><p>Notas e mudanças de etapa são registradas no histórico, sem disparar mensagens externas.</p>'+
        '<div class="lead-form-grid"><label>Etapa<select name="status">'+options+'</select></label>'+
        '<label>Anotação interna<textarea name="note" rows="3" maxlength="2000" placeholder="Resumo do contato, próximo passo ou motivo da perda..."></textarea></label></div>'+
        '<div class="action-row"><button type="submit" class="cta">Salvar atividade</button>'+
          '<span role="status" data-lead-status>'+esc(feedback)+'</span></div>'+
      '</form><div class="lead-history"><h3>Histórico da oportunidade</h3>'+
        '<div data-lead-events role="status">Carregando histórico...</div></div></section>';
  const panel=container.querySelector('.opportunity-profile');
  panel.querySelector('[data-close-lead]').onclick=()=>{container.replaceChildren();leadFocus=null};
  panel.querySelector('[data-lead-followup]').onclick=()=>{
    followupFocus=null;followupFilter='pending';view('followups');openFollowupEditor('create',null,id);
  };
  const form=panel.querySelector('#leadManagementForm');
  form.onsubmit=async event=>{
    event.preventDefault();
    const target=form.querySelector('[data-lead-status]'),
      status=form.querySelector('[name=status]').value,
      note=form.querySelector('[name=note]').value.trim();
    if(status===lead.status&&!note){target.textContent='Informe uma anotação ou altere a etapa.';return}
    const controls=[...form.querySelectorAll('button,select,textarea')];
    controls.forEach(control=>control.disabled=true);
    target.textContent='Registrando atividade...';
    let result;
    try{result=await sb.rpc('lkz_adm_update_lead',
      {p_id:id,p_expected_status:lead.status,p_status:status,p_note:note});}
    catch{result={error:{code:'REDE'}}}
    if(!form.isConnected||!user)return;
    if(result.error||!result.data?.id){
      target.textContent='Não foi possível salvar: '+(result.error?.code||'SEM_CONFIRMACAO')+'. Recarregue os dados.';
      controls.forEach(control=>control.disabled=false);
      return;
    }
    const current=state.leads.find(l=>l.id===id);
    if(current)Object.assign(current,result.data);
    try{await loadCommercial();}catch{}
    view('leads');
    const feedback=el('leadDetails')?.querySelector('[data-lead-status]');
    if(feedback)feedback.textContent='Atividade registrada e auditada.';
  };
  const history=panel.querySelector('[data-lead-events]');
  let result;
  try{result=await sb.rpc('lkz_adm_lead_history',{p_id:id});}
  catch{result={error:{code:'REDE'}}}
  if(!history.isConnected||!user)return;
  if(result.error){history.textContent='Histórico indisponível. Código: '+(result.error.code||'DESCONHECIDO');return}
  const events=Array.isArray(result.data)?result.data:[];
  history.innerHTML=events.length?events.map(e=>
    '<div class="timeline-event"><div class="timeline-point"></div>'+
    '<div><strong>'+esc(e.event_type||'Atividade')+'</strong>'+
      '<small>'+esc(dateLabel(e.created_at))+' · '+esc(e.actor_type||'sistema')+'</small>'+
      (e.note?'<p>'+esc(e.note)+'</p>':'')+'</div></div>').join(''):
    '<p class="support-note">Nenhum evento registrado nesta oportunidade.</p>';
}
const dateLabel=value=>value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Bahia'}).format(new Date(value)):'—';
function conversations(folder=conversationFolder,selectId=null){
  conversationFolder=folder;
  const threads=state.threads.filter(t=>t.folder===folder);
  const counts=Object.fromEntries(Object.keys(messageFolders).map(key=>[key,state.threads.filter(t=>t.folder===key).length]));
  const list=threads.map(t=>
    '<button type="button" class="thread" data-thread="'+esc(t.id)+'" data-search="'+esc((t.lead+' '+t.channel).toLowerCase())+'">'+
      '<span class="thread-avatar" aria-hidden="true">'+esc(t.lead.charAt(0))+'</span>'+
      '<span class="thread-info"><b>'+esc(t.lead)+'</b><small>'+esc(t.channel)+' · '+esc(dateLabel(t.last))+'</small>'+
      (t.contactState==='suggested'?'<small class="contact-suggestion">Confirme o cadastro sugerido</small>':'')+'</span>'+
    '</button>').join('');
  el('content').innerHTML=
    (folder==='deleted'&&profile?.role==='master'
      ?'<div class="trash-toolbar"><div><strong>Lixeira de atendimentos</strong>'+
        '<span>'+Number(state.trashStats?.conversations||0)+' atendimento(s) excluído(s)</span></div>'+
        '<button class="cta danger-outline" type="button" data-empty-conversations>Esvaziar Lixeira de atendimentos</button></div>'
      :'')+
    '<div class="chat" id="chatWorkspace">'+
      '<div class="threads"><div class="thread-header"><h2>Atendimentos</h2><p>'+threads.length+' nessa pasta</p>'+
        '<div class="conversation-folder-tabs" role="group" aria-label="Pastas de atendimentos">'+
          Object.entries(messageFolders).map(([key,title])=>
            '<button type="button" data-workfolder="'+key+'" aria-pressed="'+(folder===key)+'">'+esc(title)+' <span>'+counts[key]+'</span></button>').join('')+
        '</div>'+
        '<label><span class="sr-only">Buscar atendimento</span><input id="threadFilter" type="search" placeholder="Buscar atendimento..."></label>'+
      '</div><div class="thread-scroller">'+(list||'<div class="empty">Nenhum atendimento nesta pasta.</div>')+'</div></div>'+
      '<div id="messagePane" class="messages"><div class="empty chat-placeholder">'+
        '<strong>Selecione um atendimento</strong><span>Gerencie histórico, mensagens e o atendimento completo.</span></div></div>'+
    '</div>';
  const root=el('chatWorkspace');
  el('content').querySelector('[data-empty-conversations]')?.addEventListener('click',()=>emptyTrash('conversations'));
  root.querySelectorAll('[data-workfolder]').forEach(button=>button.onclick=()=>{
    conversationFocus=null;conversationFlash='';conversations(button.dataset.workfolder);
  });
  root.querySelectorAll('[data-thread]').forEach(button=>button.onclick=()=>openThread(button.dataset.thread));
  const input=el('threadFilter');
  input.oninput=()=>{
    const norm=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    let total=0;
    root.querySelectorAll('[data-thread]').forEach(button=>{
      const matched=norm(button.dataset.search).includes(norm(input.value.trim()));
      button.hidden=!matched;if(matched)total++;
    });
    root.querySelector('.thread-header p').textContent=total+' encontrado(s) nessa pasta';
  };
  if(conversationFlash){
    const notice=document.createElement('p');
    notice.className='operation-feedback';notice.setAttribute('role','status');
    notice.textContent=conversationFlash;conversationFlash='';
    root.parentElement?.insertBefore(notice,root);
  }
  if(selectId&&threads.some(t=>t.id===selectId))openThread(selectId);
}

const messageFolders={active:'Caixa de entrada',archived:'Arquivados',deleted:'Lixeira de atendimentos'};
const messageActions={
  active:{archived:'Arquivar mensagens',deleted:'Excluir mensagens'},
  archived:{active:'Restaurar mensagens',deleted:'Excluir mensagens'},
  deleted:{active:'Restaurar mensagens',purge:'Apagar definitivamente'}
};
async function emptyTrash(kind,selectedConversation=null){
  if(trashBusy||profile?.role!=='master')return;
  trashBusy=true;
  try{
    const {data:stats,error:statsError}=await sb.rpc('lkz_adm_trash_stats');
    if(statsError||!stats)throw new Error('CONTAGEM_INDISPONIVEL');
    const count=Number(kind==='messages'?stats.messages:stats.conversations);
    if(!Number.isInteger(count)||count<=0){
      conversationFlash='A lixeira já está vazia.';
      if(currentView==='conversations')conversations(conversationFolder);
      return;
    }
    const noun=kind==='messages'?'mensagem(ns)':'atendimento(s)';
    if(!await askConfirmation({
      title:'Esvaziar lixeira definitivamente',
      message:'Você está prestes a apagar '+count+' '+noun+' de todas as conversas. A operação é irreversível.',
      keyword:'ESVAZIAR',destructive:true
    }))return;
    let result;
    try{result=await sb.rpc('lkz_adm_empty_trash',
      {p_kind:kind,p_conversation:null,p_expected_count:count})}
    catch{result={error:{code:'REDE'}}}
    if(result.error||Number(result.data?.deleted)!==count){
      throw new Error(result.error?.code||'CONFERIR_RESULTADO');
    }
    await loadCommercial();
    conversationFlash='Lixeira esvaziada: '+count+' '+noun+' apagados definitivamente.';
    if(currentView==='conversations'){
      const folder=conversationFolder;
      conversations(folder);
      if(kind==='messages'&&selectedConversation&&state.threads.some(t=>t.id===selectedConversation)){
        await openThread(selectedConversation,'deleted',null,conversationFlash);
        conversationFlash='';
      }
    }
  }catch(error){
    const notice=el('messagePane')?.querySelector('[data-notice]');
    const message='Falha ao esvaziar a lixeira. Código: '+(error?.message||'INDEFINIDO')+
      '. Recarregue para conferir o estado antes de tentar novamente.';
    if(notice)notice.textContent=message;
    else {conversationFlash=message;if(currentView==='conversations')conversations(conversationFolder)}
  }finally{trashBusy=false}
}

async function conversationAction(id,action){
  const t=state.threads.find(item=>item.id===id);
  if(!t)return;
  if(action==='trash'&&!await askConfirmation({
    title:'Mover atendimento para a lixeira',message:'O atendimento e seu histórico ficarão na Lixeira, podendo ser restaurados.'
  }))return;
  if(action==='purge'){
    if(profile?.role!=='master')return;
    if(!await askConfirmation({
      title:'Excluir atendimento definitivamente',
      message:'Este atendimento e todas as suas mensagens serão apagados permanentemente.',
      keyword:'EXCLUIR',destructive:true
    }))return;
  }
  const actionLabels={archive:'Atendimento arquivado.',trash:'Atendimento movido para a Lixeira.',
    restore:'Atendimento restaurado.',purge:'Atendimento e mensagens excluídos definitivamente.'};
  const oldFolder=t.folder;
  let result;
  try{
    result=await sb.rpc('lkz_adm_conversation_action',
      {p_id:id,p_action:action,p_expected_folder:oldFolder});
  }catch{result={error:{code:'REDE'}}}
  const {data,error}=result;
  if(error||!data){
    const pane=el('messagePane');
    const warning=document.createElement('p');warning.className='operation-feedback error';
    warning.setAttribute('role','alert');
    warning.textContent='Falha ao alterar o atendimento. Código: '+(error?.code||'SEM_CONFIRMACAO')+'. Atualize e tente novamente.';
    pane?.prepend(warning);
    return;
  }
  if(action==='purge')state.threads=state.threads.filter(item=>item.id!==id);
  else t.folder=data.folder;
  conversationFocus=null;conversationFlash=actionLabels[action]||'Operação concluída.';
  conversations(conversationFolder);
}


function openContactSelector(thread){
  if(activeDialogCancel)return;
  const lead=state.leads.find(l=>l.id===thread.lead_id);
  if(!lead||lead.contact_id)return;
  const contacts=[...state.contacts].sort((a,b)=>{
    const aMatch=thread.suggestedContactIds.includes(a.id)?1:0;
    const bMatch=thread.suggestedContactIds.includes(b.id)?1:0;
    return bMatch-aMatch||contactDisplayName(a).localeCompare(contactDisplayName(b),'pt-BR');
  });
  const overlay=document.createElement('div');
  overlay.className='lkz-modal-overlay';
  const dialog=document.createElement('section');
  dialog.className='lkz-modal lkz-contact-picker';
  dialog.setAttribute('role','dialog');
  dialog.setAttribute('aria-modal','true');
  const title=document.createElement('h2');
  title.textContent='Vincular cliente existente';
  title.id='lkz-contact-picker-title';
  dialog.setAttribute('aria-labelledby',title.id);
  const description=document.createElement('p');
  description.textContent='Selecione o cadastro correto. Correspondências de e-mail/telefone são sugestões, não vínculos automáticos.';
  const search=document.createElement('input');
  search.type='search';search.autocomplete='off';
  search.placeholder='Buscar nome, empresa, e-mail ou telefone';
  search.setAttribute('aria-label','Buscar contato cadastrado');
  const list=document.createElement('div');
  list.className='lkz-contact-results';
  list.setAttribute('role','radiogroup');
  list.setAttribute('aria-label','Clientes cadastrados');
  const info=document.createElement('p');info.className='lkz-modal-message';info.setAttribute('role','status');
  const actions=document.createElement('div');actions.className='lkz-modal-actions';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='cta secondary';cancel.textContent='Cancelar';
  const link=document.createElement('button');link.type='button';link.className='cta';link.textContent='Vincular cliente';link.disabled=true;
  actions.append(cancel,link);
  dialog.append(title,description,search,list,info,actions);overlay.append(dialog);
  let chosen=null,closing=false;
  const previous=document.activeElement;
  const close=()=>{
    if(closing)return;
    closing=true;activeDialogCancel=null;
    document.removeEventListener('keydown',onKey,true);
    overlay.remove();
    if(previous?.isConnected)previous.focus();
  };
  const onKey=e=>{
    if(e.key==='Escape'){e.preventDefault();close();return}
    if(e.key==='Tab'){
      const focusables=[search,...list.querySelectorAll('input[type="radio"]'),cancel,link]
        .filter(element=>!element.disabled&&!element.hidden);
      if(!focusables.length)return;
      if(e.shiftKey&&document.activeElement===focusables[0]){
        e.preventDefault();focusables[focusables.length-1].focus();
      }else if(!e.shiftKey&&document.activeElement===focusables[focusables.length-1]){
        e.preventDefault();focusables[0].focus();
      }
    }
  };
  const normalize=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function renderMatches(){
    chosen=null;link.disabled=true;
    list.replaceChildren();
    const term=normalize(search.value.trim());
    const matches=contacts.filter(c=>
      normalize([c.company_name,c.person_name,c.email,c.phone,c.city].join(' ')).includes(term)
    );
    for(const contact of matches.slice(0,35)){
      const label=document.createElement('label');
      label.className='lkz-contact-result';
      const radio=document.createElement('input');
      radio.type='radio';radio.name='lkz-contact-choice';radio.value=contact.id;
      const detail=document.createElement('span');
      const name=document.createElement('strong');name.textContent=contactDisplayName(contact);
      const secondary=document.createElement('small');
      secondary.textContent=[contact.email,contact.phone].filter(Boolean).join(' · ')||'Sem e-mail ou telefone';
      detail.append(name,secondary);
      if(thread.suggestedContactIds.includes(contact.id)){
        const suggested=document.createElement('em');
        suggested.textContent='Correspondência encontrada · confirme a identidade';
        detail.append(suggested);
      }
      label.append(radio,detail);list.append(label);
      radio.onchange=()=>{chosen=contact.id;link.disabled=false;info.textContent='Cadastro selecionado: '+contactDisplayName(contact)};
    }
    if(!matches.length){
      const empty=document.createElement('p');
      empty.textContent='Nenhum cadastro correspondente. Use “Novo cliente” no atendimento.';
      list.append(empty);
    }
    if(matches.length>35){
      const more=document.createElement('p');more.textContent='Refine a busca para visualizar outros resultados.';
      list.append(more);
    }
  }
  search.oninput=renderMatches;
  cancel.onclick=close;
  overlay.onclick=e=>{if(e.target===overlay)close()};
  activeDialogCancel=close;
  document.body.append(overlay);
  document.addEventListener('keydown',onKey,true);
  renderMatches();search.focus();
  link.onclick=async()=>{
    if(!chosen)return;
    link.disabled=true;cancel.disabled=true;search.disabled=true;
    info.textContent='Validando e vinculando cadastro...';
    let response;
    try{response=await sb.rpc('lkz_adm_link_existing_contact',{
      p_conversation:thread.id,p_expected_lead:lead.id,p_contact:chosen
    })}catch{response={error:{code:'REDE'}}}
    if(!overlay.isConnected||!user)return;
    if(response.error||!response.data?.id){
      info.textContent='Não foi possível vincular o cadastro. Código: '+(response.error?.code||'SEM_CONFIRMACAO')+
        '. Atualize e confira se ele já não foi vinculado.';
      link.disabled=false;cancel.disabled=false;search.disabled=false;return;
    }
    close();
    try{await loadCommercial();}catch{
      lead.contact_id=response.data.id;
      state.contacts=[response.data,...state.contacts.filter(c=>c.id!==response.data.id)];
    }
    if(currentView==='conversations'){
      conversationFlash='Cadastro existente vinculado ao atendimento com sucesso.';
      conversations(conversationFolder,thread.id);
    }
  };
}

async function openThread(id,folder='active',before=null,feedback=''){
  const thread=state.threads.find(item=>item.id===id);
  const pane=el('messagePane');
  if(!thread||!pane)return;
  conversationFocus=id;
  el('chatWorkspace')?.classList.add('is-detail');
  el('content').querySelectorAll('[data-thread]').forEach(button=>{
    button.classList.toggle('active',button.dataset.thread===id);
    button.setAttribute('aria-pressed',String(button.dataset.thread===id));
  });
  const page=document.createElement('section');
  page.setAttribute('aria-busy','true');
  page.innerHTML='<p role="status" class="message-loading">Carregando mensagens...</p>';
  pane.replaceChildren(page);
  const {data,error}=await sb.rpc('lkz_adm_list_messages',
    {p_conversation:id,p_folder:folder,p_before:before});
  if(!page.isConnected||!user)return;
  page.removeAttribute('aria-busy');
  if(error){
    page.innerHTML='<div class="message-error" role="alert"><h2>Não foi possível carregar</h2>'+
      '<p>Falha na consulta ao banco (código '+esc(error.code||'desconhecido')+').</p>'+
      '<button type="button" class="cta" data-retry>Tentar novamente</button></div>';
    page.querySelector('[data-retry]').onclick=()=>openThread(id,folder,before);
    return;
  }
  const messages=data||[];
  const next=messages.length>50?messages[49].id:null;
  const visible=messages.slice(0,50).reverse();
  const leadForContact=state.leads.find(l=>l.id===thread.lead_id);
  const contactControl=leadForContact?.contact_id
    ?'<button type="button" class="cta secondary" data-message-contact="open">Abrir cliente</button>'
    :(thread.lead_id?'<button type="button" class="cta secondary" data-message-contact="link">Vincular existente</button>':'')+
      '<button type="button" class="cta secondary" data-message-contact="new">Novo cliente</button>';
  const linkedLead=state.leads.find(l=>l.id===thread.lead_id);
  const canSchedule=linkedLead&&!['won','lost','archived'].includes(linkedLead.status);
  const crmControls=linkedLead?
    '<button type="button" class="cta secondary" data-message-lead>Abrir oportunidade</button>'+
    (canSchedule&&thread.folder!=='deleted'?
      '<button type="button" class="cta secondary" data-message-schedule>Agendar retorno</button>':''):'';
  const controls=thread.folder==='deleted'
    ?'<button type="button" class="cta" data-conversation-action="restore">Restaurar atendimento</button>'+
      (profile?.role==='master'?'<button type="button" class="cta danger" data-conversation-action="purge">Excluir definitivamente</button>':'')
    :'<button type="button" class="cta" data-conversation-action="'+(thread.folder==='active'?'archive':'restore')+'">'+
      (thread.folder==='active'?'Arquivar':'Restaurar')+'</button>'+
     '<button type="button" class="cta danger-outline" data-conversation-action="trash">Excluir atendimento completo</button>';
  const items=visible.map(item=>{
    const outbound=item.role!=='user';
    const bubble='<span class="message-copy"><span class="message-text">'+esc(item.content)+'</span>'+
      '<small>'+esc(dateLabel(item.created_at))+'</small></span>';
    return '<div class="message-item'+(outbound?' out':'')+'">'+
      '<label class="bubble selectable"><input type="checkbox" data-message-select value="'+esc(item.id)+'" aria-label="Selecionar mensagem">'+bubble+'</label>'+
      '<div class="message-item-actions">'+
        (folder==='deleted'
          ?'<button type="button" data-single="'+esc(item.id)+'" data-target="active">Restaurar</button>'+
           '<button type="button" class="text-danger" data-single="'+esc(item.id)+'" data-target="purge">Apagar definitivamente</button>'
          :'<button type="button" class="text-danger" data-single="'+esc(item.id)+'" data-target="deleted">Excluir mensagem</button>')+
      '</div></div>';
  }).join('');
  page.innerHTML=
    '<div class="message-heading">'+
      '<button class="message-back" type="button">‹ Voltar aos atendimentos</button>'+
      '<div class="message-heading-main"><div><span class="message-eyebrow">ATENDIMENTO · '+esc(thread.channel)+'</span>'+
        '<h2>'+esc(thread.lead)+'</h2><small>'+(leadForContact?.contact_id?'Cliente vinculado':
        thread.contactState==='suggested'?'Possível cliente encontrado · confirme a identidade':
        'Cliente ainda não vinculado')+'</small></div>'+
        '<div class="conversation-actions">'+contactControl+crmControls+controls+'</div></div>'+
    '</div>'+
    '<nav class="message-tools" aria-label="Pastas das mensagens">'+Object.entries(messageFolders).map(([key,title])=>
      '<button class="cta" type="button" data-folder="'+key+'" aria-pressed="'+(folder===key)+'">'+
       esc(key==='deleted'?'Lixeira de mensagens':title)+'</button>').join('')+'</nav>'+
    '<div class="message-actions">'+
      '<label class="select-all"><input type="checkbox" data-select-all> Selecionar mensagens da página</label>'+
      '<p data-selection role="status">Para excluir definitivamente uma mensagem, abra a Lixeira de mensagens.</p>'+
      '<div class="message-tools">'+Object.entries(messageActions[folder]).map(([key,title])=>
        '<button class="cta'+(key==='purge'?' danger':'')+'" type="button" data-move="'+key+'" disabled>'+title+'</button>').join('')+'</div>'+
    '</div>'+
    (folder==='deleted'&&profile?.role==='master'
      ?'<div class="trash-message-bar"><span>Lixeira global: '+Number(state.trashStats?.messages||0)+
       ' mensagem(ns) aguardando exclusão definitiva.</span>'+
       '<button class="cta danger-outline" type="button" data-empty-messages>'+
       'Esvaziar todas as lixeiras de mensagens</button></div>':'')+
    '<p class="message-status" data-notice role="status">'+esc(feedback)+'</p>'+
    '<div class="message-stream">'+(items||'<p class="empty">Nenhuma mensagem nesta pasta.</p>')+'</div>'+
    '<div class="message-pagination">'+
      (next?'<button type="button" class="cta" data-older>Mensagens anteriores</button>':'')+
      (before?'<button type="button" class="cta" data-recent>Voltar às recentes</button>':'')+
    '</div>';
  page.querySelector('.message-back').onclick=()=>el('chatWorkspace')?.classList.remove('is-detail');
  page.querySelector('[data-empty-messages]')?.addEventListener('click',()=>emptyTrash('messages',id));
  page.querySelector('[data-message-lead]')?.addEventListener('click',()=>openOpportunity(thread.lead_id));
  page.querySelector('[data-message-schedule]')?.addEventListener('click',()=>{
    followupFocus=null;
    followupFilter='pending';
    view('followups');
    openFollowupEditor('create',null,thread.lead_id);
  });
  page.querySelectorAll('[data-conversation-action]').forEach(button=>button.onclick=()=>conversationAction(id,button.dataset.conversationAction));
  page.querySelectorAll('[data-message-contact]').forEach(contactButton=>contactButton.addEventListener('click',async()=>{
    if(contactButton.dataset.messageContact==='link'){openContactSelector(thread);return;}
    let lead=state.leads.find(l=>l.id===thread.lead_id);
    if(!lead&&thread.lead_id){
      const {data,error}=await sb.from('leads').select('*').eq('id',thread.lead_id).maybeSingle();
      if(error||!data){
        const notice=page.querySelector('[data-notice]');
        if(notice)notice.textContent='Não foi possível localizar a oportunidade vinculada.';
        return;
      }
      lead=data;
      state.leads=[data,...state.leads.filter(l=>l.id!==data.id)];
    }
    const linkedId=lead?.contact_id;
    if(linkedId){
      let contact=state.contacts.find(c=>c.id===linkedId);
      if(!contact){
        const {data,error}=await sb.from('contacts').select('*').eq('id',linkedId).maybeSingle();
        if(error||!data){
          const notice=page.querySelector('[data-notice]');
          if(notice)notice.textContent='Não foi possível abrir o contato vinculado.';
          return;
        }
        contact=data;
        state.contacts=[data,...state.contacts.filter(c=>c.id!==data.id)];
      }
      clientFocus=contact.id;clientMode='detail';clientDraft=null;
    }else{
      const details=lead?.structured_data&&typeof lead.structured_data==='object'?lead.structured_data:{};
      clientDraft={
        conversation_id:id,lead_id:lead?.id||null,
        segment:lead?.category||details.segment||'',
        email:typeof details.contact_email==='string'?details.contact_email:'',
        phone:typeof details.contact_phone==='string'?details.contact_phone:''
      };
      clientMode='new';
    }
    view('clients');
  }));
  page.querySelectorAll('[data-folder]').forEach(button=>button.onclick=()=>openThread(id,button.dataset.folder));
  page.querySelector('[data-older]')?.addEventListener('click',()=>openThread(id,folder,next));
  page.querySelector('[data-recent]')?.addEventListener('click',()=>openThread(id,folder));
  const checked=()=>[...page.querySelectorAll('[data-message-select]:checked')].map(input=>input.value);
  const bulk=[...page.querySelectorAll('[data-move]')];
  const selectAll=page.querySelector('[data-select-all]');
  function updateButtons(){
    const count=checked().length;
    const status=page.querySelector('[data-selection]');
    status.textContent=count?count+' mensagem(ns) selecionada(s).':'Selecione mensagens da página.';
    bulk.forEach(button=>button.disabled=count===0);
    selectAll.checked=count>0&&count===visible.length;
    selectAll.indeterminate=count>0&&count<visible.length;
  }
  selectAll.onchange=()=>{
    page.querySelectorAll('[data-message-select]').forEach(input=>input.checked=selectAll.checked);
    updateButtons();
  };
  page.querySelectorAll('[data-message-select]').forEach(input=>input.onchange=updateButtons);
  async function move(destination,ids){
    if(!ids.length||ids.length>50)return;
    const numericIds=ids.map(Number);
    if(numericIds.some(value=>!Number.isSafeInteger(value)||value<=0)){
      const status=page.querySelector('[data-notice]');
      if(status)status.textContent='Identificador inválido. Atualize a conversa antes de excluir.';
      return;
    }
    if(destination==='purge'){
      if(!await askConfirmation({
        title:'Excluir mensagens definitivamente',
        message:ids.length+' mensagem(ns) serão apagadas permanentemente.',
        keyword:'EXCLUIR',destructive:true
      }))return;
    }
    const status=page.querySelector('[data-notice]');
    page.querySelectorAll('button,input').forEach(control=>control.disabled=true);
    status.textContent='Processando '+ids.length+' mensagem(ns)...';
    let result;
    try{
      result=destination==='purge'
        ?await sb.rpc('lkz_adm_purge_messages',{p_conversation:id,p_ids:numericIds})
        :await sb.rpc('lkz_adm_move_messages',{p_conversation:id,p_ids:numericIds,p_from:folder,p_to:destination});
    }catch{result={error:{code:'REDE'}}}
    if(!page.isConnected||!user)return;
    if(result.error||Number(result.data)!==ids.length){
      page.querySelectorAll('button,input').forEach(control=>control.disabled=false);
      updateButtons();
      status.textContent='Não foi possível confirmar a operação. Código: '+
        (result.error?.code||'RESPOSTA_INVALIDA')+'. Nenhuma exclusão foi confirmada.';
      return;
    }
    const done=destination==='purge'?'Mensagens definitivamente excluídas.':
       destination==='deleted'?'Mensagens movidas à Lixeira.':'Mensagens movidas com sucesso.';
    await openThread(id,folder,before,done);
  }
  bulk.forEach(button=>button.onclick=()=>move(button.dataset.move,checked()));
  page.querySelectorAll('[data-single]').forEach(button=>button.onclick=()=>move(button.dataset.target,[button.dataset.single]));
}

const dateTimeInput=value=>{
  if(!value)return '';
  const d=new Date(value);
  const pad=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+
    'T'+pad(d.getHours())+':'+pad(d.getMinutes());
};
function followups(feedback=''){
  const all=state.followups;
  const pending=all.filter(f=>f.status==='pending').length;
  const overdue=all.filter(f=>f.status==='pending'&&f.due_at&&Date.parse(f.due_at)<Date.now()).length;
  const filtered=all.filter(f=>followupFilter==='all'||(followupFilter==='pending'?f.status==='pending':f.status===followupFilter));
  const cards=filtered.map(f=>{
    const isOverdue=f.status==='pending'&&f.due_at&&Date.parse(f.due_at)<Date.now();
    return '<article class="return-card'+(isOverdue?' is-overdue':'')+'">'+
      '<div class="return-icon" aria-hidden="true">'+(isOverdue?'!':'✓')+'</div>'+
      '<div class="return-content"><strong>'+esc(f.lead)+'</strong>'+
      '<div class="return-meta"><span>'+esc(dateLabel(f.due_at))+'</span><span>'+esc(f.channel||'Canal não definido')+'</span></div>'+
      (f.draft_message?'<p>'+esc(f.draft_message)+'</p>':'')+'</div>'+
      '<div class="return-side">'+tag(f.status)+
        '<button type="button" class="cta secondary" data-return="'+esc(f.id)+'">Abrir</button></div></article>';
  }).join('');
  el('content').innerHTML=
    '<section class="crm-topbar"><div><span class="eyebrow">CRM · ATIVIDADES</span>'+
      '<h2>Agenda de retornos</h2><p>Controle seus contatos sem depender de outra plataforma.</p></div>'+
      '<button type="button" class="cta" data-return-create>+ Agendar retorno</button></section>'+
    dataScopeNotice()+'<div class="grid crm-mini-stats">'+
      k('Pendentes',pending,'Aguardando atendimento · carregados')+
      k('Atrasados',overdue,'Necessitam priorização')+
      k('Total registrado',state.loadMeta?.counts.followups??all.length,'Total no banco')+'</div>'+
    '<div class="return-filters" role="group" aria-label="Filtrar retornos">'+
      [['pending','Pendentes'],['done','Concluídos'],['cancelled','Cancelados'],['all','Todos']].map(([v,title])=>
        '<button type="button" data-return-filter="'+v+'" aria-pressed="'+(v===followupFilter)+'">'+title+'</button>').join('')+'</div>'+
    '<p data-return-feedback class="operation-feedback" role="status">'+esc(feedback)+'</p>'+
    '<div class="return-layout"><section class="panel return-list">'+
      (cards||'<div class="empty-state"><strong>Nenhum retorno nesta visualização.</strong><p>Use “Agendar retorno” para criar uma atividade vinculada à oportunidade.</p></div>')+
      '</section><div id="followupEditor"><section class="panel return-placeholder">'+
      '<h2>Escolha uma atividade</h2><p>Abra um retorno para reagendar, concluir ou cancelar. Nenhuma mensagem é enviada automaticamente.</p>'+
      '</section></div></div>';
  el('content').querySelector('[data-return-create]').onclick=()=>openFollowupEditor('create');
  el('content').querySelectorAll('[data-return-filter]').forEach(b=>b.onclick=()=>{
    followupFilter=b.dataset.returnFilter;followupFocus=null;followups();
  });
  el('content').querySelectorAll('[data-return]').forEach(b=>b.onclick=()=>openFollowupEditor('detail',b.dataset.return));
  if(followupFocus&&all.some(f=>f.id===followupFocus))openFollowupEditor('detail',followupFocus);
}
function openFollowupEditor(mode,id=null,leadId=null){
  const target=el('followupEditor');
  if(!target)return;
  const followup=state.followups.find(f=>f.id===id);
  if(mode!=='create'&&!followup)return;
  followupFocus=mode==='create'?null:id;
  const lead=followup?state.leads.find(l=>l.id===followup.lead_id):
    state.leads.find(l=>l.id===leadId);
  if(mode==='detail'){
    const editable=followup.status==='pending';
    target.innerHTML='<section class="panel return-detail"><span class="eyebrow">DETALHES DO RETORNO</span>'+
      '<h2>'+esc(followup.lead)+'</h2><p>'+tag(followup.status)+'</p>'+
      '<dl class="return-facts"><dt>Quando</dt><dd>'+esc(dateLabel(followup.due_at))+'</dd>'+
      '<dt>Canal</dt><dd>'+esc(followup.channel||'Não informado')+'</dd>'+
      '<dt>Mensagem / orientação</dt><dd>'+esc(followup.draft_message||'Sem texto definido')+'</dd></dl>'+
      '<p class="support-note">Concluir um retorno registra a atividade como feita; não envia mensagens.</p>'+
      '<div class="return-actions">'+
        (editable?'<button type="button" class="cta" data-return-action="edit">Reagendar</button>'+
          '<button type="button" class="cta secondary" data-return-action="complete">Concluir</button>'+
          '<button type="button" class="cta danger-outline" data-return-action="cancel">Cancelar</button>':'')+
        '<button type="button" class="cta secondary" data-return-action="lead">Abrir oportunidade</button></div>'+
      '<p role="status" data-return-status></p></section>';
    target.querySelectorAll('[data-return-action]').forEach(b=>b.onclick=async()=>{
      const action=b.dataset.returnAction;
      if(action==='edit'){openFollowupEditor('edit',id);return}
      if(action==='lead'){openOpportunity(followup.lead_id);return}
      if(!['complete','cancel'].includes(action))return;
      if(!await askConfirmation({
        title:action==='complete'?'Concluir retorno':'Cancelar retorno',
        message:action==='complete'?'Registrar o retorno como realizado? Nenhuma mensagem será enviada.':
          'Cancelar este retorno e registrar a alteração?'
      }))return;
      const msg=target.querySelector('[data-return-status]');
      target.querySelectorAll('button').forEach(x=>x.disabled=true);
      msg.textContent='Registrando...';
      let result;
      try{result=await sb.rpc('lkz_adm_manage_followup',{
        p_id:id,p_lead_id:followup.lead_id,p_action:action,
        p_due_at:null,p_channel:null,p_message:null
      })}catch{result={error:{code:'REDE'}}}
      if(!target.isConnected||!user)return;
      if(result.error||!result.data?.id){
        msg.textContent='Falha ao atualizar: '+(result.error?.code||'SEM_CONFIRMACAO');
        target.querySelectorAll('button').forEach(x=>x.disabled=false);return;
      }
      await reloadFollowups(action==='complete'?'Retorno concluído.':'Retorno cancelado.');
    });
    return;
  }
  const isNew=mode==='create';
  const selectedLead=isNew?(lead?.id||''):(followup?.lead_id||'');
  const choices=state.leads.filter(l=>!['archived','lost','won'].includes(l.status)||
      l.id===selectedLead).map(l=>
    '<option value="'+esc(l.id)+'"'+(selectedLead===l.id?' selected':'')+'>'+esc(l.name)+'</option>').join('');
  target.innerHTML='<section class="panel return-detail"><span class="eyebrow">'+(isNew?'NOVA ATIVIDADE':'REAGENDAR')+'</span>'+
    '<h2>'+(isNew?'Agendar retorno':esc(followup.lead))+'</h2>'+
    '<form id="returnForm" class="entry-form">'+
      '<label>Oportunidade<select name="lead_id" '+(isNew?'required':'disabled')+'>'+
        '<option value="">Selecione a oportunidade</option>'+choices+'</select></label>'+
      '<label>Data e hora<input type="datetime-local" name="due" required value="'+
        esc(isNew?'':dateTimeInput(followup.due_at))+'"></label>'+
      '<label>Canal<select name="channel" required>'+
        [['whatsapp','WhatsApp'],['email','E-mail'],['phone','Telefone'],['other','Outro']].map(([v,title])=>
        '<option value="'+v+'"'+(!isNew&&followup.channel===v?' selected':'')+'>'+title+'</option>').join('')+'</select></label>'+
      '<label>Orientação / mensagem de referência<textarea name="message" maxlength="1500" rows="4" placeholder="Anotação interna para a atividade. Não será enviada automaticamente.">'+
        esc(isNew?'':followup.draft_message||'')+'</textarea></label>'+
      '<div class="action-row"><button class="cta" type="submit">'+(isNew?'Criar retorno':'Salvar agendamento')+'</button>'+
      '<button type="button" class="cta secondary" data-return-cancel>Cancelar</button></div>'+
      '<p role="status" data-return-status></p></form></section>';
  const form=target.querySelector('#returnForm');
  target.querySelector('[data-return-cancel]').onclick=()=>{
    if(!isNew)openFollowupEditor('detail',id);
    else {followupFocus=null;followups()}
  };
  let requestId=crypto.randomUUID();
  form.oninput=()=>{if(isNew)requestId=crypto.randomUUID()};
  form.onsubmit=async e=>{
    e.preventDefault();
    const data=new FormData(form);
    const leadIdToUse=String(data.get('lead_id')||selectedLead);
    const dateStr=String(data.get('due')||'');
    const due=new Date(dateStr);
    const status=form.querySelector('[data-return-status]');
    if(!leadIdToUse||!dateStr||Number.isNaN(due.getTime())){
      status.textContent='Selecione oportunidade e data válida.';return;
    }
    if(due.getTime()<Date.now()-86400000){
      status.textContent='Informe uma data atual ou futura.';return;
    }
    const controls=[...form.querySelectorAll('button,input,select,textarea')];
    controls.forEach(x=>x.disabled=true);
    status.textContent='Salvando agendamento...';
    let result;
    try{result=await sb.rpc('lkz_adm_manage_followup',{
      p_id:isNew?requestId:id,p_lead_id:leadIdToUse,
      p_action:isNew?'create':'reschedule',p_due_at:due.toISOString(),
      p_channel:String(data.get('channel')||'other'),
      p_message:String(data.get('message')||'')
    })}catch{result={error:{code:'REDE'}}}
    if(!form.isConnected||!user)return;
    if(result.error||!result.data?.id){
      status.textContent='Não foi possível salvar: '+(result.error?.code||'SEM_CONFIRMACAO')+
        '. Confira os dados e atualize se necessário.';
      controls.forEach(x=>x.disabled=false);return;
    }
    followupFocus=result.data.id;followupFilter='all';
    await reloadFollowups(isNew?'Retorno agendado.':'Retorno reagendado.');
  };
}
async function reloadFollowups(feedback=''){
  try{await loadCommercial();followups(feedback)}
  catch{followups('Operação processada, mas não foi possível atualizar a lista. Reabra a agenda para conferir.')}
}
function approvals(feedback=''){
  const body=state.approvals.map(a=>{
    const action={contact:'Contato',proposal:'Proposta'}[a.action_type]||a.action_type;
    const actions=a.status==='pending'&&a.lead_id&&['contact','proposal'].includes(a.action_type)
      ?'<div class="action-row"><button class="cta" data-decision="approved">Aprovar</button><button class="cta" data-decision="rejected">Rejeitar</button></div>':'—';
    return '<tr data-approval="'+esc(a.id)+'"><td><b>'+esc(a.lead)+'</b></td><td>'+esc(action)+'</td><td>'+tag(a.status)+'</td><td>'+actions+'</td></tr>';
  }).join('');
  const review=state.leads.filter(lead=>!['lost','archived','won'].includes(lead.status)&&
    (lead.needs_human_review||lead.status==='human_review'));
  const reviewHtml=review.length?'<section class="panel form-panel"><h2>Casos para revisão</h2><p>Leads sinalizados para análise humana.</p>'+
    review.slice(0,15).map(lead=>'<div class="row"><b>'+esc(lead.name)+'</b><button class="cta" type="button" data-review-lead="'+esc(lead.id)+'">Ver oportunidade</button></div>').join('')+'</section>':'';
  el('content').innerHTML=reviewHtml+'<p id="approvalFeedback" role="status">'+esc(feedback)+'</p>'+
    (body?'<div class="table"><table><thead><tr><th>Lead</th><th>Tipo</th><th>Status</th><th>Ação</th></tr></thead><tbody>'+body+'</tbody></table></div>':'<p>Nenhuma aprovação encontrada.</p>');
  el('content').querySelectorAll('[data-review-lead]').forEach(button=>button.onclick=()=>{view('leads');const lead=el('content').querySelector('[data-lead="'+button.dataset.reviewLead+'"]');lead?.click()});
  el('content').querySelectorAll('[data-decision]').forEach(button=>button.onclick=async()=>{
    const row=button.closest('[data-approval]'),status=button.dataset.decision;
    if(!await askConfirmation({
      title:status==='approved'?'Aprovar solicitação':'Rejeitar solicitação',
      message:'Confirme esta decisão administrativa. A ação será registrada.',
      destructive:status!=='approved'
    }))return;
    row.querySelectorAll('button').forEach(control=>control.disabled=true);
    const {error}=await sb.rpc('lkz_adm_decide_approval',{p_id:row.dataset.approval,p_status:status});
    if(!row.isConnected||!user)return;
    if(error){
      msg(el('approvalFeedback'),'Não foi possível confirmar a decisão. Atualize a lista e tente novamente.');
      row.querySelectorAll('button').forEach(control=>control.disabled=false);
      return;
    }
    state.approvals.find(item=>item.id===row.dataset.approval).status=status;
    approvals('Decisão registrada.');
    try{await loadCommercial();if(el('approvalFeedback'))approvals('Decisão registrada.')}catch{}
  });
}
function systems(){el('content').innerHTML='<div class="layout">'+systemCatalog.map(system=>
  '<section class="panel"><h2>'+system.code+' · '+system.name+'</h2><p>'+system.description+'</p>'+
  '<a class="cta" href="'+system.url+'">Abrir '+system.code+'</a></section>'
).join('')+'</div><p class="notice">O acesso usa o login de cada sistema. O provisionamento de um banco por empresa ainda está em implantação.</p>'}
function clients(feedback=''){
  const contacts=state.contacts;
  const clientLeads=c=>state.leads.filter(l=>l.contact_id===c.id);
  const withLeads=new Set(state.leads.map(l=>l.contact_id).filter(Boolean)).size;
  const unidentified=contacts.filter(c=>!c.company_name&&!c.person_name).length;
  const nameOf=c=>c.company_name||c.person_name||'Contato sem identificação';
  const clientRows=contacts.map(c=>{
    const leads=clientLeads(c);
    const active=leads.filter(l=>!['won','lost','archived'].includes(l.status)).length;
    return '<tr data-client-row="'+esc(c.id)+'" data-search="'+esc([c.company_name,c.person_name,c.segment,c.email,c.phone,c.city,c.state]
         .filter(Boolean).join(' ').toLowerCase())+'">'+
      '<td><div class="client-name-cell"><strong>'+esc(nameOf(c))+'</strong><small>'+esc(c.person_name&&c.company_name?c.person_name:c.segment||'Sem segmento')+'</small></div></td>'+
      '<td>'+esc([c.city,c.state].filter(Boolean).join(' / ')||'—')+'</td>'+
      '<td>'+esc(c.email||'—')+'<br>'+esc(c.phone||'—')+'</td>'+
      '<td><strong>'+leads.length+'</strong> registro(s) · '+active+' em andamento</td>'+
      '<td>'+esc(dateLabel(c.updated_at))+'</td>'+
      '<td><button type="button" class="cta secondary" data-open-client="'+esc(c.id)+'">'+
        (!c.company_name&&!c.person_name?'Completar':'Ver detalhes')+'</button></td>'+
    '</tr>';
  }).join('');
  const selected=contacts.find(c=>c.id===clientFocus)||contacts[0]||null;
  if(selected)clientFocus=selected.id;
  const selectedLeads=selected?clientLeads(selected):[];
  const history=selectedLeads.slice(0,8).map(l=>
    '<div class="client-event"><div><b>'+esc(l.suggested_solution||l.intent||'Oportunidade')+'</b>'+
      '<small>'+esc(dateLabel(l.updated_at))+' · '+esc(l.source||'Origem não informada')+'</small></div>'+
      '<div>'+tag(l.status)+' <button type="button" class="cta secondary" data-client-lead="'+esc(l.id)+'">Abrir</button></div></div>'
  ).join('');
  let detail='';
  const editMode=clientMode==='edit'&&selected;
  const newMode=clientMode==='new';
  if(newMode||editMode){
    const c=editMode?selected:(newMode?clientDraft||{}:{});
    const field=(title,key,type='text',max=120,required='')=>
      '<label>'+title+'<input name="'+key+'" type="'+type+'" maxlength="'+max+'" '+required+
      ' value="'+esc(c[key]||'')+'"></label>';
    detail='<section class="panel client-profile"><div class="client-panel-head">'+
      '<div><small class="client-eyebrow">'+(newMode?'NOVO CADASTRO':'EDITAR CLIENTE')+'</small>'+
      '<h2>'+(newMode?'Cadastrar cliente':esc(nameOf(c)))+'</h2>'+
      '<p>'+(newMode&&clientDraft?.lead_id?'Confirme os dados antes de vincular este contato ao atendimento.':'Informações comerciais verificáveis, sem campos inventados.')+'</p></div>'+
      '<button type="button" class="cta secondary" data-client-cancel>Cancelar</button></div>'+
      '<form id="professionalClientForm" class="entry-form client-form">'+
      field('Empresa','company_name')+field('Contato responsável','person_name')+
      field('Segmento','segment', 'text',100)+
      field('E-mail','email','email',254)+field('Telefone','phone','tel',32)+
      field('Cidade','city','text',100)+field('UF','state','text',2)+
      '<div class="action-row"><button type="submit" class="cta">'+(newMode?'Cadastrar cliente':'Salvar alterações')+'</button>'+
      '<span data-form-status role="status">Informe ao menos empresa ou contato responsável.</span></div>'+
      '</form></section>';
  }else if(selected){
    const location=[selected.city,selected.state].filter(Boolean).join(' / ')||'Não informada';
    const name=nameOf(selected);
    const linked=new Set(selectedLeads.map(l=>l.id));
    const countThreads=state.threads.filter(t=>linked.has(t.lead_id)).length;
    detail='<section class="panel client-profile"><div class="client-panel-head"><div>'+
      '<small class="client-eyebrow">FICHA DO CLIENTE</small><h2>'+esc(name)+'</h2>'+
      '<p>'+esc(selected.segment||'Segmento não informado')+'</p></div>'+
      '<button type="button" class="cta" data-client-edit>Editar cadastro</button></div>'+
      '<div class="client-facts">'+
        '<div><span>Pessoa de contato</span><strong>'+esc(selected.person_name||'Não informada')+'</strong></div>'+
        '<div><span>E-mail</span><strong>'+esc(selected.email||'Não informado')+'</strong></div>'+
        '<div><span>Telefone</span><strong>'+esc(selected.phone||'Não informado')+'</strong></div>'+
        '<div><span>Localização</span><strong>'+esc(location)+'</strong></div>'+
        '<div><span>Criado em</span><strong>'+esc(dateLabel(selected.created_at))+'</strong></div>'+
        '<div><span>Atualizado em</span><strong>'+esc(dateLabel(selected.updated_at))+'</strong></div>'+
      '</div>'+
      '<div class="client-stats">'+
        '<div><span>Oportunidades</span><strong>'+selectedLeads.length+'</strong></div>'+
        '<div><span>Atendimentos vinculados</span><strong>'+countThreads+'</strong></div>'+
        '<div><span>Consentimento de contato</span><strong>'+(selected.consent_contact?'Registrado':'Não registrado')+'</strong></div>'+
      '</div><div class="client-history"><h3>Histórico comercial</h3>'+
      (history||'<p>Nenhuma oportunidade vinculada a este cadastro.</p>')+
      '</div></section>';
  }else detail='<section class="panel client-profile"><p>Nenhum cliente cadastrado.</p></section>';
  el('content').innerHTML=
    dataScopeNotice()+'<div class="grid client-kpis">'+
      k('Contatos',state.loadMeta?.counts.contacts??contacts.length,'Cadastros totais')+
      k('Com oportunidades',withLeads,'Relacionados ao pipeline')+
      k('Para identificar',unidentified,'Cadastros incompletos')+'</div>'+
    '<div class="client-toolbar"><div><h2>Carteira de clientes</h2>'+
      '<p>Consulte, atualize cadastros e acompanhe oportunidades reais.</p></div>'+
      '<div class="client-toolbar-actions"><input id="clientSearch" type="search" placeholder="Buscar cliente, cidade, segmento...">'+
        '<button type="button" class="cta" data-new-client>Novo cliente</button></div></div>'+
    '<p class="operation-feedback" data-client-feedback role="status">'+esc(feedback)+'</p>'+
    '<div class="table client-table"><table><thead><tr>'+
      '<th>Empresa / contato</th><th>Local</th><th>Contato</th>'+
      '<th>Oportunidades</th><th>Atualização</th><th>Ação</th></tr></thead>'+
      '<tbody>'+clientRows+'</tbody></table></div>'+
    '<div class="client-detail" id="clientDetail">'+detail+'</div>';
  el('content').querySelectorAll('[data-open-client]').forEach(b=>b.onclick=()=>{
    clientFocus=b.dataset.openClient;clientMode='detail';clients();
    el('clientDetail')?.scrollIntoView({block:'nearest',behavior:'smooth'});
  });
  el('content').querySelector('[data-new-client]').onclick=()=>{
    clientDraft=null;clientMode='new';clients();el('clientDetail')?.scrollIntoView({block:'nearest',behavior:'smooth'});
  };
  el('content').querySelector('[data-client-edit]')?.addEventListener('click',()=>{
    clientMode='edit';clients();el('clientDetail')?.scrollIntoView({block:'nearest',behavior:'smooth'});
  });
  el('content').querySelector('[data-client-cancel]')?.addEventListener('click',()=>{clientDraft=null;clientMode='detail';clients()});
  el('content').querySelectorAll('[data-client-lead]').forEach(b=>b.onclick=()=>{
    el('search').value='';
    view('leads');
    el('content').querySelector('[data-lead="'+b.dataset.clientLead+'"]')?.click();
  });
  const search=el('clientSearch');
  search.oninput=()=>{
    const norm=v=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    el('content').querySelectorAll('[data-client-row]').forEach(row=>{
      row.hidden=!norm(row.dataset.search).includes(norm(search.value.trim()));
    });
  };
  const form=el('professionalClientForm');
  if(!form)return;
  let requestId=crypto.randomUUID();
  form.oninput=()=>{if(newMode)requestId=crypto.randomUUID()};
  form.onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(form),status=form.querySelector('[data-form-status]');
    const val=key=>String(f.get(key)||'').trim();
    if(!val('company_name')&&!val('person_name')){
      status.textContent='Informe a empresa ou pessoa de contato.';return;
    }
    if(newMode){
      const enteredEmail=val('email').toLowerCase();
      const enteredPhone=normalizedPhone(val('phone'));
      const duplicates=state.contacts.filter(c=>
        (enteredEmail&&c.email?.trim().toLowerCase()===enteredEmail)||
        (enteredPhone&&normalizedPhone(c.phone)===enteredPhone)
      );
      if(duplicates.length){
        const match=duplicates[0];
        if(clientDraft?.conversation_id){
          status.textContent='Possível duplicidade com '+contactDisplayName(match)+
            '. Volte ao atendimento e use “Vincular existente”, sem criar outro cadastro.';
          return;
        }
        const approved=await askConfirmation({
          title:'Possível cliente duplicado',
          message:'Existe cadastro com e-mail ou telefone igual: '+contactDisplayName(match)+
            '. Confirme somente se for outra pessoa ou empresa e você realmente precisar de um novo cadastro.'
        });
        if(!approved||!form.isConnected)return;
      }
    }
    const payload={
      p_company:val('company_name'),p_name:val('person_name'),
      p_segment:val('segment'),p_email:val('email'),p_phone:val('phone'),
      p_city:val('city'),p_state:val('state').toUpperCase()
    };
    const buttons=[...form.querySelectorAll('button,input')];
    buttons.forEach(item=>item.disabled=true);
    status.textContent='Salvando cadastro...';
    let result;
    try{
      if(newMode && clientDraft?.lead_id && clientDraft?.conversation_id){
        result=await sb.rpc('lkz_adm_create_client_from_conversation',{
          p_id:requestId,p_conversation:clientDraft.conversation_id,
          p_expected_lead:clientDraft.lead_id,...payload
        });
      }else if(newMode){
        result=await sb.rpc('lkz_adm_create_client',{p_id:requestId,...payload});
      }else{
        result=await sb.rpc('lkz_adm_edit_client',{p_id:selected.id,p_version:selected.updated_at,...payload});
      }
    }catch{result={error:{code:'REDE'}}}
    if(!form.isConnected||!user)return;
    if(result.error||!result.data?.id){
      status.textContent='Não foi possível salvar. Código: '+(result.error?.code||'SEM_CONFIRMACAO')+
        '. Verifique os campos e o estado atual antes de tentar novamente.';
      buttons.forEach(item=>item.disabled=false);
      return;
    }
    const updated=result.data;
    state.contacts=[updated,...state.contacts.filter(c=>c.id!==updated.id)];
    if(newMode&&clientDraft?.lead_id){
      const linkedLead=state.leads.find(l=>l.id===clientDraft.lead_id);
      if(linkedLead)linkedLead.contact_id=updated.id;
    }
    clientDraft=null;clientFocus=updated.id;clientMode='detail';
    try{await loadCommercial()}catch{ /* O registro retornado pela RPC permanece disponível. */ }
    clients(newMode?'Cliente cadastrado com sucesso.':'Cadastro atualizado com sucesso.');
  };
}
function finance(){el('content').innerHTML='<section class="panel"><h2>Cobranças</h2><p>A integração de pagamento ainda está pendente.</p></section>'}
function usage(){
  const c=state.loadMeta?.counts||{};
  el('content').innerHTML=dataScopeNotice()+'<div class="grid">'+
    k('Oportunidades',c.leads??state.leads.length,'Total do banco')+
    k('Conversas',c.conversations??state.threads.length,'Total do banco')+
    k('Contatos',c.contacts??state.contacts.length,'Total do banco')+
    k('Retornos',c.followups??state.followups.length,'Total do banco')+'</div>';
}
function tasks(){
  const items=dailyBrief(state).priorities;
  el('content').innerHTML='<section class="panel"><h2>Prioridades comerciais</h2>'+
    (items.map(item=>'<div class="row"><span><strong>'+esc(item.name)+'</strong><br>'+
      esc([...item.reasons].join(' · '))+'</span>'+
      '<button type="button" class="cta" data-task-key="'+esc(item.key)+'">Abrir ficha</button></div>'
    ).join('')||'<p>Nenhuma demanda prioritária encontrada.</p>')+'</section>';
  el('content').querySelectorAll('[data-task-key]').forEach(button=>button.onclick=()=>{
    const item=items.find(x=>x.key===button.dataset.taskKey);
    if(item)navigatePriority(item.target,item.followupId,item.leadId);
  });
}
function settings(){
  el('content').innerHTML='<section class="panel form-panel"><h2>Sessão administrativa</h2>'+
    '<p>O painel encerra a sessão após 30 minutos de inatividade enquanto esta guia estiver aberta. '+
    'Ao fechar ou recarregar a página, o login e o MFA serão solicitados novamente.</p>'+
    '<p>Por segurança, nenhuma credencial de renovação é guardada no navegador. '+
    'Persistência segura após fechar a guia exige um backend com cookie HttpOnly; ainda não foi implementada.</p>'+
    '<p>Use o bloqueio de tela do sistema operacional ao se afastar.</p></section>'+
    (profile?.role==='master'?'<section id="userManagement" class="panel">'+
      '<h2>Usuários e grupos de acesso</h2><p role="status">Carregando usuários…</p></section>':'');
  const target=el('userManagement');
  if(target)loadUsers(target);
}
async function loadUsers(target,feedback=''){
  const {data,error}=await sb.rpc('lkz_adm_list_users');
  if(!target.isConnected||profile?.role!=='master')return;
  if(error){msg(target.querySelector('[role=status]'),'Não foi possível carregar os usuários.');return}
  target.innerHTML='<h2>Usuários e grupos de acesso</h2><p role="status">'+esc(feedback)+'</p>'+
    '<div class="table"><table><thead><tr><th>Nome</th><th>Grupo</th><th>Status</th><th>Ações</th></tr></thead><tbody>'+
    (data||[]).map(item=>{
      const protectedAccount=item.role==='master';
      const role=protectedAccount?'MASTER':'<select aria-label="Grupo de acesso">'+Object.entries(accessGroups)
        .filter(([id])=>id!=='master').map(([id,title])=>'<option value="'+id+'"'+(item.role===id?' selected':'')+'>'+title+'</option>').join('')+'</select>';
      return '<tr data-account="'+esc(item.id)+'"><td>'+(protectedAccount?esc(item.full_name||'Conta MASTER'):
        '<input aria-label="Nome do usuário" value="'+esc(item.full_name||'')+'" maxlength="120">')+'</td><td>'+role+'</td>'+
        '<td>'+ (item.active?'Ativo':'Inativo')+'</td><td>'+(protectedAccount?'Conta protegida':
        '<div class="action-row"><button class="cta" data-user-action="edit">Salvar edição</button>'+
        '<button class="cta" data-user-action="'+(item.active?'deactivate':'activate')+'">'+(item.active?'Desativar':'Ativar')+'</button>'+
        '<button class="cta danger" data-user-action="remove">Excluir acesso</button></div>')+'</td></tr>';
    }).join('')+'</tbody></table></div>';
  target.querySelectorAll('[data-user-action]').forEach(button=>button.onclick=async()=>{
    const row=button.closest('[data-account]'),item=data.find(entry=>entry.id===row.dataset.account);
    const action=button.dataset.userAction;
    if(action==='remove'&&!await askConfirmation({
      title:'Excluir acesso do usuário',
      message:'Revogar o acesso deste usuário ao LKZ ADM? A conta MASTER permanece protegida.',
      keyword:'EXCLUIR',destructive:true
    }))return;
    const controls=[...row.querySelectorAll('input,select,button')];
    controls.forEach(control=>control.disabled=true);
    const {error}=await sb.rpc('lkz_adm_manage_user',{p_id:item.id,p_version:item.updated_at,p_action:action,
      p_name:row.querySelector('input').value,p_role:row.querySelector('select').value});
    if(!row.isConnected||!user)return;
    if(error){
      controls.forEach(control=>control.disabled=false);
      msg(target.querySelector('[role=status]'),'Não foi possível confirmar a alteração. Reabra a tela e confira o cadastro.');
      return;
    }
    await loadUsers(target,'Acesso atualizado.');
  });
}
el('search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();leadFocus=null;view('leads')}};
el('refreshData').onclick=async()=>{
  if(!user)return;
  const button=el('refreshData');
  button.disabled=true;button.textContent='Atualizando...';
  try{
    await loadCommercial();
    if(user)view(currentView);
  }catch(error){
    console.warn('lkz_adm_refresh_failed',error?.code||'NETWORK');
    button.textContent='Falha. Tentar novamente';
  }finally{button.disabled=false;if(button.textContent==='Atualizando...')button.textContent='Atualizar'}
}; 
(async()=>{const {data:{user:u}}=await sb.auth.getUser();if(!u)return showLogin();try{const p=await authorize(u);if(!p){await sb.auth.signOut();return showLogin('Conta sem permissão administrativa.')}await enforceMfa(p,u)}catch(e){console.error(e);await sb.auth.signOut();showLogin('Não foi possível validar a sessão.')}})();
