'use strict';
const sb=window.supabase.createClient('https://icrtewhazpfauuroswri.supabase.co','sb_publishable_6PdAW2f-dpXhsaZXI0lyBg_PcGtuWgs',{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false}});
const el=id=>document.getElementById(id);
const ADMIN_IDLE_MS=30*60*1000;
const idleOptions=[5,15,30,60,120];
const accessGroups={master:'MASTER',admin:'Administrador',commercial:'Comercial',viewer:'Consulta'};
let user=null,profile=null,factorId=null,challengeId=null,idleTimer=null;
let idleMs=ADMIN_IDLE_MS;
let state={leads:[],contacts:[],threads:[],followups:[],approvals:[]};
const systemCatalog=[
  {code:'LISP',name:'LKZ ISP Intelligence',description:'Indicadores gerenciais para provedores de internet.',url:'../lkzisp/'},
  {code:'LCRM',name:'Lacrose CRM',description:'Clientes, oportunidades, tarefas e conversas comerciais.',url:'https://lcrm.lacrosetecnologia.com.br/app/'}
];
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const label=s=>({new:'Novo',diagnosing:'Diagnóstico',qualified:'Qualificado',human_review:'Revisão humana',contacted:'Contato realizado',proposal:'Proposta',won:'Fechado',lost:'Perdido',archived:'Arquivado',pending:'Pendente',approved:'Aprovado',rejected:'Rejeitado',done:'Concluído',cancelled:'Cancelado'})[s]||s;
const tag=s=>{const t=label(s),c=['Fechado','Aprovado','Concluído'].includes(t)?'ok':['Perdido','Rejeitado'].includes(t)?'err':['Pendente','Revisão humana','Proposta'].includes(t)?'warn':'info';return '<span class="tag '+c+'">'+esc(t)+'</span>'};
function msg(node,text){node.textContent=text||''}
function showLogin(text=''){setMenu(false);clearTimeout(idleTimer);el('app').hidden=true;el('content').replaceChildren();el('mfaScreen').hidden=true;el('auth').hidden=false;msg(el('authMsg'),text);el('password').value=''}
async function authorize(u){const {data,error}=await sb.from('profiles').select('full_name,role,active').eq('id',u.id).maybeSingle();if(error)throw error;return data&&data.active&&['master','admin'].includes(data.role)?data:null}
async function enforceMfa(p,u){const {data:aal,error}=await sb.auth.mfa.getAuthenticatorAssuranceLevel();if(error)throw error;if(aal?.currentLevel==='aal2')return enter(p,u);const {data:factors,error:fe}=await sb.auth.mfa.listFactors();if(fe)throw fe;let factor=factors?.totp?.[0];if(!factor){const {data:en,error:ee}=await sb.auth.mfa.enroll({factorType:'totp',friendlyName:'LKZ ADM'});if(ee)throw ee;factor=en;el('enroll').hidden=false;el('qr').src=en.totp?.qr_code||'';el('secret').textContent=en.totp?.secret||'';el('mfaIntro').textContent='Configure o autenticador e confirme o código.'}else{el('enroll').hidden=true;el('mfaIntro').textContent='Digite o código atual do autenticador.'}const {data:ch,error:ce}=await sb.auth.mfa.challenge({factorId:factor.id});if(ce)throw ce;profile=p;user=u;factorId=factor.id;challengeId=ch.id;el('auth').hidden=true;el('mfaScreen').hidden=false;el('code').value='';setTimeout(()=>el('code').focus(),40)}
function idlePreference(){return 'lkz-adm-idle-minutes:'+user.id}
async function enter(p,u){
  profile=p;user=u;idleMs=ADMIN_IDLE_MS;
  try{
    const minutes=Number(localStorage.getItem(idlePreference()));
    if(idleOptions.includes(minutes))idleMs=minutes*60*1000;
  }catch{}
  el('auth').hidden=true;el('mfaScreen').hidden=true;el('app').hidden=false;el('userName').textContent=p.full_name||u.email;el('userRole').textContent=p.role;resetIdle();await loadCommercial();view('overview')
}
function resetIdle(){clearTimeout(idleTimer);if(!user)return;idleTimer=setTimeout(async()=>{await sb.auth.signOut();user=null;profile=null;showLogin('Sessão encerrada por inatividade.')},idleMs)}
['click','keydown','pointerdown'].forEach(e=>document.addEventListener(e,()=>{if(user)resetIdle()},{passive:true}));
el('loginForm').onsubmit=async e=>{e.preventDefault();el('loginBtn').disabled=true;msg(el('authMsg'),'');try{const {data,error}=await sb.auth.signInWithPassword({email:el('email').value.trim(),password:el('password').value});if(error)throw error;const p=await authorize(data.user);if(!p){await sb.auth.signOut();throw new Error('Conta sem permissão administrativa.')}await enforceMfa(p,data.user)}catch(err){console.error(err);msg(el('authMsg'),err.message||'Falha no login.')}finally{el('loginBtn').disabled=false}};
el('mfaForm').onsubmit=async e=>{e.preventDefault();el('mfaBtn').disabled=true;try{const {error}=await sb.auth.mfa.verify({factorId,challengeId,code:el('code').value.trim()});if(error)throw error;await enter(profile,user)}catch(err){console.error(err);msg(el('mfaMsg'),'Código inválido ou expirado.')}finally{el('mfaBtn').disabled=false}};
el('cancelMfa').onclick=async()=>{await sb.auth.signOut();showLogin()};el('logout').onclick=async()=>{setMenu(false);await sb.auth.signOut();user=null;profile=null;showLogin()};
async function loadCommercial(){
  const [lr,cr,vr,fr,ar]=await Promise.all([
    sb.from('leads').select('*').order('updated_at',{ascending:false}).limit(100),
    sb.from('contacts').select('id,company_name,person_name,email,phone').order('created_at',{ascending:false}).limit(200),
    sb.from('conversations').select('id,lead_id,last_message_at,status').order('last_message_at',{ascending:false}).limit(100),
    sb.from('followups').select('*').order('due_at',{ascending:true}).limit(100),
    sb.from('approvals').select('*').order('requested_at',{ascending:false}).limit(100)
  ]);
  const err=lr.error||cr.error||vr.error||fr.error||ar.error;
  if(err)throw err;
  const contacts=cr.data||[],cm=new Map(contacts.map(c=>[c.id,c])),lm=new Map();
  (lr.data||[]).forEach(l=>{const c=cm.get(l.contact_id)||{};lm.set(l.id,{...l,name:c.company_name||c.person_name||'Contato sem nome',contact:c.phone||c.email||'—'})});
  state={
    contacts,leads:[...lm.values()],
    threads:(vr.data||[]).map(c=>({id:c.id,lead:lm.get(c.lead_id)?.name||'Conversa sem lead',last:c.last_message_at})),
    followups:(fr.data||[]).map(f=>({...f,lead:lm.get(f.lead_id)?.name||'Lead'})),
    approvals:(ar.data||[]).map(a=>({...a,lead:lm.get(a.lead_id)?.name||'Lead'}))
  };
}
const titles={overview:['OCA · Hoje','Prioridades da Lacrose para acompanhar ao longo do dia.'],systems:['Sistemas','Acesso operacional aos sistemas da Lacrose.'],clients:['Clientes','Cadastre e consulte clientes da Lacrose.'],finance:['Financeiro','Configuração de cobrança pendente.'],usage:['Uso e Atividade','Atividade nos registros comerciais carregados.'],tasks:['Demandas','Pendências comerciais que precisam de ação.'],commercial:['Visão Comercial','Dados do Agente Comercial.'],leads:['Leads','Oportunidades registradas pelo comercial.'],conversations:['Conversas','Consulte e organize as mensagens de cada conversa.'],followups:['Follow-ups','Retornos programados pelo comercial.'],approvals:['Aprovações','Decisões do fluxo comercial.'],settings:['Configurações','Preferências da sessão e gestão de acesso.']};
const mobileMenu=el('mobileMenu'),sidebarBackdrop=el('sidebarBackdrop');
function setMenu(open){
  document.body.classList.toggle('menu-open',open);
  mobileMenu?.setAttribute('aria-expanded',String(open));
}
mobileMenu?.addEventListener('click',()=>setMenu(!document.body.classList.contains('menu-open')));
sidebarBackdrop?.addEventListener('click',()=>setMenu(false));
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view(b.dataset.view);setMenu(false)});
function view(v){document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===v));el('title').textContent=titles[v][0];el('subtitle').textContent=titles[v][1];render(v)}
function k(l,v,m){return '<article class="kpi"><span>'+l+'</span><strong>'+v+'</strong><small>'+m+'</small></article>'}
function render(v){return {overview,systems,clients,finance,usage,tasks,commercial,leads,conversations,followups,approvals,settings}[v]()}
function dailyBrief(data, now = Date.now()) {
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bahia', dateStyle: 'short' });
  const today = day.format(now);
  const inactive = new Set(data.leads.filter(lead => ['lost', 'archived'].includes(lead.status)).map(lead => lead.id));
  const actions = [];
  const add = (item, priority, view, reason, dueAt) => {
    if (inactive.has(item.lead_id)) return;
    actions.push({
      key: item.lead_id || view + ':' + item.id,
      name: item.lead,
      priority, view, reason, dueAt: Number.isFinite(dueAt) ? dueAt : Infinity
    });
  };
  for (const item of data.followups) {
    if (item.status !== 'pending') continue;
    const dueAt = Date.parse(item.due_at);
    if (dueAt < now) add(item, 0, 'followups', 'Retorno atrasado', dueAt);
    else if (Number.isFinite(dueAt) && day.format(dueAt) === today) add(item, 2, 'followups', 'Retorno hoje', dueAt);
  }
  for (const item of data.approvals) {
    if (item.status === 'pending') add(item, 1, 'approvals', 'Aprovação pendente', Date.parse(item.requested_at));
  }
  for (const lead of data.leads) {
    if (lead.status !== 'won' && (lead.status === 'human_review' || lead.needs_human_review === true)) {
      add({ lead_id: lead.id, lead: lead.name }, 3, 'leads', 'Escopo para revisar', Date.parse(lead.updated_at));
    }
  }
  actions.sort((a, b) => a.priority - b.priority || a.dueAt - b.dueAt || a.key.localeCompare(b.key));
  const grouped = new Map();
  for (const action of actions) {
    if (!grouped.has(action.key)) grouped.set(action.key, { ...action, reasons: new Set() });
    grouped.get(action.key).reasons.add(action.reason);
  }
  return {
    overdue: actions.filter(action => action.priority === 0).length,
    dueToday: actions.filter(action => action.priority === 2).length,
    approvals: actions.filter(action => action.priority === 1).length,
    priorities: [...grouped.values()]
  };
}

function overview() {
  const { overdue, dueToday, approvals, priorities } = dailyBrief(state);
  const list = priorities.slice(0, 12).map(item =>
    '<div class="row"><span><strong>' + esc(item.name || 'Oportunidade') + '</strong><br>' +
    esc([...item.reasons].join(' · ')) + '</span><button type="button" class="cta" data-brief-view="' +
    item.view + '">Abrir</button></div>'
  ).join('');
  el('content').innerHTML = '<div class="grid">' +
    k('Retornos atrasados', overdue, 'Prazo vencido') +
    k('Retornos de hoje', dueToday, 'Ainda no prazo') +
    k('Aprovações', approvals, 'Decisões pendentes') +
    '</div><div class="layout"><section class="panel"><h2>OCA · Prioridades do dia</h2>' +
    '<p>' + priorities.length + ' prioridades nos registros carregados.</p>' +
    (list || '<p>Nenhuma prioridade encontrada nos registros carregados.</p>') +
    '</section><section class="panel"><h2>Operação da Lacrose</h2>' +
    '<p>Acompanhe as prioridades aqui e abra o CRM para operar clientes, tarefas e conversas.</p>' +
    '<a class="cta" href="https://lcrm.lacrosetecnologia.com.br/app/">Abrir LCRM</a>' +
    '</section></div>';
  el('content').querySelectorAll('[data-brief-view]').forEach(button => {
    button.addEventListener('click', () => view(button.dataset.briefView));
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
function leads(){
  const body=state.leads.map(l=>'<tr><td><b>'+esc(l.name)+'</b></td><td>'+esc(l.contact)+'</td><td>'+esc(l.suggested_solution||l.intent||l.category||'—')+'</td><td>'+tag(l.status)+'</td><td>'+esc(l.source||'—')+'</td><td><button class="cta" data-lead="'+esc(l.id)+'">Ver detalhes</button></td></tr>').join('');
  el('content').innerHTML='<div id="leadDetails"></div><div class="table"><table><thead><tr><th>Lead</th><th>Contato</th><th>Interesse</th><th>Status</th><th>Origem</th><th>Ação</th></tr></thead><tbody>'+body+'</tbody></table></div>';
  el('content').querySelectorAll('[data-lead]').forEach(button=>button.onclick=()=>{
    const lead=state.leads.find(item=>item.id===button.dataset.lead);
    el('leadDetails').innerHTML='<section class="panel form-panel"><h2>'+esc(lead.name)+'</h2>'+
      '<p>'+esc(lead.problem||lead.suggested_solution||lead.intent||'Sem detalhes adicionais.')+'</p>'+
      '<p>'+esc(lead.contact)+' · '+tag(lead.status)+'</p></section>';
    el('leadDetails').scrollIntoView({block:'nearest'});
  });
}
const dateLabel=value=>value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Bahia'}).format(new Date(value)):'—';
function conversations(){
  el('content').innerHTML='<div class="chat"><div class="threads">'+state.threads.map(t=>
    '<button class="thread" data-thread="'+esc(t.id)+'"><b>'+esc(t.lead)+'</b><span>'+esc(dateLabel(t.last))+'</span></button>'
  ).join('')+'</div><div id="messagePane" class="messages"><div class="empty">'+
    (state.threads.length?'Selecione uma conversa.':'Nenhuma conversa encontrada.')+'</div></div></div>';
  el('content').querySelectorAll('[data-thread]').forEach(button=>button.onclick=()=>openThread(button.dataset.thread));
}

const messageFolders={active:'Caixa de entrada',archived:'Arquivadas',deleted:'Lixeira'};
const messageActions={active:{archived:'Arquivar',deleted:'Mover para a Lixeira'},archived:{active:'Desarquivar',deleted:'Mover para a Lixeira'},deleted:{active:'Restaurar',purge:'Apagar definitivamente'}};
async function openThread(id,folder='active',before=null,feedback=''){
  const thread=state.threads.find(item=>item.id===id);
  const pane=el('messagePane');
  if(!thread||!pane)return;
  el('content').querySelectorAll('[data-thread]').forEach(button=>button.classList.toggle('active',button.dataset.thread===id));
  const page=document.createElement('section');
  page.setAttribute('aria-busy','true');
  page.innerHTML='<h2>'+esc(thread.lead)+'</h2><p role="status">Carregando mensagens…</p>';
  pane.replaceChildren(page);
  let result=await sb.rpc('lkz_adm_list_messages',{p_conversation:id,p_folder:folder,p_before:before});
  const available=result.error?.code!=='PGRST202';
  if(!available&&folder==='active'){
    result=await sb.from('messages').select('role,content,created_at').eq('conversation_id',id).order('id',{ascending:false}).limit(50);
  }
  if(!page.isConnected||!user)return;
  page.removeAttribute('aria-busy');
  if(result.error){
    page.querySelector('[role=status]').textContent='Não foi possível carregar as mensagens.';
    return;
  }
  const items=result.data||[];
  const next=available&&items.length>50?items[49].id:null;
  const actions=Object.entries(messageActions[folder]);
  page.innerHTML='<h2>'+esc(thread.lead)+'</h2>'+
    (available?'<div class="message-tools" aria-label="Pastas de mensagens">'+Object.entries(messageFolders).map(([key,title])=>
      '<button type="button" class="cta" aria-pressed="'+(folder===key)+'" data-folder="'+key+'">'+title+'</button>'
    ).join('')+'</div>':'')+
    '<p role="status">'+esc(available?feedback:'O gerenciamento de mensagens aguarda a atualização do banco.')+'</p>'+
    (available&&items.length?'<div class="message-actions" aria-label="Ações das mensagens">'+
      '<p data-selection role="status">Selecione as mensagens que deseja mover ou apagar.</p><div class="message-tools">'+
      actions.map(([key,title])=>'<button class="cta" type="button" data-move="'+key+'" disabled>'+title+'</button>').join('')+
      '</div><div class="message-confirm" data-confirm hidden><p data-confirm-text></p><div class="message-tools">'+
      '<button class="cta danger" type="button" data-confirm-delete>Confirmar exclusão definitiva</button>'+
      '<button class="cta" type="button" data-cancel-delete>Cancelar</button></div></div></div>':'')+
    (items.length?'':'<p>Nenhuma mensagem nesta pasta.</p>')+
    items.slice(0,50).reverse().map(item=>{
      const bubble='<span><span class="message-text">'+esc(item.content)+'</span><small>'+esc(dateLabel(item.created_at))+'</small></span>';
      const style='bubble'+(item.role==='user'?'':' out');
      return available?'<label class="'+style+' selectable"><input type="checkbox" value="'+esc(item.id)+'" aria-label="Selecionar mensagem">'+bubble+'</label>':
        '<div class="'+style+'">'+bubble+'</div>';
    }).join('')+
    (next?'<button class="cta" type="button" data-older>Mensagens anteriores</button>':'')+
    (before?'<button class="cta" type="button" data-recent>Voltar às recentes</button>':'');
  const selected=()=>[...page.querySelectorAll('input:checked')].map(input=>input.value);
  const buttons=[...page.querySelectorAll('[data-move]')];
  const selection=page.querySelector('[data-selection]');
  const confirmation=page.querySelector('[data-confirm]');
  page.querySelectorAll('[data-folder]').forEach(button=>button.onclick=()=>openThread(id,button.dataset.folder));
  page.querySelector('[data-older]')?.addEventListener('click',()=>openThread(id,folder,next));
  page.querySelector('[data-recent]')?.addEventListener('click',()=>openThread(id,folder));
  if(!selection)return page;
  page.onchange=()=>{
    const count=selected().length;
    selection.textContent=count?count+' selecionada(s).':'Selecione as mensagens que deseja mover ou apagar.';
    buttons.forEach(button=>button.disabled=count===0);
    confirmation.hidden=true;
  };
  async function move(destination){
    const ids=selected();
    if(!ids.length)return;
    page.querySelectorAll('button,input').forEach(control=>control.disabled=true);
    selection.textContent='Salvando…';
    const {data,error}=destination==='purge'
      ?await sb.rpc('lkz_adm_purge_messages',{p_conversation:id,p_ids:ids})
      :await sb.rpc('lkz_adm_move_messages',{p_conversation:id,p_ids:ids,p_from:folder,p_to:destination});
    if(!page.isConnected||!user)return;
    const success=destination==='purge'?'Mensagens apagadas definitivamente.':
      destination==='deleted'?'Mensagens movidas para a Lixeira. Abra a Lixeira para restaurar ou apagar definitivamente.':
      'Mensagens movidas para '+messageFolders[destination].toLowerCase()+'.';
    const updated=await openThread(id,folder,before,error||data!==ids.length?'Não foi possível confirmar a mudança. Confira a lista e tente novamente.':success);
    if(updated?.isConnected)updated.querySelector('[role=status]')?.scrollIntoView({block:'nearest'});
  }
  buttons.forEach(button=>button.onclick=()=>{
    if(button.dataset.move!=='purge')return move(button.dataset.move);
    confirmation.querySelector('[data-confirm-text]').textContent='Apagar definitivamente '+selected().length+' mensagem(ns)?';
    confirmation.hidden=false;
    confirmation.querySelector('[data-cancel-delete]').focus();
  });
  confirmation.querySelector('[data-confirm-delete]').onclick=()=>move('purge');
  confirmation.querySelector('[data-cancel-delete]').onclick=()=>{
    confirmation.hidden=true;
    page.querySelector('[data-move="purge"]').focus();
  };
  return page;
}
function followups(){const body=state.followups.map(f=>'<tr><td><b>'+esc(f.lead)+'</b></td><td>'+esc(f.channel||'—')+'</td><td>'+esc(f.due_at?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Bahia'}).format(new Date(f.due_at)):'—')+'</td><td>'+tag(f.status)+'</td></tr>').join('');el('content').innerHTML='<div class="table"><table><thead><tr><th>Lead</th><th>Canal</th><th>Prazo</th><th>Status</th></tr></thead><tbody>'+body+'</tbody></table></div>'}
function approvals(feedback=''){
  const body=state.approvals.map(a=>{
    const action={contact:'Contato',proposal:'Proposta'}[a.action_type]||a.action_type;
    const actions=a.status==='pending'&&a.lead_id&&['contact','proposal'].includes(a.action_type)
      ?'<div class="action-row"><button class="cta" data-decision="approved">Aprovar</button><button class="cta" data-decision="rejected">Rejeitar</button></div>':'—';
    return '<tr data-approval="'+esc(a.id)+'"><td><b>'+esc(a.lead)+'</b></td><td>'+esc(action)+'</td><td>'+tag(a.status)+'</td><td>'+actions+'</td></tr>';
  }).join('');
  el('content').innerHTML='<p id="approvalFeedback" role="status">'+esc(feedback)+'</p>'+
    (body?'<div class="table"><table><thead><tr><th>Lead</th><th>Tipo</th><th>Status</th><th>Ação</th></tr></thead><tbody>'+body+'</tbody></table></div>':'<p>Nenhuma aprovação encontrada.</p>');
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
  const body=state.contacts.map(contact=>'<tr><td><b>'+esc(contact.company_name||'—')+'</b></td><td>'+esc(contact.person_name||'—')+
    '</td><td>'+esc(contact.email||'—')+'</td><td>'+esc(contact.phone||'—')+'</td></tr>').join('');
  el('content').innerHTML='<section class="panel form-panel"><h2>Novo cliente</h2><form id="clientForm" class="entry-form">'+
    '<label>Empresa <input name="company" maxlength="120"></label><label>Nome <input name="name" maxlength="120"></label>'+
    '<label>E-mail <input name="email" type="email" maxlength="254"></label><label>Telefone <input name="phone" type="tel" maxlength="32"></label>'+
    '<div class="action-row"><button class="cta">Cadastrar cliente</button><span role="status">'+esc(feedback)+'</span></div></form></section>'+
    (body?'<div class="table"><table><thead><tr><th>Empresa</th><th>Pessoa</th><th>E-mail</th><th>Telefone</th></tr></thead><tbody>'+
    body+'</tbody></table></div>':'<section class="panel">Nenhum cliente encontrado.</section>');
  const form=el('clientForm');
  let requestId=crypto.randomUUID();
  form.oninput=()=>{requestId=crypto.randomUUID()};
  form.onsubmit=async event=>{
    event.preventDefault();
    const fields=new FormData(form),status=form.querySelector('[role=status]');
    const company=fields.get('company').trim(),name=fields.get('name').trim();
    if(!company&&!name){msg(status,'Informe a empresa ou o nome.');return}
    const controls=[...form.querySelectorAll('input,button')];
    controls.forEach(control=>control.disabled=true);
    const {data,error}=await sb.rpc('lkz_adm_register_client',{p_id:requestId,p_company:company,p_name:name,
      p_email:fields.get('email').trim(),p_phone:fields.get('phone').trim()});
    if(!form.isConnected||!user)return;
    if(error||!data){
      msg(status,error?.code==='22023'?'Confira o nome e os dados de contato.':'Não foi possível confirmar o cadastro. Tente novamente.');
      controls.forEach(control=>control.disabled=false);
      return;
    }
    state.contacts=[data,...state.contacts.filter(item=>item.id!==data.id)];
    clients('Cliente cadastrado.');
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
  el('content').innerHTML='<section class="panel form-panel"><h2>Sessão</h2><form id="idleForm" class="entry-form">'+
    '<label>Encerrar após inatividade <select name="minutes">'+idleOptions.map(value=>
      '<option value="'+value+'"'+(value===idleMs/60000?' selected':'')+'>'+value+' minutos</option>'
    ).join('')+'</select></label><div class="action-row"><button class="cta">Salvar</button><span role="status"></span></div></form></section>'+
    (profile?.role==='master'?'<section id="userManagement" class="panel"><h2>Usuários e grupos de acesso</h2><p role="status">Carregando usuários…</p></section>':'');
  const form=el('idleForm');
  form.onsubmit=event=>{
    event.preventDefault();
    const value=Number(new FormData(form).get('minutes'));
    if(!idleOptions.includes(value))return;
    idleMs=value*60*1000;
    resetIdle();
    let status='Tempo de inatividade salvo neste navegador.';
    try{localStorage.setItem(idlePreference(),String(value))}catch{status='Tempo de inatividade atualizado nesta sessão.'}
    msg(form.querySelector('[role=status]'),status);
  };
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
el('search').onkeydown=e=>{if(e.key==='Enter'){const q=e.currentTarget.value.toLowerCase(),l=state.leads.find(x=>x.name.toLowerCase().includes(q));if(l){view('leads')}else alert('Nenhum lead encontrado.')}}; 
(async()=>{const {data:{user:u}}=await sb.auth.getUser();if(!u)return showLogin();try{const p=await authorize(u);if(!p){await sb.auth.signOut();return showLogin('Conta sem permissão administrativa.')}await enforceMfa(p,u)}catch(e){console.error(e);await sb.auth.signOut();showLogin('Não foi possível validar a sessão.')}})();
