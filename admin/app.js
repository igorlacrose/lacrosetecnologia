'use strict';

const SUPABASE_URL='https://icrtewhazpfauuroswri.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_6PdAW2f-dpXhsaZXI0lyBg_PcGtuWgs';

const sb=window.supabase.createClient(
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

const authScreen=document.getElementById('authScreen'),
      adminApp=document.getElementById('adminApp'),
      loginForm=document.getElementById('loginForm'),
      loginEmail=document.getElementById('loginEmail'),
      loginPassword=document.getElementById('loginPassword'),
      loginButton=document.getElementById('loginButton'),
      authMessage=document.getElementById('authMessage'),
      logoutBtn=document.getElementById('logoutBtn'),
      adminName=document.getElementById('adminName');

let panelInitialized=false;

function authStatus(message='',ok=false){
  if(!authMessage)return;
  authMessage.textContent=message;
  authMessage.classList.toggle('ok',ok);
}

function setAuthBusy(busy){
  if(loginButton){
    loginButton.disabled=busy;
    loginButton.textContent=busy?'Entrando…':'Entrar';
  }
}

async function authorizeUser(user){
  if(!user)return null;

  const {data,error}=await sb
    .from('profiles')
    .select('full_name,role,active')
    .eq('id',user.id)
    .maybeSingle();

  if(error)throw error;

  if(
    !data ||
    data.active!==true ||
    !['master','admin'].includes(data.role)
  ){
    return null;
  }

  return data;
}

function showLogin(message=''){
  adminApp.hidden=true;
  authScreen.hidden=false;
  authStatus(message,false);
  loginPassword.value='';
  setTimeout(()=>loginEmail.focus(),50);
}

function showAdmin(profile){
  authScreen.hidden=true;
  adminApp.hidden=false;

  if(adminName && profile?.full_name){
    adminName.textContent=profile.full_name;
  }

  if(!panelInitialized){
    fill();
    panelInitialized=true;
  }
}

async function validateCurrentSession(){
  authStatus('Verificando acesso…',true);

  const {
    data:{session},
    error
  }=await sb.auth.getSession();

  if(error || !session?.user){
    showLogin('');
    return;
  }

  try{
    const profile=await authorizeUser(session.user);

    if(!profile){
      await sb.auth.signOut();
      showLogin('Esta conta não possui permissão administrativa.');
      return;
    }

    showAdmin(profile);
  }catch(err){
    console.error(err);
    showLogin('Não foi possível validar seu acesso agora.');
  }
}

loginForm?.addEventListener('submit',async(e)=>{
  e.preventDefault();

  authStatus('');
  setAuthBusy(true);

  try{
    const {data,error}=await sb.auth.signInWithPassword({
      email:loginEmail.value.trim(),
      password:loginPassword.value
    });

    if(error)throw error;

    const profile=await authorizeUser(data.user);

    if(!profile){
      await sb.auth.signOut();
      showLogin(
        'Usuário autenticado, mas sem permissão para acessar este painel.'
      );
      return;
    }

    showAdmin(profile);

  }catch(err){
    console.error(err);

    const msg=(err?.message||'').toLowerCase();

    authStatus(
      msg.includes('invalid login credentials')
        ? 'E-mail ou senha inválidos.'
        : 'Não foi possível entrar. Verifique seus dados e tente novamente.'
    );
  }finally{
    setAuthBusy(false);
  }
});

logoutBtn?.addEventListener('click',async()=>{
  await sb.auth.signOut();
  panelInitialized=false;
  showLogin('Sessão encerrada.');
});

sb.auth.onAuthStateChange((event,session)=>{
  if(event==='SIGNED_OUT'&&!session){
    showLogin('');
  }
});

const labels={
  sistema:'Sistema sob medida',
  automacao:'Automação de processo',
  ti:'TI, rede ou segurança',
  melhoria:'Melhoria de solução existente'
};

const sample={
  lead:{
    intent:'ti',
    segment:'Clínica / Saúde',
    scale:'12 computadores',
    problem:'Controle de acesso e organização de arquivos em 12 computadores.',
    current:'Compartilhamento de arquivos diretamente entre computadores.',
    impact:'Risco de segurança · Retrabalho e erros',
    impactLevel:'Alto',
    urgency:'Média',
    location:'Jequié',
    contact:'Contato ainda não informado',
    investment:'',
    solution:'Diagnóstico de infraestrutura + segmentação de rede + controle de acesso + centralização/organização de arquivos + estratégia de backup.',
    status:'Qualificado',
    score:82
  },
  messages:[
    {
      role:'agent',
      text:'Olá! Eu sou o Agente Lacrose. Conte o problema da sua empresa.'
    },
    {
      role:'user',
      text:'Tenho uma clínica com 12 computadores e estou tendo problemas com controle de acesso e arquivos.'
    },
    {
      role:'agent',
      text:'Entendi. Como esses arquivos são organizados e compartilhados hoje?'
    }
  ],
  updatedAt:new Date().toISOString()
};

function decodeDemo(v){
  try{
    return JSON.parse(
      decodeURIComponent(
        escape(
          atob(v)
        )
      )
    );
  }catch(e){
    return null;
  }
}

function getData(){
  const q=new URLSearchParams(location.search).get('demo');

  if(q){
    const d=decodeDemo(q);
    if(d)return d;
  }

  try{
    const x=JSON.parse(
      localStorage.getItem('lacrose_agent_demo_lead')||'null'
    );

    if(x)return x;
  }catch(e){}

  return sample;
}

const data=getData(),
      lead=data.lead||sample.lead;

function set(id,v){
  const e=document.getElementById(id);
  if(e)e.textContent=v||'—';
}

function fill(){
  set('fIntent',labels[lead.intent]||lead.intent);
  set('fSegment',lead.segment);
  set('fScale',lead.scale);
  set('fProblem',lead.problem);
  set('fImpact',lead.impact);
  set('fUrgency',lead.urgency);
  set('fLocation',lead.location);
  set('fContact',lead.contact);
  set('fCurrent',lead.current);

  set(
    'fInvestment',
    lead.investment||'Não informada / não aplicável'
  );

  set('fSolution',lead.solution);

  set(
    'leadStatusTop',
    (lead.status||'Em diagnóstico').toUpperCase()
  );

  set(
    'leadScoreTop',
    String(lead.score||0)
  );

  set(
    'tableNeed',
    labels[lead.intent]||'Diagnóstico'
  );

  set(
    'tableStatus',
    lead.status||'Em diagnóstico'
  );

  set(
    'tableCompany',
    lead.segment||'Lead recebido pelo site'
  );

  set(
    'tablePriority',
    lead.impactLevel==='Alto'
      ?'Alta'
      :lead.impactLevel==='Médio'
        ?'Média'
        :'Baixa'
  );

  const q=document.getElementById('kpiQualified');

  if(q&&lead.status==='Qualificado'){
    q.textContent='3';
  }

  renderConversation();
}

function renderConversation(){
  const box=document.getElementById('conversationList');

  box.innerHTML='';

  const msgs=data.messages||[];

  if(!msgs.length){
    box.innerHTML=
      '<div class="empty">Nenhuma conversa foi carregada. Volte ao site, converse com o protótipo e abra o painel novamente.</div>';
    return;
  }

  msgs.forEach(m=>{
    const d=document.createElement('div');

    d.className='conv '+(
      m.role==='user'
        ?'user'
        :'agent'
    );

    const s=document.createElement('span');

    s.textContent=m.text;

    d.appendChild(s);

    const sm=document.createElement('small');

    sm.textContent=
      m.role==='user'
        ?'Visitante'
        :'Agente Lacrose';

    d.appendChild(sm);

    box.appendChild(d);
  });
}

const titles={
  dashboard:'Visão geral',
  lead:'Oportunidade',
  conversation:'Conversa',
  audit:'Auditoria'
};

function show(id){
  document
    .querySelectorAll('.view')
    .forEach(
      v=>v.classList.toggle(
        'active',
        v.id===id
      )
    );

  document
    .querySelectorAll('.sidebar nav button')
    .forEach(
      b=>b.classList.toggle(
        'active',
        b.dataset.view===id
      )
    );

  set(
    'pageTitle',
    titles[id]||'Painel'
  );
}

document
  .querySelectorAll('[data-view]')
  .forEach(
    b=>b.addEventListener(
      'click',
      ()=>show(b.dataset.view)
    )
  );

document
  .querySelectorAll('[data-view-jump]')
  .forEach(
    b=>b.addEventListener(
      'click',
      ()=>show(b.dataset.viewJump)
    )
  );

function toast(t){
  const e=document.getElementById('toast');

  e.textContent=t;
  e.classList.add('show');

  setTimeout(
    ()=>e.classList.remove('show'),
    2200
  );
}

document
  .getElementById('approve')
  ?.addEventListener(
    'click',
    ()=>{
      toast(
        'Demonstração: lead marcado como aprovado para contato.'
      );

      const a=document.getElementById('auditList');
      const row=document.createElement('div');

      row.innerHTML=
        '<time>agora</time><p><b>Aprovação humana registrada</b><span>Administrador autorizou o próximo passo comercial no protótipo.</span></p><code>approval.granted</code>';

      a.prepend(row);
    }
  );

document
  .getElementById('request')
  ?.addEventListener(
    'click',
    ()=>toast(
      'Demonstração: solicitação de mais informações preparada, mas não enviada.'
    )
  );

validateCurrentSession();