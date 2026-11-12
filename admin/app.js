'use strict';
const sb=window.supabase.createClient('https://icrtewhazpfauuroswri.supabase.co','sb_publishable_6PdAW2f-dpXhsaZXI0lyBg_PcGtuWgs',{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false}});
const el=id=>document.getElementById(id);
const ADMIN_IDLE_MS=24*60*60*1000; // tolerância máxima em memória, sem persistir refresh token
const accessGroups={master:'MASTER',admin:'Administrador',commercial:'Comercial',viewer:'Consulta'};
let user=null,profile=null,factorId=null,challengeId=null,idleTimer=null;
let lastInteractionAt=0,endingForIdle=false;
let state={leads:[],contacts:[],threads:[],followups:[],approvals:[]};
const CONVERSATION_POLL_MS=20000;
let currentView='overview',conversationPollTimer=null,conversationPollBusy=false;
let conversationFolder='active',conversationFocus=null,conversationFlash='';
let followupFilter='pending',followupFocus=null,leadFocus=null;
let clientFocus=null,clientMode='detail',clientDraft=null;
const systemCatalog=[
  {code:'LISP',name:'LKZ ISP Intelligence',description:'Indicadores gerenciais para provedores de internet.',url:'../lkzisp/'},
  {code:'LCRM',name:'Lacrose CRM',description:'Clientes, oportunidades, tarefas e conversas comerciais.',url:'https://lcrm.lacrosetecnologia.com.br/app/'}
];
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const label=s=>({new:'Novo',diagnosing:'Diagnóstico',qualified:'Qualificado',human_review:'Revisão humana',contacted:'Contato realizado',proposal:'Proposta',won:'Fechado',lost:'Perdido',archived:'Arquivado',pending:'Pendente',approved:'Aprovado',rejected:'Rejeitado',done:'Concluído',cancelled:'Cancelado'})[s]||s;
const tag=s=>{const t=label(s),c=['Fechado','Aprovado','Concluído'].includes(t)?'ok':['Perdido','Rejeitado'].includes(t)?'err':['Pendente','Revisão humana','Proposta'].includes(t)?'warn':'info';return '<span class="tag '+c+'">'+esc(t)+'</span>'};
function msg(node,text){node.textContent=text||''}
function showLogin(text=''){stopConversationPolling();setMenu(false);clearTimeout(idleTimer);el('app').hidden=true;el('content').replaceChildren();el('mfaScreen').hidden=true;el('auth').hidden=false;msg(el('authMsg'),text);el('password').value=''}
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
async function loadCommercial(){
  const [lr,cr,vr,fr,ar,folders]=await Promise.all([
    sb.from('leads').select('*').order('updated_at',{ascending:false}).limit(100),
    sb.from('contacts').select('id,company_name,person_name,segment,email,phone,city,state,created_at,updated_at,consent_contact').order('created_at',{ascending:false}).limit(200),
    sb.from('conversations').select('id,lead_id,last_message_at,started_at,status,channel').order('last_message_at',{ascending:false}).limit(100),
    sb.from('followups').select('*').order('due_at',{ascending:true}).limit(100),
    sb.from('approvals').select('*').order('requested_at',{ascending:false}).limit(100),
    sb.rpc('lkz_adm_list_conversation_folders')
  ]);
  const err=lr.error||cr.error||vr.error||fr.error||ar.error||folders.error;
  if(err)throw err;
  const contacts=cr.data||[],cm=new Map(contacts.map(c=>[c.id,c])),lm=new Map();
  const folderMap=new Map((folders.data||[]).map(entry=>[entry.conversation_id,entry.folder]));
  (lr.data||[]).forEach(l=>{const c=cm.get(l.contact_id)||{};lm.set(l.id,{...l,name:c.company_name||c.person_name||'Contato sem nome',contact:c.phone||c.email||'—'})});
  state={
    contacts,leads:[...lm.values()],
    threads:(vr.data||[]).map(c=>({
  id:c.id,
  lead:(lm.get(c.lead_id)?.name&&!['Contato sem nome','Conversa sem lead'].includes(lm.get(c.lead_id)?.name))?lm.get(c.lead_id).name:'Atendimento '+c.id.slice(0,8).toUpperCase(),
  last:c.last_message_at||c.started_at,channel:c.channel||'Site',lead_id:c.lead_id,folder:folderMap.get(c.id)||'active'
})),
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
    const {data,error}=await sb.from('conversations')
      .select('id,last_message_at,started_at')
      .order('last_message_at',{ascending:false}).limit(100);
    if(error||!user||currentView!=='conversations'||conversationRefreshBlocked())return;
    const remoteKey=JSON.stringify((data||[]).map(item=>[item.id,item.last_message_at||item.started_at]));
    if(remoteKey===threadStampKey(state.threads))return;

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
  systems:['Sistemas','Acesso operacional aos sistemas da Lacrose.'],
  clients:['Clientes','Cadastros e contatos comerciais.'],
  finance:['Financeiro','Integração de cobrança pendente.'],
  usage:['Atividade','Indicadores dos registros comerciais carregados.'],
  tasks:['Demandas','Pendências comerciais que precisam de ação.'],
  commercial:['Visão comercial','Resumo dos registros comerciais.'],
  leads:['Oportunidades','Leads e estágios comerciais.'],
  conversations:['Atendimentos','Converse com o cliente pelo CRM e gerencie o histórico.'],
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
function render(v){return {overview,crm,systems,clients,finance,usage,tasks,commercial,leads,conversations,followups,approvals,settings}[v]()}

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
function navigatePriority(target,followupId,leadId){
  if(target==='followups'){
    followupFocus=followupId||null;followupFilter='all';view('followups');
    if(followupFocus)openFollowupEditor('detail',followupFocus);
  }else if(target==='leads'||target==='approvals'){
    if(target==='approvals'&&!leadId){view('approvals');return}
    openOpportunity(leadId);
  }else view('crm');
}
function overview(){
  const info=dailyBrief(state);
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
    '<div class="grid dashboard-kpis">'+
      k('Oportunidades',state.leads.length,'Registros comerciais')+
      k('Atendimentos',state.threads.filter(t=>t.folder==='active').length,'Na caixa de entrada')+
      k('Retornos pendentes',pending,'Aguardando ação')+
      k('Clientes',state.contacts.length,'Cadastros disponíveis')+
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
      '</section></div>';
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
    '<article><h3>LCRM</h3><p>Clientes, tarefas, oportunidades e canais do CRM.</p><a class="cta" href="'+
    systemCatalog.find(item=>item.code==='LCRM').url+'">Abrir LCRM</a></article></div></section>';
  el('content').querySelectorAll('[data-commercial-view]').forEach(button=>button.onclick=()=>view(button.dataset.commercialView));
}

const crmStages=[
  ['new','Novos'],['diagnosing','Diagnóstico'],['qualified','Qualificados'],
  ['human_review','Revisão'],['contacted','Contato feito'],['proposal','Propostas'],['won','Fechados']
];
function openOpportunity(id){
  leadFocus=id;el('search').value='';view('leads');
  showOpportunity(id);
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
    '<div class="grid crm-mini-stats">'+k('Oportunidades abertas',active.length,'Em atendimento')+
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
    '<p class="result-count">'+records.length+' oportunidade(s) encontrada(s)</p>'+
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
    try{await loadCommercial();}catch{}
    view('leads');
    const visible=state.leads.find(l=>l.id===id);
    if(visible)showOpportunity(id,'Atividade registrada e auditada.');
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
      '<span class="thread-info"><b>'+esc(t.lead)+'</b><small>'+esc(t.channel)+' · '+esc(dateLabel(t.last))+'</small></span>'+
    '</button>').join('');
  el('content').innerHTML=
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

const messageFolders={active:'Caixa de entrada',archived:'Arquivados',deleted:'Lixeira'};
const messageActions={
  active:{archived:'Arquivar mensagens',deleted:'Excluir mensagens'},
  archived:{active:'Restaurar mensagens',deleted:'Excluir mensagens'},
  deleted:{active:'Restaurar mensagens',purge:'Apagar definitivamente'}
};
async function conversationAction(id,action){
  const t=state.threads.find(item=>item.id===id);
  if(!t)return;
  if(action==='trash'&&!window.confirm('Excluir este atendimento da lista e mover todo o histórico à Lixeira? Você poderá restaurá-lo.'))return;
  if(action==='purge'){
    if(profile?.role!=='master')return;
    const answer=window.prompt('EXCLUSÃO DEFINITIVA do atendimento e de todas as suas mensagens. Não é possível desfazer. Digite EXCLUIR para confirmar:');
    if(answer!=='EXCLUIR')return;
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
    ?'<button type="button" class="cta secondary" data-message-contact="open">Abrir contato</button>'
    :'<button type="button" class="cta secondary" data-message-contact="new">Salvar contato</button>';
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
        '<h2>'+esc(thread.lead)+'</h2><small>Oportunidade vinculada: '+(thread.lead_id?'Sim':'Não')+'</small></div>'+
        '<div class="conversation-actions">'+contactControl+controls+'</div></div>'+
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
    '<p class="message-status" data-notice role="status">'+esc(feedback)+'</p>'+
    '<div class="message-stream">'+(items||'<p class="empty">Nenhuma mensagem nesta pasta.</p>')+'</div>'+
    '<div class="message-pagination">'+
      (next?'<button type="button" class="cta" data-older>Mensagens anteriores</button>':'')+
      (before?'<button type="button" class="cta" data-recent>Voltar às recentes</button>':'')+
    '</div>';
  page.querySelector('.message-back').onclick=()=>el('chatWorkspace')?.classList.remove('is-detail');
  page.querySelectorAll('[data-conversation-action]').forEach(button=>button.onclick=()=>conversationAction(id,button.dataset.conversationAction));
  page.querySelector('[data-message-contact]')?.addEventListener('click',async()=>{
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
  });
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
    if(destination==='purge'){
      const answer=window.prompt('Apagar definitivamente '+ids.length+' mensagem(ns)? Digite EXCLUIR para confirmar:');
      if(answer!=='EXCLUIR')return;
    }
    const status=page.querySelector('[data-notice]');
    page.querySelectorAll('button,input').forEach(control=>control.disabled=true);
    status.textContent='Processando '+ids.length+' mensagem(ns)...';
    let result;
    try{
      result=destination==='purge'
        ?await sb.rpc('lkz_adm_purge_messages',{p_conversation:id,p_ids:ids})
        :await sb.rpc('lkz_adm_move_messages',{p_conversation:id,p_ids:ids,p_from:folder,p_to:destination});
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
function followups(){const body=state.followups.map(f=>'<tr><td><b>'+esc(f.lead)+'</b></td><td>'+esc(f.channel||'—')+'</td><td>'+esc(f.due_at?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Bahia'}).format(new Date(f.due_at)):'—')+'</td><td>'+tag(f.status)+'</td></tr>').join('');el('content').innerHTML='<div class="table"><table><thead><tr><th>Lead</th><th>Canal</th><th>Prazo</th><th>Status</th></tr></thead><tbody>'+body+'</tbody></table></div><p class="notice">Consulta de retornos. Reagendamento e contato são feitos pelo LCRM, até existir integração operacional homologada.</p>'}
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
    if(!window.confirm(status==='approved'?'Confirmar aprovação?':'Confirmar rejeição?'))return;
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
    '<div class="grid client-kpis">'+
      k('Contatos',contacts.length,'Registros carregados')+
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
function usage(){el('content').innerHTML='<div class="grid">'+k('Leads',state.leads.length,'Registros carregados')+
  k('Conversas',state.threads.length,'Registros carregados')+k('Contatos',state.contacts.length,'Registros carregados')+'</div>'}
function tasks(){
  const items=dailyBrief(state).priorities;
  el('content').innerHTML='<section class="panel"><h2>Prioridades comerciais</h2>'+(items.map(item=>
    '<div class="row"><span><strong>'+esc(item.name)+'</strong><br>'+esc([...item.reasons].join(' · '))+'</span>'+
    '<button type="button" class="cta" data-task-view="'+item.view+'">Abrir</button></div>'
  ).join('')||'<p>Nenhuma demanda prioritária encontrada.</p>')+'</section>';
  el('content').querySelectorAll('[data-task-view]').forEach(button=>button.onclick=()=>view(button.dataset.taskView));
}
function settings(){
  el('content').innerHTML='<section class="panel form-panel"><h2>Sessão administrativa</h2>'+
    '<p>O painel verifica inatividade por até 24 horas enquanto esta guia estiver aberta. '+
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
    if(action==='remove'&&!window.confirm('Excluir o acesso deste usuário ao LKZ ADM?'))return;
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
el('search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();view('leads')}}; 
(async()=>{const {data:{user:u}}=await sb.auth.getUser();if(!u)return showLogin();try{const p=await authorize(u);if(!p){await sb.auth.signOut();return showLogin('Conta sem permissão administrativa.')}await enforceMfa(p,u)}catch(e){console.error(e);await sb.auth.signOut();showLogin('Não foi possível validar a sessão.')}})();
