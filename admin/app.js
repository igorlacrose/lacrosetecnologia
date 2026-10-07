'use strict';

const SUPABASE_URL =
  'https://icrtewhazpfauuroswri.supabase.co';

const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_6PdAW2f-dpXhsaZXI0lyBg_PcGtuWgs';


const sb =
  window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth:{
        storage:window.sessionStorage,
        persistSession:true,
        autoRefreshToken:true,
        detectSessionInUrl:false
      }
    }
  );


const authScreen =
  document.getElementById('authScreen');

const adminApp =
  document.getElementById('adminApp');

const loginForm =
  document.getElementById('loginForm');

const loginEmail =
  document.getElementById('loginEmail');

const loginPassword =
  document.getElementById('loginPassword');

const loginButton =
  document.getElementById('loginButton');

const authMessage =
  document.getElementById('authMessage');

const logoutBtn =
  document.getElementById('logoutBtn');

const adminName =
  document.getElementById('adminName');


let panelInitialized=false;

let currentProfile=null;

let currentUser=null;

let leads=[];

let currentLead=null;

let currentContact=null;

let currentConversation=null;

let currentMessages=[];

let currentEvents=[];

let currentApprovals=[];

let currentFollowups=[];



const labels={

  sistema:'Sistema sob medida',

  automacao:'Automação de processo',

  ti:'TI, rede ou segurança',

  melhoria:'Melhoria de solução existente'
};


const statusLabels={

  new:'Novo',

  diagnosing:'Em diagnóstico',

  qualified:'Qualificado',

  human_review:'Aguardando revisão',

  contacted:'Contato realizado',

  proposal:'Proposta',

  won:'Fechado',

  lost:'Perdido',

  archived:'Arquivado'
};


const priorityLabels={

  low:'Baixa',

  normal:'Normal',

  high:'Alta',

  critical:'Crítica'
};



function set(id,value){

  const el=
    document.getElementById(id);

  if(el){

    el.textContent=
      value ?? '—';
  }
}



function escapeHtml(value){

  return String(value ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}



function authStatus(
  message='',
  ok=false
){

  if(!authMessage){
    return;
  }


  authMessage.textContent=
    message;


  authMessage.classList.toggle(
    'ok',
    ok
  );
}



function setAuthBusy(busy){

  if(!loginButton){
    return;
  }


  loginButton.disabled=
    busy;


  loginButton.textContent=
    busy
      ?'Entrando…'
      :'Entrar';
}



async function authorizeUser(user){

  if(!user){
    return null;
  }


  const {
    data,
    error
  }=
    await sb
      .from('profiles')
      .select(
        'full_name,role,active'
      )
      .eq(
        'id',
        user.id
      )
      .maybeSingle();


  if(error){
    throw error;
  }


  if(
    !data ||
    data.active!==true ||
    !['master','admin'].includes(
      data.role
    )
  ){

    return null;
  }


  return data;
}



function showLogin(message=''){

  if(adminApp){
    adminApp.hidden=true;
  }


  if(authScreen){
    authScreen.hidden=false;
  }


  authStatus(
    message,
    false
  );


  if(loginPassword){
    loginPassword.value='';
  }


  setTimeout(
    ()=>loginEmail?.focus(),
    50
  );
}



async function showAdmin(profile,user){

  currentProfile=
    profile;

  currentUser=
    user;


  if(authScreen){
    authScreen.hidden=true;
  }


  if(adminApp){
    adminApp.hidden=false;
  }


  if(
    adminName &&
    profile?.full_name
  ){

    adminName.textContent=
      profile.full_name;
  }


  /*
   * Remove parâmetros legados do endereço do painel.
   */

  if(
    location.search
  ){

    history.replaceState(
      {},
      '',
      location.pathname
    );
  }


  prepareInterface();


  if(!panelInitialized){

    panelInitialized=true;

    await loadPanel();

  }else{

    await loadPanel();
  }
}



async function validateCurrentSession(){

  authStatus(
    'Verificando acesso…',
    true
  );


  const {
    data:{
      session
    },
    error
  }=
    await sb.auth.getSession();


  if(
    error ||
    !session?.user
  ){

    showLogin('');

    return;
  }


  try{

    const profile=
      await authorizeUser(
        session.user
      );


    if(!profile){

      await sb.auth.signOut();

      showLogin(
        'Esta conta não possui permissão administrativa.'
      );

      return;
    }


    await showAdmin(
      profile,
      session.user
    );


  }catch(error){

    console.error(error);


    showLogin(
      'Não foi possível validar seu acesso agora.'
    );
  }
}



loginForm?.addEventListener(
  'submit',
  async event=>{

    event.preventDefault();


    authStatus('');


    setAuthBusy(true);


    try{

      const {
        data,
        error
      }=
        await sb.auth.signInWithPassword({

          email:
            loginEmail.value.trim(),

          password:
            loginPassword.value
        });


      if(error){
        throw error;
      }


      const profile=
        await authorizeUser(
          data.user
        );


      if(!profile){

        await sb.auth.signOut();


        showLogin(
          'Usuário autenticado, mas sem permissão para acessar este painel.'
        );


        return;
      }


      await showAdmin(
        profile,
        data.user
      );


    }catch(error){

      console.error(error);


      const message=
        String(
          error?.message || ''
        )
        .toLowerCase();


      authStatus(

        message.includes(
          'invalid login credentials'
        )

          ?'E-mail ou senha inválidos.'

          :'Não foi possível entrar. Verifique seus dados e tente novamente.'
      );


    }finally{

      setAuthBusy(false);
    }
  }
);



logoutBtn?.addEventListener(
  'click',
  async()=>{

    await sb.auth.signOut();


    panelInitialized=false;

    currentProfile=null;

    currentUser=null;


    showLogin(
      'Sessão encerrada.'
    );
  }
);



sb.auth.onAuthStateChange(
  (
    event,
    session
  )=>{

    if(
      event==='SIGNED_OUT' &&
      !session
    ){

      showLogin('');
    }
  }
);



/* =========================================================
   INTERFACE
   ========================================================= */

function prepareInterface(){

  const banner=
    document.querySelector(
      '.demo-banner'
    );


  if(banner){

    banner.textContent=
      'PAINEL DE LEADS DO AGENTE · LACROSE TECNOLOGIA';
  }


  const mode=
    document.querySelector(
      '.side-bottom small'
    );


  if(mode){

    mode.textContent=
      'Operacional · Supabase';
  }


  const note=
    document.querySelector(
      '.decision .note'
    );


  if(note){

    note.textContent=
      'Ações comerciais sensíveis exigem aprovação humana e ficam registradas na auditoria.';
  }


  const auditTag=
    document.querySelector(
      '#audit .ai-tag'
    );


  if(auditTag){

    auditTag.textContent=
      'registro real';
  }


  /*
   * Localiza os botões já existentes
   * sem exigir alteração do HTML.
   */

  const decisionButtons=
    document.querySelectorAll(
      '.decision button'
    );


  if(
    decisionButtons[2] &&
    !decisionButtons[2].id
  ){

    decisionButtons[2].id=
      'whatsapp';
  }


  if(
    decisionButtons[3] &&
    !decisionButtons[3].id
  ){

    decisionButtons[3].id=
      'followup';
  }


  bindCommercialButtons();
}



/* =========================================================
   CARREGAMENTO DOS DADOS
   ========================================================= */

async function loadPanel(
  preferredLeadId=null
){

  try{

    const {
      data:leadData,
      error:leadError
    }=
      await sb
        .from('leads')
        .select('*')
        .order(
          'created_at',
          {
            ascending:false
          }
        );


    if(leadError){
      throw leadError;
    }


    leads=
      leadData || [];


    const contactIds=
      [
        ...new Set(
          leads
            .map(
              lead=>lead.contact_id
            )
            .filter(Boolean)
        )
      ];


    let contacts=[];


    if(contactIds.length){

      const {
        data,
        error
      }=
        await sb
          .from('contacts')
          .select('*')
          .in(
            'id',
            contactIds
          );


      if(error){
        throw error;
      }


      contacts=
        data || [];
    }


    const contactMap=
      new Map(
        contacts.map(
          contact=>[
            contact.id,
            contact
          ]
        )
      );


    leads=
      leads.map(
        lead=>({

          ...lead,

          contact:
            contactMap.get(
              lead.contact_id
            ) || null
        })
      );


    renderDashboard();


    let selectedId=
      preferredLeadId;


    if(
      !selectedId &&
      currentLead?.id
    ){

      selectedId=
        currentLead.id;
    }


    if(
      !selectedId &&
      leads.length
    ){

      selectedId=
        leads[0].id;
    }


    if(selectedId){

      await loadLead(
        selectedId,
        false
      );

    }else{

      clearLead();
    }


  }catch(error){

    console.error(error);


    toast(
      'Não foi possível carregar os dados do painel.'
    );
  }
}



/* =========================================================
   DASHBOARD
   ========================================================= */

async function renderDashboard(){

  const kpis=
    document.querySelectorAll(
      '.kpis article strong'
    );


  const newCount=
    leads.filter(
      lead=>
        ['new','diagnosing','human_review']
          .includes(lead.status)
    ).length;


  const qualified=
    leads.filter(
      lead=>
        lead.status==='qualified'
    ).length;


  let followupCount=0;

  let proposalCount=0;

  const activeLeadIds=
    new Set(
      leads
        .filter(
          lead=>
            !['won','lost','archived']
              .includes(lead.status)
        )
        .map(
          lead=>lead.id
        )
    );


  try{

    const [
      followupResult,
      approvalResult
    ]=
      await Promise.all([

        sb
          .from('followups')
          .select(
            'id,status'
          ),

        sb
          .from('approvals')
          .select(
            'id,lead_id,action_type,status'
          )
      ]);


    if(!followupResult.error){

      followupCount=
        (
          followupResult.data || []
        )
        .filter(
          row=>
            row.status==='pending' ||
            row.status==='approved'
        )
        .length;
    }


    if(!approvalResult.error){

      proposalCount=
        (
          approvalResult.data || []
        )
        .filter(
          row=>
            row.action_type==='proposal' &&
            ['pending','approved'].includes(row.status) &&
            activeLeadIds.has(row.lead_id)
        )
        .length;
    }


  }catch(error){

    console.warn(error);
  }


  if(kpis[0]){
    kpis[0].textContent=
      String(
        newCount
      );
  }


  if(kpis[1]){
    kpis[1].textContent=
      String(
        qualified
      );
  }


  if(kpis[2]){
    kpis[2].textContent=
      String(
        followupCount
      );
  }


  if(kpis[3]){
    kpis[3].textContent=
      String(
        proposalCount
      );
  }


  const table=
    document.querySelector(
      '.lead-table'
    );


  if(!table){
    return;
  }


  const head=
    table.querySelector(
      '.row.head'
    );


  table.innerHTML='';


  if(head){
    table.appendChild(head);
  }


  if(!leads.length){

    const empty=
      document.createElement('div');


    empty.className=
      'empty';


    empty.textContent=
      'Nenhuma oportunidade recebida ainda.';


    table.appendChild(
      empty
    );


    return;
  }


  leads.forEach(
    lead=>{

      const button=
        document.createElement(
          'button'
        );


      button.type=
        'button';


      button.className=
        'row';


      if(
        currentLead?.id===
        lead.id
      ){

        button.classList.add(
          'selected'
        );
      }


      const contact=
        lead.contact;


      const company=
        contact?.person_name ||
        contact?.company_name ||
        lead.category ||
        'Lead recebido pelo site';


      const date=
        formatDate(
          lead.created_at
        );


      const need=
        labels[lead.intent] ||
        lead.intent ||
        'Diagnóstico';


      const priority=
        priorityLabels[
          lead.priority
        ] ||
        'Normal';


      const priorityClass=
        lead.priority==='critical' ||
        lead.priority==='high'

          ?'high'

          :lead.priority==='low'

            ?'low'

            :'medium';


      button.innerHTML=`

        <span>
          <b>${escapeHtml(company)}</b>
          <small>${escapeHtml(date)} · via Agente do site</small>
        </span>

        <span>
          ${escapeHtml(need)}
        </span>

        <span>
          <i class="priority ${priorityClass}"></i>
          <span>${escapeHtml(priority)}</span>
        </span>

        <span>
          <em>${escapeHtml(statusLabels[lead.status] || lead.status || 'Novo')}</em>
        </span>
      `;


      button.addEventListener(
        'click',
        async()=>{

          await loadLead(
            lead.id,
            true
          );
        }
      );


      table.appendChild(
        button
      );
    }
  );
}



/* =========================================================
   LEAD
   ========================================================= */

async function loadLead(
  leadId,
  openView=true
){

  const lead=
    leads.find(
      item=>item.id===leadId
    );


  if(!lead){
    return;
  }


  currentLead=
    lead;


  currentContact=
    lead.contact || null;


  renderLead();


  await Promise.all([
    loadConversation(
      lead.id
    ),
    loadAudit(
      lead.id
    ),
    loadFollowups(
      lead.id
    )
  ]);


  renderDashboard();


  if(openView){

    show('lead');
  }
}



function renderLead(){

  const lead=
    currentLead;


  if(!lead){
    clearLead();

    return;
  }


  const structured=
    lead.structured_data || {};

  const contact=
    currentContact;

  const contactParts=[];


  if(contact?.person_name){
    contactParts.push(contact.person_name);
  }

  if(contact?.phone){
    contactParts.push(contact.phone);
  }

  if(contact?.email){
    contactParts.push(contact.email);
  }

  if(
    !contactParts.length &&
    structured.contact_raw
  ){
    contactParts.push(structured.contact_raw);
  }


  const impact=
    Array.isArray(lead.impact)
      ?lead.impact.join(' · ')
      :lead.impact;


  set(
    'leadBreadcrumb',
    'LEAD '+
    lead.id
      .slice(0,8)
      .toUpperCase()
  );

  set(
    'leadHeading',
    'Diagnóstico recebido pelo Agente Lacrose'
  );

  set(
    'leadSub',
    'Recebido em '+
    formatDateTime(lead.created_at)
  );

  set(
    'leadStatusTop',
    (
      statusLabels[lead.status] ||
      lead.status ||
      'Em diagnóstico'
    ).toUpperCase()
  );

  set(
    'leadScoreTop',
    String(lead.score || 0)
  );

  set(
    'fIntent',
    labels[lead.intent] ||
    lead.intent ||
    '—'
  );

  set(
    'fSegment',
    lead.category ||
    structured.segment ||
    '—'
  );

  set(
    'fScale',
    lead.scale ||
    structured.scale ||
    '—'
  );

  set(
    'fProblem',
    lead.problem ||
    '—'
  );

  set(
    'fImpact',
    impact ||
    '—'
  );

  set(
    'fUrgency',
    lead.urgency ||
    '—'
  );

  set(
    'fLocation',
    lead.location ||
    [
      contact?.city,
      contact?.state
    ]
      .filter(Boolean)
      .join('/') ||
    '—'
  );

  set(
    'fContact',
    contactParts.join(' · ') ||
    '—'
  );

  set(
    'fCurrent',
    lead.current_solution ||
    structured.current ||
    '—'
  );

  set(
    'fInvestment',
    'Negociação em contato posterior'
  );

  set(
    'fSolution',
    lead.suggested_solution ||
    structured.solution ||
    'Será definida após análise.'
  );


  const closed=
    ['won','lost','archived']
      .includes(lead.status);

  const contactApproved=
    currentApprovals.some(
      item=>
        item.action_type==='contact' &&
        item.status==='approved'
    );

  const contactCompleted=
    !!lead.contacted_at ||
    ['contacted','proposal','won','lost']
      .includes(lead.status);

  const pendingProposal=
    currentApprovals.find(
      item=>
        item.action_type==='proposal' &&
        item.status==='pending'
    );

  const approvedProposal=
    currentApprovals.find(
      item=>
        item.action_type==='proposal' &&
        item.status==='approved'
    );

  const pendingFollowups=
    currentFollowups
      .filter(
        item=>
          item.status==='pending' ||
          item.status==='approved'
      )
      .sort(
        (a,b)=>
          new Date(a.due_at || 0)-
          new Date(b.due_at || 0)
      );

  const nextFollowup=
    pendingFollowups[0] || null;


  const approve=
    document.getElementById('approve');

  if(approve){
    approve.hidden=closed;
    approve.disabled=contactApproved || closed;
    approve.textContent=
      contactApproved
        ?'Contato aprovado'
        :'Aprovar para contato';
  }


  const contactDone=
    document.getElementById('contactDone');

  if(contactDone){
    contactDone.hidden=
      closed ||
      !contactApproved ||
      contactCompleted;
  }


  const request=
    document.getElementById('request');

  if(request){
    request.hidden=closed;
    request.disabled=!contactApproved;
  }


  const whatsapp=
    document.getElementById('whatsapp');

  if(whatsapp){
    whatsapp.hidden=closed;
    whatsapp.disabled=!contactApproved;
  }


  const followup=
    document.getElementById('followup');

  if(followup){
    followup.hidden=closed;
    followup.disabled=!contactApproved;
  }


  const completeFollowup=
    document.getElementById('completeFollowup');

  if(completeFollowup){
    completeFollowup.hidden=
      closed ||
      !nextFollowup;

    completeFollowup.disabled=
      !nextFollowup;

    completeFollowup.textContent=
      nextFollowup?.due_at
        ?'Concluir follow-up · '+
          formatDateTime(nextFollowup.due_at)
        :'Concluir follow-up';
  }


  const prepareProposal=
    document.getElementById('prepareProposal');

  if(prepareProposal){
    prepareProposal.hidden=closed;
    prepareProposal.disabled=
      !contactCompleted ||
      !!approvedProposal;

    prepareProposal.textContent=
      approvedProposal
        ?'Proposta aprovada'
        :pendingProposal
          ?'Atualizar proposta'
          :'Preparar proposta';
  }


  const approveProposal=
    document.getElementById('approveProposal');

  if(approveProposal){
    approveProposal.hidden=closed;
    approveProposal.disabled=
      !pendingProposal ||
      !!approvedProposal;

    approveProposal.textContent=
      approvedProposal
        ?'Proposta aprovada'
        :'Aprovar proposta';
  }


  const markWon=
    document.getElementById('markWon');

  if(markWon){
    markWon.hidden=
      closed ||
      !approvedProposal;
  }


  const markLost=
    document.getElementById('markLost');

  if(markLost){
    markLost.hidden=
      closed ||
      !contactApproved;
  }


  const reopenLead=
    document.getElementById('reopenLead');

  if(reopenLead){
    reopenLead.hidden=!closed;
  }


  const followupSummary=
    document.getElementById('followupSummary');

  if(followupSummary){

    if(closed){

      followupSummary.textContent=
        'Ciclo encerrado'+
        (
          lead.closed_at
            ?' em '+formatDateTime(lead.closed_at)
            :''
        )+
        '.';

    }else if(nextFollowup){

      followupSummary.textContent=
        'Próximo follow-up: '+
        (
          nextFollowup.due_at
            ?formatDateTime(nextFollowup.due_at)
            :'sem data'
        )+
        ' · '+
        (
          nextFollowup.channel ||
          'canal não definido'
        )+
        '.';

    }else{

      followupSummary.textContent=
        'Nenhum follow-up pendente.';
    }
  }


  const guardTitle=
    document.getElementById('decisionGuardTitle');

  const guardText=
    document.getElementById('decisionGuardText');


  if(
    guardTitle &&
    guardText
  ){

    if(lead.status==='won'){

      guardTitle.textContent=
        'Negócio fechado';

      guardText.textContent=
        [
          lead.closed_value,
          lead.closed_at
            ?formatDateTime(lead.closed_at)
            :''
        ]
          .filter(Boolean)
          .join(' · ') ||
        'Oportunidade concluída com sucesso.';

    }else if(lead.status==='lost'){

      guardTitle.textContent=
        'Oportunidade perdida';

      guardText.textContent=
        lead.lost_reason ||
        'Oportunidade encerrada sem fechamento.';

    }else if(approvedProposal){

      const payload=
        approvedProposal.action_payload || {};

      guardTitle.textContent=
        'Proposta aprovada';

      guardText.textContent=
        [
          payload.value,
          payload.summary
        ]
          .filter(Boolean)
          .join(' · ') ||
        'Proposta liberada para continuidade comercial.';

    }else if(pendingProposal){

      const payload=
        pendingProposal.action_payload || {};

      guardTitle.textContent=
        'Proposta aguardando aprovação';

      guardText.textContent=
        [
          payload.value,
          payload.summary
        ]
          .filter(Boolean)
          .join(' · ') ||
        'Revise a proposta antes de aprovar.';

    }else if(contactCompleted){

      guardTitle.textContent=
        'Contato realizado';

      guardText.textContent=
        lead.contacted_at
          ?'Contato registrado em '+
            formatDateTime(lead.contacted_at)+
            '.'
          :'O atendimento comercial já foi iniciado.';

    }else if(contactApproved){

      guardTitle.textContent=
        'Contato aprovado';

      guardText.textContent=
        'Registre o contato quando o atendimento com o lead for realizado.';

    }else{

      guardTitle.textContent=
        'Aguardando análise';

      guardText.textContent=
        'Revise os dados do lead antes de executar ações comerciais.';
    }
  }


  renderActivity();
}


function clearLead(){

  currentLead=null;

  currentContact=null;

  currentConversation=null;

  currentMessages=[];

  currentEvents=[];

  currentApprovals=[];

  currentFollowups=[];


  [
    'fIntent',
    'fSegment',
    'fScale',
    'fProblem',
    'fImpact',
    'fUrgency',
    'fLocation',
    'fContact',
    'fCurrent',
    'fSolution'
  ]
  .forEach(
    id=>set(
      id,
      '—'
    )
  );


  set(
    'leadScoreTop',
    '0'
  );


  set(
    'leadStatusTop',
    'SEM LEAD'
  );


  renderConversation();

  renderAudit();

  renderActivity();
}



/* =========================================================
   CONVERSA
   ========================================================= */

async function loadConversation(
  leadId
){

  const {
    data,
    error
  }=
    await sb
      .from('conversations')
      .select(
        'id,lead_id,status,started_at,last_message_at,completed_at'
      )
      .eq(
        'lead_id',
        leadId
      )
      .order(
        'started_at',
        {
          ascending:false
        }
      )
      .limit(1);


  if(error){
    throw error;
  }


  currentConversation=
    data?.[0] || null;


  currentMessages=[];


  if(
    currentConversation
  ){

    const {
      data:messages,
      error:messageError
    }=
      await sb
        .from('messages')
        .select(
          'id,role,content,created_at'
        )
        .eq(
          'conversation_id',
          currentConversation.id
        )
        .order(
          'id',
          {
            ascending:true
          }
        );


    if(messageError){
      throw messageError;
    }


    currentMessages=
      messages || [];
  }


  renderConversation();
}



function renderConversation(){

  const box=
    document.getElementById(
      'conversationList'
    );


  if(!box){
    return;
  }


  box.innerHTML='';


  if(
    !currentMessages.length
  ){

    box.innerHTML=
      '<div class="empty">Nenhuma mensagem registrada para esta oportunidade.</div>';


    return;
  }


  currentMessages.forEach(
    message=>{

      const div=
        document.createElement(
          'div'
        );


      const isUser=
        message.role==='user';


      div.className=
        'conv '+
        (
          isUser
            ?'user'
            :'agent'
        );


      const span=
        document.createElement(
          'span'
        );


      span.textContent=
        message.content;


      div.appendChild(
        span
      );


      const small=
        document.createElement(
          'small'
        );


      small.textContent=
        isUser
          ?'Visitante'
          :'Agente Lacrose';


      div.appendChild(
        small
      );


      box.appendChild(
        div
      );
    }
  );
}



/* =========================================================
   FOLLOW-UPS
   ========================================================= */

async function loadFollowups(
  leadId
){

  const {
    data,
    error
  }=
    await sb
      .from('followups')
      .select('*')
      .eq(
        'lead_id',
        leadId
      )
      .order(
        'due_at',
        {
          ascending:true,
          nullsFirst:false
        }
      );


  if(error){
    throw error;
  }


  currentFollowups=
    data || [];


  renderLead();
  renderActivity();
}



/* =========================================================
   AUDITORIA
   ========================================================= */

async function loadAudit(
  leadId
){

  const [
    eventsResult,
    approvalsResult
  ]=
    await Promise.all([

      sb
        .from('lead_events')
        .select('*')
        .eq(
          'lead_id',
          leadId
        )
        .order(
          'created_at',
          {
            ascending:false
          }
        ),

      sb
        .from('approvals')
        .select('*')
        .eq(
          'lead_id',
          leadId
        )
        .order(
          'requested_at',
          {
            ascending:false
          }
        )
    ]);


  if(eventsResult.error){
    throw eventsResult.error;
  }


  if(approvalsResult.error){
    throw approvalsResult.error;
  }


  currentEvents=
    eventsResult.data || [];


  currentApprovals=
    approvalsResult.data || [];


  renderAudit();

  renderLead();
}



function renderAudit(){

  const box=
    document.getElementById(
      'auditList'
    );


  if(!box){
    return;
  }


  box.innerHTML='';


  const rows=[];


  currentEvents.forEach(
    event=>{

      rows.push({

        date:event.created_at,

        title:eventTitle(
          event.event_type
        ),

        description:
          event.note ||
          'Evento registrado.',

        code:event.event_type
      });
    }
  );


  currentApprovals.forEach(
    approval=>{

      rows.push({

        date:
          approval.decided_at ||
          approval.requested_at,

        title:
          approval.status==='approved'
            ?'Aprovação humana registrada'
            :'Aprovação pendente',

        description:
          approval.decision_note ||
          (
            approval.action_type==='contact'
              ?'Autorização para contato comercial.'
              :'Ação comercial registrada.'
          ),

        code:
          'approval.'+
          approval.action_type+
          '.'+
          approval.status
      });
    }
  );


  rows.sort(
    (
      a,
      b
    )=>
      new Date(b.date)-
      new Date(a.date)
  );


  if(!rows.length){

    box.innerHTML=
      '<div class="empty">Nenhum evento registrado.</div>';


    return;
  }


  rows.forEach(
    item=>{

      const row=
        document.createElement(
          'div'
        );


      const time=
        document.createElement(
          'time'
        );


      time.textContent=
        formatDateTime(
          item.date
        );


      const p=
        document.createElement(
          'p'
        );


      const b=
        document.createElement(
          'b'
        );


      b.textContent=
        item.title;


      const span=
        document.createElement(
          'span'
        );


      span.textContent=
        item.description;


      p.append(
        b,
        span
      );


      const code=
        document.createElement(
          'code'
        );


      code.textContent=
        item.code;


      row.append(
        time,
        p,
        code
      );


      box.appendChild(
        row
      );
    }
  );
}



function eventTitle(type){

  const titles={

    'agent.diagnosis.completed':
      'Diagnóstico concluído',

    'approval.contact.granted':
      'Contato aprovado',

    'information.requested':
      'Mais informações solicitadas',

    'followup.created':
      'Follow-up criado',

    'whatsapp.prepared':
      'Mensagem de WhatsApp preparada',

    'proposal.prepared':
      'Proposta preparada',

    'proposal.approved':
      'Proposta aprovada',

    'contact.completed':
      'Contato realizado',

    'followup.completed':
      'Follow-up concluído',

    'deal.won':
      'Negócio fechado',

    'deal.lost':
      'Oportunidade perdida',

    'deal.reopened':
      'Oportunidade reaberta'
  };


  return titles[type] ||
    type ||
    'Evento registrado';
}



function renderActivity(){

  const list=
    document.getElementById('nextActions');


  if(!list){
    return;
  }


  list.innerHTML='';


  if(!currentLead){

    list.innerHTML=
      '<li><b>Nenhuma oportunidade selecionada</b><span>Selecione um lead para ver os próximos passos.</span></li>';

    return;
  }


  const lead=
    currentLead;

  const contactApproved=
    currentApprovals.some(
      item=>
        item.action_type==='contact' &&
        item.status==='approved'
    );

  const contactCompleted=
    !!lead.contacted_at ||
    ['contacted','proposal','won','lost']
      .includes(lead.status);

  const pendingProposal=
    currentApprovals.some(
      item=>
        item.action_type==='proposal' &&
        item.status==='pending'
    );

  const approvedProposal=
    currentApprovals.some(
      item=>
        item.action_type==='proposal' &&
        item.status==='approved'
    );

  const pendingFollowup=
    currentFollowups
      .filter(
        item=>
          item.status==='pending' ||
          item.status==='approved'
      )
      .sort(
        (a,b)=>
          new Date(a.due_at || 0)-
          new Date(b.due_at || 0)
      )[0];


  const items=[];


  if(lead.status==='won'){

    items.push([
      'Negócio fechado',
      lead.closed_at
        ?'Encerrado em '+formatDateTime(lead.closed_at)
        :'Ciclo comercial concluído'
    ]);

  }else if(lead.status==='lost'){

    items.push([
      'Oportunidade encerrada',
      lead.lost_reason ||
      'Lead marcado como perdido'
    ]);

  }else{

    if(!contactApproved){

      items.push([
        'Revisar e aprovar contato',
        'Valide o diagnóstico antes de iniciar o atendimento'
      ]);

    }else if(!contactCompleted){

      items.push([
        'Realizar contato',
        'Após falar com o lead, registre o contato no painel'
      ]);
    }


    if(pendingFollowup){

      items.push([
        'Executar follow-up',
        pendingFollowup.due_at
          ?formatDateTime(pendingFollowup.due_at)
          :'Follow-up pendente'
      ]);
    }


    if(
      contactCompleted &&
      !pendingProposal &&
      !approvedProposal
    ){

      items.push([
        'Preparar proposta',
        'Defina escopo e condição comercial'
      ]);
    }


    if(pendingProposal){

      items.push([
        'Aprovar proposta',
        'Revise a proposta preparada antes de avançar'
      ]);
    }


    if(approvedProposal){

      items.push([
        'Acompanhar decisão do cliente',
        'Crie follow-up ou finalize como fechado/perdido'
      ]);
    }
  }


  items
    .slice(0,3)
    .forEach(
      ([title,description])=>{

        const li=
          document.createElement('li');

        const b=
          document.createElement('b');

        const span=
          document.createElement('span');

        b.textContent=title;
        span.textContent=description;

        li.append(
          b,
          span
        );

        list.appendChild(li);
      }
    );
}



/* =========================================================
   AÇÕES COMERCIAIS
   ========================================================= */

function bindCommercialButtons(){

  const bindings=[
    ['approve',approveContact],
    ['contactDone',markContactCompleted],
    ['request',requestMoreInformation],
    ['whatsapp',prepareWhatsApp],
    ['followup',createFollowup],
    ['completeFollowup',completeFollowup],
    ['prepareProposal',prepareCommercialProposal],
    ['approveProposal',approveCommercialProposal],
    ['markWon',markLeadWon],
    ['markLost',markLeadLost],
    ['reopenLead',reopenLead]
  ];


  bindings.forEach(
    ([id,handler])=>{

      const button=
        document.getElementById(id);


      if(
        button &&
        !button.dataset.bound
      ){

        button.dataset.bound='1';

        button.addEventListener(
          'click',
          handler
        );
      }
    }
  );
}


async function approveContact(){

  if(!currentLead){

    toast(
      'Selecione uma oportunidade.'
    );

    return;
  }


  try{

    const {
      data:existing,
      error:existingError
    }=
      await sb
        .from('approvals')
        .select('id')
        .eq(
          'lead_id',
          currentLead.id
        )
        .eq(
          'action_type',
          'contact'
        )
        .eq(
          'status',
          'approved'
        )
        .limit(1);


    if(existingError){
      throw existingError;
    }


    if(existing?.length){

      toast(
        'Este contato já foi aprovado.'
      );

      return;
    }


    const now=
      new Date().toISOString();


    const {
      error:approvalError
    }=
      await sb
        .from('approvals')
        .insert({

          lead_id:
            currentLead.id,

          action_type:
            'contact',

          action_payload:{
            source:
              'commercial_panel'
          },

          status:
            'approved',

          decided_at:
            now,

          decided_by:
            currentUser.id,

          decision_note:
            'Contato comercial autorizado pelo administrador.'
        });


    if(approvalError){
      throw approvalError;
    }


    const {
      error:leadError
    }=
      await sb
        .from('leads')
        .update({

          status:
            'qualified',

          needs_human_review:
            false,

          updated_at:
            now
        })
        .eq(
          'id',
          currentLead.id
        );


    if(leadError){
      throw leadError;
    }


    const {
      error:eventError
    }=
      await sb
        .from('lead_events')
        .insert({

          lead_id:
            currentLead.id,

          event_type:
            'approval.contact.granted',

          actor_type:
            'admin',

          actor_id:
            currentUser.id,

          note:
            'Administrador autorizou o contato comercial com o lead.'
        });


    if(eventError){
      throw eventError;
    }


    toast(
      'Contato aprovado e registrado.'
    );


    await loadPanel(
      currentLead.id
    );


  }catch(error){

    console.error(error);


    toast(
      'Não foi possível aprovar o contato.'
    );
  }
}



async function markContactCompleted(){

  if(!currentLead){
    toast('Selecione uma oportunidade.');
    return;
  }


  const contactApproved=
    currentApprovals.some(
      item=>
        item.action_type==='contact' &&
        item.status==='approved'
    );


  if(!contactApproved){
    toast('Aprove o contato antes de registrar o atendimento.');
    return;
  }


  try{

    const now=
      new Date().toISOString();


    const {
      error:leadError
    }=
      await sb
        .from('leads')
        .update({
          status:'contacted',
          contacted_at:now,
          updated_at:now
        })
        .eq(
          'id',
          currentLead.id
        );


    if(leadError){
      throw leadError;
    }


    const {
      error:eventError
    }=
      await sb
        .from('lead_events')
        .insert({
          lead_id:currentLead.id,
          event_type:'contact.completed',
          actor_type:'admin',
          actor_id:currentUser.id,
          after_data:{
            status:'contacted',
            contacted_at:now
          },
          note:'Contato comercial realizado e registrado pelo administrador.'
        });


    if(eventError){
      throw eventError;
    }


    toast('Contato realizado e registrado.');

    await loadPanel(
      currentLead.id
    );


  }catch(error){

    console.error(error);

    toast('Não foi possível registrar o contato realizado.');
  }
}



async function requestMoreInformation(){

  if(!currentLead){

    toast(
      'Selecione uma oportunidade.'
    );

    return;
  }


  const name=
    currentContact?.person_name ||
    'tudo bem';

  const phone=
    normalizePhone(
      currentContact?.phone ||
      currentLead.structured_data?.contact_phone ||
      currentLead.structured_data?.contact_raw ||
      ''
    );

  const email=
    currentContact?.email ||
    extractEmail(
      currentLead.structured_data?.contact_raw ||
      ''
    );

  const message=
    `Olá, ${name}! Aqui é Igor Lacrose, da Lacrose Tecnologia. Analisei o diagnóstico enviado pelo nosso site e preciso de algumas informações adicionais para dar continuidade ao atendimento. Quando puder, me responda por aqui.`;


  if(phone){

    window.open(
      'https://wa.me/'+
      phone+
      '?text='+
      encodeURIComponent(message),
      '_blank',
      'noopener'
    );

  }else if(email){

    window.location.href=
      'mailto:'+
      encodeURIComponent(email)+
      '?subject='+
      encodeURIComponent('Continuidade do diagnóstico · Lacrose Tecnologia')+
      '&body='+
      encodeURIComponent(message);

  }else{

    toast(
      'Este lead não possui telefone ou e-mail identificável.'
    );

    return;
  }


  try{

    const {
      error
    }=
      await sb
        .from('lead_events')
        .insert({

          lead_id:
            currentLead.id,

          event_type:
            'information.requested',

          actor_type:
            'admin',

          actor_id:
            currentUser.id,

          note:
            'Solicitação de informações adicionais preparada pelo administrador.'
        });


    if(error){
      throw error;
    }


    toast(
      'Solicitação preparada e registrada.'
    );


    await loadAudit(
      currentLead.id
    );


  }catch(error){

    console.error(error);

    toast(
      'A mensagem foi preparada, mas o registro da ação falhou.'
    );
  }
}



async function prepareWhatsApp(){

  if(!currentLead){

    toast(
      'Selecione uma oportunidade.'
    );

    return;
  }


  const phone=
    normalizePhone(
      currentContact?.phone ||
      currentLead.structured_data?.contact_phone ||
      currentLead.structured_data?.contact_raw ||
      ''
    );


  if(!phone){

    toast(
      'Este lead não possui um WhatsApp identificável.'
    );

    return;
  }


  const name=
    currentContact?.person_name ||
    'tudo bem';


  const message=
    `Olá, ${name}! Aqui é Igor Lacrose, da Lacrose Tecnologia. Recebi o diagnóstico enviado pelo nosso site e estou entrando em contato para dar continuidade ao atendimento.`;


  window.open(
    'https://wa.me/'+
    phone+
    '?text='+
    encodeURIComponent(message),
    '_blank',
    'noopener'
  );


  try{

    const {
      error
    }=
      await sb
        .from('lead_events')
        .insert({

          lead_id:
            currentLead.id,

          event_type:
            'whatsapp.prepared',

          actor_type:
            'admin',

          actor_id:
            currentUser.id,

          note:
            'Mensagem de WhatsApp preparada para continuidade do atendimento.'
        });


    if(error){
      throw error;
    }


    await loadAudit(
      currentLead.id
    );


  }catch(error){

    console.error(error);
  }
}



async function createFollowup(){

  if(!currentLead){

    toast(
      'Selecione uma oportunidade.'
    );

    return;
  }


  const defaultDate=
    defaultFollowupValue();


  const value=
    window.prompt(
      'Data e hora do follow-up (AAAA-MM-DD HH:MM):',
      defaultDate
    );


  if(value===null){
    return;
  }


  const dueAt=
    parseLocalDateTime(
      value
    );


  if(!dueAt){

    toast(
      'Data inválida. Use o formato AAAA-MM-DD HH:MM.'
    );

    return;
  }


  try{

    const {
      error
    }=
      await sb
        .from('followups')
        .insert({

          lead_id:
            currentLead.id,

          channel:
            currentContact?.phone
              ?'whatsapp'
              :currentContact?.email
                ?'email'
                :'other',

          due_at:
            dueAt,

          status:
            'pending',

          draft_message:
            'Dar continuidade ao atendimento comercial deste lead.'
        });


    if(error){
      throw error;
    }


    const {
      error:eventError
    }=
      await sb
        .from('lead_events')
        .insert({

          lead_id:
            currentLead.id,

          event_type:
            'followup.created',

          actor_type:
            'admin',

          actor_id:
            currentUser.id,

          note:
            'Follow-up comercial criado para '+
            formatDateTime(dueAt)+
            '.'
        });


    if(eventError){
      throw eventError;
    }


    toast(
      'Follow-up criado.'
    );


    await loadPanel(
      currentLead.id
    );


  }catch(error){

    console.error(error);


    toast(
      'Não foi possível criar o follow-up.'
    );
  }
}



async function completeFollowup(){

  if(!currentLead){
    toast('Selecione uma oportunidade.');
    return;
  }


  const pending=
    currentFollowups
      .filter(
        item=>
          item.status==='pending' ||
          item.status==='approved'
      )
      .sort(
        (a,b)=>
          new Date(a.due_at || 0)-
          new Date(b.due_at || 0)
      )[0];


  if(!pending){
    toast('Não há follow-up pendente para concluir.');
    return;
  }


  try{

    const {
      error:followupError
    }=
      await sb
        .from('followups')
        .update({
          status:'done'
        })
        .eq(
          'id',
          pending.id
        );


    if(followupError){
      throw followupError;
    }


    const {
      error:eventError
    }=
      await sb
        .from('lead_events')
        .insert({
          lead_id:currentLead.id,
          event_type:'followup.completed',
          actor_type:'admin',
          actor_id:currentUser.id,
          after_data:{
            followup_id:pending.id,
            status:'done'
          },
          note:'Follow-up comercial concluído pelo administrador.'
        });


    if(eventError){
      throw eventError;
    }


    toast('Follow-up concluído.');

    await loadPanel(
      currentLead.id
    );


  }catch(error){

    console.error(error);

    toast('Não foi possível concluir o follow-up.');
  }
}



async function prepareCommercialProposal(){

  if(!currentLead){

    toast(
      'Selecione uma oportunidade.'
    );

    return;
  }


  const contactCompleted=
    !!currentLead.contacted_at ||
    ['contacted','proposal']
      .includes(currentLead.status);


  if(!contactCompleted){

    toast(
      'Registre o contato realizado antes de preparar a proposta.'
    );

    return;
  }


  const existing=
    currentApprovals.find(
      item=>
        item.action_type==='proposal' &&
        item.status==='pending'
    );


  const existingPayload=
    existing?.action_payload || {};


  const summary=
    window.prompt(
      'Resumo da proposta / escopo:',
      existingPayload.summary ||
      currentLead.suggested_solution ||
      ''
    );


  if(summary===null){
    return;
  }


  const cleanSummary=
    summary.trim();


  if(!cleanSummary){

    toast(
      'Informe um resumo para a proposta.'
    );

    return;
  }


  const value=
    window.prompt(
      'Valor ou condição comercial:',
      existingPayload.value || ''
    );


  if(value===null){
    return;
  }


  try{

    if(existing){

      const {
        error
      }=
        await sb
          .from('approvals')
          .update({

            action_payload:{
              summary:cleanSummary,
              value:value.trim(),
              source:'commercial_panel'
            },

            requested_at:
              new Date().toISOString(),

            decision_note:
              null
          })
          .eq(
            'id',
            existing.id
          );


      if(error){
        throw error;
      }


    }else{

      const {
        error
      }=
        await sb
          .from('approvals')
          .insert({

            lead_id:
              currentLead.id,

            action_type:
              'proposal',

            action_payload:{
              summary:cleanSummary,
              value:value.trim(),
              source:'commercial_panel'
            },

            status:
              'pending'
          });


      if(error){
        throw error;
      }
    }


    const {
      error:eventError
    }=
      await sb
        .from('lead_events')
        .insert({

          lead_id:
            currentLead.id,

          event_type:
            'proposal.prepared',

          actor_type:
            'admin',

          actor_id:
            currentUser.id,

          note:
            existing
              ?'Proposta comercial atualizada e enviada para aprovação interna.'
              :'Proposta comercial preparada e enviada para aprovação interna.'
        });


    if(eventError){
      throw eventError;
    }


    const {
      error:leadUpdateError
    }=
      await sb
        .from('leads')
        .update({
          proposal_at:new Date().toISOString(),
          updated_at:new Date().toISOString()
        })
        .eq(
          'id',
          currentLead.id
        );


    if(leadUpdateError){
      throw leadUpdateError;
    }


    toast(
      existing
        ?'Proposta atualizada.'
        :'Proposta preparada.'
    );


    await loadPanel(
      currentLead.id
    );


  }catch(error){

    console.error(error);


    toast(
      'Não foi possível preparar a proposta.'
    );
  }
}



async function approveCommercialProposal(){

  if(!currentLead){

    toast(
      'Selecione uma oportunidade.'
    );

    return;
  }


  const proposal=
    currentApprovals.find(
      item=>
        item.action_type==='proposal' &&
        item.status==='pending'
    );


  if(!proposal){

    toast(
      'Prepare uma proposta antes de aprová-la.'
    );

    return;
  }


  try{

    const now=
      new Date().toISOString();


    const {
      error:approvalError
    }=
      await sb
        .from('approvals')
        .update({

          status:
            'approved',

          decided_at:
            now,

          decided_by:
            currentUser.id,

          decision_note:
            'Proposta comercial aprovada pelo administrador.'
        })
        .eq(
          'id',
          proposal.id
        );


    if(approvalError){
      throw approvalError;
    }


    const {
      error:leadError
    }=
      await sb
        .from('leads')
        .update({

          status:
            'proposal',

          proposal_at:
            now,

          needs_human_review:
            false,

          updated_at:
            now
        })
        .eq(
          'id',
          currentLead.id
        );


    if(leadError){
      throw leadError;
    }


    const {
      error:eventError
    }=
      await sb
        .from('lead_events')
        .insert({

          lead_id:
            currentLead.id,

          event_type:
            'proposal.approved',

          actor_type:
            'admin',

          actor_id:
            currentUser.id,

          note:
            'Proposta comercial aprovada pelo administrador.'
        });


    if(eventError){
      throw eventError;
    }


    toast(
      'Proposta aprovada e registrada.'
    );


    await loadPanel(
      currentLead.id
    );


  }catch(error){

    console.error(error);


    toast(
      'Não foi possível aprovar a proposta.'
    );
  }
}



async function markLeadWon(){

  if(!currentLead){
    toast('Selecione uma oportunidade.');
    return;
  }


  const approvedProposal=
    currentApprovals.find(
      item=>
        item.action_type==='proposal' &&
        item.status==='approved'
    );


  if(!approvedProposal){
    toast('Aprove a proposta antes de marcar o negócio como fechado.');
    return;
  }


  const defaultValue=
    approvedProposal.action_payload?.value || '';

  const value=
    window.prompt(
      'Valor final do fechamento (opcional):',
      defaultValue
    );


  if(value===null){
    return;
  }


  try{

    const now=
      new Date().toISOString();


    const {
      error:leadError
    }=
      await sb
        .from('leads')
        .update({
          status:'won',
          closed_at:now,
          closed_value:value.trim() || null,
          lost_reason:null,
          needs_human_review:false,
          updated_at:now
        })
        .eq(
          'id',
          currentLead.id
        );


    if(leadError){
      throw leadError;
    }


    const {
      error:followupError
    }=
      await sb
        .from('followups')
        .update({
          status:'cancelled'
        })
        .eq(
          'lead_id',
          currentLead.id
        )
        .in(
          'status',
          ['pending','approved']
        );


    if(followupError){
      throw followupError;
    }


    const {
      error:eventError
    }=
      await sb
        .from('lead_events')
        .insert({
          lead_id:currentLead.id,
          event_type:'deal.won',
          actor_type:'admin',
          actor_id:currentUser.id,
          after_data:{
            status:'won',
            closed_at:now,
            closed_value:value.trim() || null
          },
          note:
            value.trim()
              ?'Negócio fechado. Valor registrado: '+value.trim()+'.'
              :'Negócio fechado pelo administrador.'
        });


    if(eventError){
      throw eventError;
    }


    toast('Negócio marcado como fechado.');

    await loadPanel(
      currentLead.id
    );


  }catch(error){

    console.error(error);

    toast('Não foi possível concluir o fechamento.');
  }
}



async function markLeadLost(){

  if(!currentLead){
    toast('Selecione uma oportunidade.');
    return;
  }


  const reason=
    window.prompt(
      'Motivo da perda da oportunidade:',
      currentLead.lost_reason || ''
    );


  if(reason===null){
    return;
  }


  const cleanReason=
    reason.trim();


  if(!cleanReason){
    toast('Informe o motivo da perda.');
    return;
  }


  try{

    const now=
      new Date().toISOString();


    const {
      error:leadError
    }=
      await sb
        .from('leads')
        .update({
          status:'lost',
          closed_at:now,
          closed_value:null,
          lost_reason:cleanReason,
          needs_human_review:false,
          updated_at:now
        })
        .eq(
          'id',
          currentLead.id
        );


    if(leadError){
      throw leadError;
    }


    const {
      error:followupError
    }=
      await sb
        .from('followups')
        .update({
          status:'cancelled'
        })
        .eq(
          'lead_id',
          currentLead.id
        )
        .in(
          'status',
          ['pending','approved']
        );


    if(followupError){
      throw followupError;
    }


    const {
      error:eventError
    }=
      await sb
        .from('lead_events')
        .insert({
          lead_id:currentLead.id,
          event_type:'deal.lost',
          actor_type:'admin',
          actor_id:currentUser.id,
          after_data:{
            status:'lost',
            closed_at:now,
            lost_reason:cleanReason
          },
          note:'Oportunidade encerrada como perdida. Motivo: '+cleanReason+'.'
        });


    if(eventError){
      throw eventError;
    }


    toast('Oportunidade marcada como perdida.');

    await loadPanel(
      currentLead.id
    );


  }catch(error){

    console.error(error);

    toast('Não foi possível encerrar a oportunidade.');
  }
}



async function reopenLead(){

  if(!currentLead){
    toast('Selecione uma oportunidade.');
    return;
  }


  if(
    !['won','lost','archived']
      .includes(currentLead.status)
  ){
    return;
  }


  if(
    !window.confirm(
      'Reabrir esta oportunidade comercial?'
    )
  ){
    return;
  }


  const approvedProposal=
    currentApprovals.some(
      item=>
        item.action_type==='proposal' &&
        item.status==='approved'
    );

  const nextStatus=
    approvedProposal
      ?'proposal'
      :currentLead.contacted_at
        ?'contacted'
        :'qualified';


  try{

    const now=
      new Date().toISOString();


    const {
      error:leadError
    }=
      await sb
        .from('leads')
        .update({
          status:nextStatus,
          closed_at:null,
          closed_value:null,
          lost_reason:null,
          updated_at:now
        })
        .eq(
          'id',
          currentLead.id
        );


    if(leadError){
      throw leadError;
    }


    const {
      error:eventError
    }=
      await sb
        .from('lead_events')
        .insert({
          lead_id:currentLead.id,
          event_type:'deal.reopened',
          actor_type:'admin',
          actor_id:currentUser.id,
          after_data:{
            status:nextStatus
          },
          note:'Oportunidade comercial reaberta pelo administrador.'
        });


    if(eventError){
      throw eventError;
    }


    toast('Oportunidade reaberta.');

    await loadPanel(
      currentLead.id
    );


  }catch(error){

    console.error(error);

    toast('Não foi possível reabrir a oportunidade.');
  }
}



function normalizePhone(raw){

  const source=
    String(raw || '')
      .replace(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig,
        ' '
      );


  const candidates=
    source.match(
      /(?:\+?\d[\d\s().\-\/]{7,}\d)/g
    ) || [];


  for(
    const candidate
    of candidates
  ){

    let phone=
      candidate.replace(/\D/g,'');


    if(
      phone.startsWith('00') &&
      phone.length>11
    ){

      phone=
        phone.slice(2);
    }


    if(
      phone.startsWith('0') &&
      (
        phone.length===11 ||
        phone.length===12
      )
    ){

      phone=
        phone.slice(1);
    }


    if(
      phone.length===10 ||
      phone.length===11
    ){

      return'55'+phone;
    }


    if(
      phone.startsWith('55') &&
      (
        phone.length===12 ||
        phone.length===13
      )
    ){

      return phone;
    }


    if(
      candidate.trim().startsWith('+') &&
      phone.length>=10 &&
      phone.length<=15
    ){

      return phone;
    }
  }


  return'';
}



function extractEmail(raw){

  const match=
    String(raw || '')
      .match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
      );


  return match?.[0] || '';
}



function defaultFollowupValue(){

  const date=
    new Date();


  date.setDate(
    date.getDate()+1
  );


  date.setHours(
    9,
    0,
    0,
    0
  );


  const pad=
    value=>
      String(value)
        .padStart(2,'0');


  return (
    date.getFullYear()+
    '-'+
    pad(date.getMonth()+1)+
    '-'+
    pad(date.getDate())+
    ' '+
    pad(date.getHours())+
    ':'+
    pad(date.getMinutes())
  );
}



function parseLocalDateTime(value){

  const match=
    String(value || '')
      .trim()
      .match(
        /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/
      );


  if(!match){
    return'';
  }


  const [
    ,
    year,
    month,
    day,
    hour,
    minute
  ]=
    match;


  const date=
    new Date(
      Number(year),
      Number(month)-1,
      Number(day),
      Number(hour),
      Number(minute),
      0,
      0
    );


  if(
    Number.isNaN(
      date.getTime()
    )
  ){

    return'';
  }


  return date.toISOString();
}



/* =========================================================
   NAVEGAÇÃO
   ========================================================= */

const titles={

  dashboard:
    'Visão geral',

  lead:
    'Oportunidade',

  conversation:
    'Conversa',

  audit:
    'Auditoria'
};


function show(id){

  document
    .querySelectorAll(
      '.view'
    )
    .forEach(
      view=>
        view.classList.toggle(
          'active',
          view.id===id
        )
    );


  document
    .querySelectorAll(
      '.sidebar nav button'
    )
    .forEach(
      button=>
        button.classList.toggle(
          'active',
          button.dataset.view===id
        )
    );


  set(
    'pageTitle',
    titles[id] ||
    'Painel'
  );
}



document
  .querySelectorAll(
    '[data-view]'
  )
  .forEach(
    button=>
      button.addEventListener(
        'click',
        ()=>show(
          button.dataset.view
        )
      )
  );



document
  .querySelectorAll(
    '[data-view-jump]'
  )
  .forEach(
    button=>
      button.addEventListener(
        'click',
        ()=>{

          if(
            currentLead
          ){

            show(
              button.dataset.viewJump
            );

          }else{

            toast(
              'Nenhuma oportunidade disponível.'
            );
          }
        }
      )
  );



/* =========================================================
   UTILIDADES
   ========================================================= */

function toast(text){

  const element=
    document.getElementById(
      'toast'
    );


  if(!element){
    return;
  }


  element.textContent=
    text;


  element.classList.add(
    'show'
  );


  setTimeout(
    ()=>element.classList.remove(
      'show'
    ),
    2800
  );
}



function formatDate(value){

  if(!value){
    return'—';
  }


  const date=
    new Date(value);


  return new Intl.DateTimeFormat(
    'pt-BR',
    {
      day:'2-digit',
      month:'2-digit',
      year:'numeric'
    }
  )
  .format(date);
}



function formatDateTime(value){

  if(!value){
    return'—';
  }


  const date=
    new Date(value);


  return new Intl.DateTimeFormat(
    'pt-BR',
    {
      day:'2-digit',
      month:'2-digit',
      year:'numeric',
      hour:'2-digit',
      minute:'2-digit'
    }
  )
  .format(date);
}



/* =========================================================
   INICIALIZAÇÃO
   ========================================================= */

validateCurrentSession();