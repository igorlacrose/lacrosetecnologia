'use strict';


/* =========================================================
   PERSISTÊNCIA DO AGENTE NO SUPABASE
   ========================================================= */

const AGENT_LEAD_ENDPOINT =
  'https://icrtewhazpfauuroswri.supabase.co/functions/v1/agent-lead';

function createAgentSessionId(){
  if(window.crypto?.randomUUID){
    return window.crypto.randomUUID();
  }

  return (
    Date.now().toString(36) +
    '_' +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

let agentSessionId=createAgentSessionId();

let persistTimer=null;
let persistInFlight=false;
let persistPending=false;
let lastPersistBody='';


function hasVisitorActivity(){
  return state.messages.some(
    message=>message.role==='user'
  );
}


function buildPersistencePayload(){
  return {
    sessionId:agentSessionId,

    lead:{
      ...state.lead
    },

    messages:state.messages.map(message=>({
      role:message.role,
      text:message.text,
      time:message.time
    })),

    completed:state.completed
  };
}


async function persistAgentSnapshot(){

  if(!hasVisitorActivity()){
    return;
  }

  const body=JSON.stringify(
    buildPersistencePayload()
  );


  if(body===lastPersistBody){
    return;
  }


  if(persistInFlight){
    persistPending=true;
    return;
  }


  persistInFlight=true;


  try{

    const response=await fetch(
      AGENT_LEAD_ENDPOINT,
      {
        method:'POST',

        headers:{
          'Content-Type':'application/json'
        },

        credentials:'omit',

        body
      }
    );


    if(!response.ok){

      let detail='';

      try{
        detail=await response.text();
      }catch(e){}

      throw new Error(
        `Falha ao registrar diagnóstico: ${response.status} ${detail}`
      );
    }


    lastPersistBody=body;


  }catch(error){

    console.warn(
      'Agente Lacrose: não foi possível sincronizar o diagnóstico agora.',
      error
    );

  }finally{

    persistInFlight=false;


    if(persistPending){

      persistPending=false;

      setTimeout(
        persistAgentSnapshot,
        150
      );
    }
  }
}


function schedulePersist(delay=350){

  if(!hasVisitorActivity()){
    return;
  }

  clearTimeout(persistTimer);

  persistTimer=setTimeout(
    persistAgentSnapshot,
    delay
  );
}



/* =========================================================
   MENU
   ========================================================= */

const menu=document.getElementById('menu'),
      links=document.getElementById('links');


function closeMenu(){

  if(!menu||!links){
    return;
  }

  menu.setAttribute(
    'aria-expanded',
    'false'
  );

  links.classList.remove('open');
}


if(menu&&links){

  menu.addEventListener(
    'click',
    ()=>{

      const open=
        menu.getAttribute('aria-expanded')!=='true';

      menu.setAttribute(
        'aria-expanded',
        String(open)
      );

      links.classList.toggle(
        'open',
        open
      );
    }
  );


  links
    .querySelectorAll('a')
    .forEach(
      a=>a.addEventListener(
        'click',
        closeMenu
      )
    );


  document.addEventListener(
    'keydown',
    e=>{

      if(
        e.key==='Escape' &&
        menu.getAttribute('aria-expanded')==='true'
      ){

        closeMenu();

        menu.focus();
      }
    }
  );
}



/* =========================================================
   CONFIGURAÇÃO DO AGENTE
   ========================================================= */

const INTENT_LABELS={

  sistema:'Sistema sob medida',

  automacao:'Automação de processo',

  ti:'TI, rede ou segurança',

  melhoria:'Melhoria de solução existente'
};


const FIELD_QUESTIONS={

  problem:
    'O que você precisa resolver? Você pode escolher uma opção rápida ou explicar do seu jeito.',

  segment:
    'Qual é o tipo de empresa ou segmento?',

  scale:
    'Qual é o tamanho aproximado desse cenário?',

  current:
    'Como isso funciona hoje? Você pode marcar mais de uma opção.',

  impact:
    'O que esse problema está causando hoje? Marque tudo que fizer sentido.',

  urgency:
    'Qual é a urgência para resolver isso?',

  location:
    'Em que cidade essa empresa ou operação está? Pergunto porque este caso pode envolver atendimento técnico presencial.',

  contact:
    'Para deixar a oportunidade pronta para análise da Lacrose, informe seu nome e um telefone ou e-mail de contato.',

  investment:
    'Já existe uma faixa de investimento prevista ou prefere receber uma proposta com base no diagnóstico?'
};



const state={

  lead:{

    intent:'',

    segment:'',

    scale:'',

    problem:'',

    current:'',

    impact:'',

    impactLevel:'',

    urgency:'',

    location:'',

    contact:'',

    investment:'',

    solution:'',

    status:'Em diagnóstico',

    score:0
  },

  awaiting:'problem',

  messages:[],

  completed:false,

  quickSelection:new Set()
};



const el={

  messages:
    document.getElementById('agentMessages'),

  quick:
    document.getElementById('quickStarts'),

  context:
    document.getElementById('contextReplies'),

  replyOptions:
    document.getElementById('replyOptions'),

  replyActions:
    document.getElementById('replyActions'),

  quickLabel:
    document.getElementById('quickReplyLabel'),

  quickHint:
    document.getElementById('quickReplyHint'),

  preferTyping:
    document.getElementById('preferTyping'),

  confirmReplies:
    document.getElementById('confirmReplies'),

  form:
    document.getElementById('agentForm'),

  input:
    document.getElementById('agentInput'),

  reset:
    document.getElementById('resetAgent'),

  example:
    document.getElementById('runExample'),

  openAdmin:
    document.getElementById('openAdmin')
};



function clean(s){

  return String(s||'')
    .trim()
    .replace(/\s+/g,' ');
}


function lower(s){

  return clean(s)
    .toLocaleLowerCase('pt-BR');
}


function cap(s){

  s=clean(s);

  return s
    ?s.charAt(0).toUpperCase()+s.slice(1)
    :'';
}



/* =========================================================
   MENSAGENS
   ========================================================= */

function addMessage(role,text,meta){

  if(!el.messages){
    return;
  }


  const msg={

    role,

    text:clean(text),

    time:new Date().toISOString()
  };


  state.messages.push(msg);


  const div=
    document.createElement('div');


  div.className=
    'msg '+role;


  const span=
    document.createElement('span');


  span.textContent=
    msg.text;


  div.appendChild(span);


  if(meta){

    const sm=
      document.createElement('small');

    sm.textContent=
      meta;

    div.appendChild(sm);
  }


  el.messages.appendChild(div);

  el.messages.scrollTop=
    el.messages.scrollHeight;


  /*
   * Sempre que houver atividade real do visitante,
   * agenda a sincronização com o Supabase.
   */

  schedulePersist();
}



function showTyping(){

  const div=
    document.createElement('div');


  div.className=
    'msg agent';


  div.id=
    'agentTyping';


  div.innerHTML=
    '<span class="typing" aria-label="Agente digitando"><i></i><i></i><i></i></span>';


  el.messages.appendChild(div);


  el.messages.scrollTop=
    el.messages.scrollHeight;
}



function hideTyping(){

  document
    .getElementById('agentTyping')
    ?.remove();
}



function agentSay(
  text,
  delay=360,
  onDone
){

  hideContextReplies();

  showTyping();


  setTimeout(
    ()=>{

      hideTyping();


      addMessage(
        'agent',
        text,
        'Agente Lacrose'
      );


      if(
        typeof onDone==='function'
      ){
        onDone();
      }

    },
    delay
  );
}



/* =========================================================
   DETECÇÃO
   ========================================================= */

function detectIntent(text){

  const t=lower(text);


  if(
    /automat|processo|repetitiv|integra|follow.?up|e-?mail|documento|cobran|workflow|tarefa/.test(t)
  ){
    return'automacao';
  }


  if(
    /sistema|software|aplicativo|app\b|programa|site|plataforma|saas|desenvolv/.test(t)
  ){
    return'sistema';
  }


  if(
    /rede|wifi|wi-fi|internet|firewall|vpn|backup|servidor|computador|pc\b|seguran|acesso|arquivo|mikrotik|infra/.test(t)
  ){
    return'ti';
  }


  if(
    /melhorar|já uso|ja uso|existente|lento|atual|trocar|modernizar|otimizar/.test(t)
  ){
    return'melhoria';
  }


  return'';
}



function detectSegment(text){

  const t=lower(text);


  const map=[

    [
      /cl[ií]nica|consult[oó]rio|sa[uú]de/,
      'Clínica / Saúde'
    ],

    [
      /restaurante|bar|lanchonete/,
      'Restaurante / Alimentação'
    ],

    [
      /mercado|supermercado/,
      'Supermercado / Varejo'
    ],

    [
      /loja|varejo|com[eé]rcio/,
      'Comércio / Varejo'
    ],

    [
      /escrit[oó]rio|contab|advoc|servi[cç]o/,
      'Escritório / Serviços'
    ],

    [
      /ind[uú]stria|f[aá]brica/,
      'Indústria'
    ],

    [
      /provedor|isp|telecom/,
      'Telecom / Provedor'
    ],

    [
      /sal[aã]o|est[eé]tica|studio|beleza/,
      'Beleza / Estética'
    ],

    [
      /escola|col[eé]gio|curso|educa[cç][aã]o/,
      'Educação'
    ],

    [
      /hotel|pousada/,
      'Hotelaria'
    ]
  ];


  for(
    const [re,label]
    of map
  ){

    if(re.test(t)){
      return label;
    }
  }


  return'';
}



function detectScale(text){

  const t=lower(text);


  const m=t.match(
    /\b(\d{1,5})\s*(computadores?|pcs?|m[aá]quinas?|usu[aá]rios?|pessoas?|funcion[aá]rios?|colaboradores?|unidades?|filiais?|lojas?|atendimentos?|clientes?)\b/i
  );


  return m
    ?`${m[1]} ${m[2]}`
    :'';
}



function detectImpactLevel(text){

  const t=lower(text);


  if(
    /seguran|preju[ií]zo|cliente afet|parad|vazamento|risco|perdendo|perda financeira|sem trabalhar|bloquead|invas|cr[ií]tico/.test(t)
  ){
    return'Alto';
  }


  if(
    /retrabalho|erro|tempo|lento|lentid|manual|produtiv|dificuldade/.test(t)
  ){
    return'Médio';
  }


  if(
    /melhoria|otimizar|planejad|organizar|crescer/.test(t)
  ){
    return'Baixo';
  }


  return'';
}



function detectUrgency(text){

  const t=lower(text);


  if(
    /urgente|imediat|hoje|agora|parado|cr[ií]tico|24 horas|essa semana|esta semana/.test(t)
  ){
    return'Alta';
  }


  if(
    /pr[oó]ximas semanas|semana|este m[eê]s|curto prazo|30 dias/.test(t)
  ){
    return'Média';
  }


  if(
    /planejad|sem pressa|futuro|pr[oó]ximos meses/.test(t)
  ){
    return'Baixa';
  }


  return'';
}



function detectLocation(text){

  const t=lower(text);


  const places=[

    'Jequié',

    'Vitória da Conquista',

    'Salvador',

    'Itabuna',

    'Ilhéus',

    'Jaguaquara',

    'Ipiaú',

    'Maracás'
  ];


  return places.find(
    p=>t.includes(
      p.toLocaleLowerCase('pt-BR')
    )
  )||'';
}



function absorbKnown(text){

  const l=state.lead;


  if(!l.intent){
    l.intent=detectIntent(text);
  }


  if(!l.segment){
    l.segment=detectSegment(text);
  }


  if(!l.scale){
    l.scale=detectScale(text);
  }


  if(!l.impactLevel){
    l.impactLevel=
      detectImpactLevel(text);
  }


  if(!l.urgency){
    l.urgency=
      detectUrgency(text);
  }


  if(!l.location){
    l.location=
      detectLocation(text);
  }
}



function normalizeUrgency(text){

  const t=lower(text);


  if(
    /alta|urgente|imediat|hoje|agora/.test(t)
  ){
    return'Alta';
  }


  if(
    /m[eé]dia|semana|m[eê]s|30 dias/.test(t)
  ){
    return'Média';
  }


  if(
    /baixa|planejad|sem pressa/.test(t)
  ){
    return'Baixa';
  }


  return cap(text);
}



/* =========================================================
   PREENCHIMENTO DOS CAMPOS
   ========================================================= */

function setAwaited(
  text,
  meta={}
){

  const l=state.lead,
        field=state.awaiting;


  if(!field){
    return;
  }


  if(field==='problem'){

    l.problem=
      clean(text);

  }else if(field==='segment'){

    l.segment=
      meta.value||cap(text);

  }else if(field==='scale'){

    l.scale=
      meta.value||clean(text);

  }else if(field==='current'){

    l.current=
      meta.value||clean(text);

  }else if(field==='impact'){

    l.impact=
      meta.value||clean(text);


    l.impactLevel=
      meta.impactLevel||
      detectImpactLevel(text)||
      'Médio';

  }else if(field==='urgency'){

    l.urgency=
      meta.value||
      normalizeUrgency(text);

  }else if(field==='location'){

    l.location=
      meta.value||cap(text);

  }else if(field==='contact'){

    l.contact=
      clean(text);

  }else if(field==='investment'){

    l.investment=
      meta.value||clean(text);
  }


  absorbKnown(text);
}



function requiredFields(){

  const l=state.lead;


  const fields=[

    'problem',

    'segment',

    'scale',

    'current',

    'impact',

    'urgency'
  ];


  if(l.intent==='ti'){
    fields.push('location');
  }


  fields.push('contact');


  if(
    l.intent==='sistema' ||
    l.intent==='automacao'
  ){

    fields.push('investment');
  }


  return fields;
}



function nextMissing(){

  const l=state.lead;


  if(
    !l.intent &&
    l.problem
  ){

    l.intent=
      detectIntent(l.problem)||
      'melhoria';
  }


  for(
    const field
    of requiredFields()
  ){

    if(
      !clean(l[field])
    ){

      return field;
    }
  }


  return'';
}



/* =========================================================
   SOLUÇÃO E SCORE
   ========================================================= */

function solutionFor(){

  const l=state.lead;


  if(
    !l.intent &&
    !l.problem
  ){

    return'Será sugerida conforme o diagnóstico evoluir.';
  }


  const t=lower(
    l.problem+
    ' '+
    l.current+
    ' '+
    l.impact
  );


  if(l.intent==='ti'){

    if(
      /acesso|arquivo|permiss|compartilh/.test(t)
    ){

      return'Diagnóstico de infraestrutura + segmentação de rede + controle de acesso + centralização/organização de arquivos + estratégia de backup.';
    }


    if(
      /wifi|wi-fi|internet|rede|queda|lent/.test(t)
    ){

      return'Diagnóstico de rede + revisão de topologia + segmentação/VLAN + Wi-Fi corporativo + firewall e monitoramento.';
    }


    if(
      /backup|perda de dados/.test(t)
    ){

      return'Estratégia de backup em camadas + controle de acesso + validação de restauração + revisão de segurança.';
    }


    return'Diagnóstico de infraestrutura e segurança + plano de correção priorizado + possibilidade de suporte/contrato mensal.';
  }


  if(
    l.intent==='automacao'
  ){

    return'Mapeamento do processo + automação do fluxo com regras de negócio e IA onde fizer sentido + logs + aprovação humana para ações críticas.';
  }


  if(
    l.intent==='sistema'
  ){

    return'Descoberta de requisitos + protótipo + sistema sob medida, com autenticação, banco de dados, permissões e integrações definidas pelo processo.';
  }


  return'Auditoria da solução atual + identificação de gargalos + plano de melhoria, integração ou substituição gradual conforme custo e impacto.';
}



function scoreLead(){

  const l=state.lead;

  let s=0;


  if(l.problem){
    s+=15;
  }


  if(l.intent){
    s+=10;
  }


  if(l.segment){
    s+=10;
  }


  if(l.scale){
    s+=10;
  }


  if(l.current){
    s+=10;
  }


  if(l.impact){

    s+=
      l.impactLevel==='Alto'
        ?15
        :l.impactLevel==='Médio'
          ?10
          :6;
  }


  if(l.urgency){

    s+=
      l.urgency==='Alta'
        ?12
        :l.urgency==='Média'
          ?8
          :4;
  }


  if(l.location){
    s+=5;
  }


  if(l.contact){
    s+=13;
  }


  s=Math.min(
    100,
    s
  );


  l.score=s;


  if(!l.problem){

    l.status=
      'Em diagnóstico';

  }else if(
    l.contact &&
    s>=75
  ){

    l.status=
      'Qualificado';

  }else if(
    s>=45
  ){

    l.status=
      'Em diagnóstico';

  }else{

    l.status=
      'Novo';
  }


  return s;
}



/* =========================================================
   ATUALIZAÇÃO DO PAINEL DO AGENTE
   ========================================================= */

function updatePreview(){

  const l=state.lead;


  l.solution=
    solutionFor();


  const score=
    scoreLead();


  const set=(
    id,
    value
  )=>{

    const node=
      document.getElementById(id);

    if(node){
      node.textContent=value||'—';
    }
  };


  set(
    'leadIntent',
    INTENT_LABELS[l.intent]||'—'
  );


  set(
    'leadSegment',
    l.segment
  );


  set(
    'leadScale',
    l.scale
  );


  set(
    'leadProblem',
    l.problem
  );


  set(
    'leadImpact',
    l.impact
  );


  set(
    'leadUrgency',
    l.urgency
  );


  set(
    'leadLocation',
    l.location
  );


  set(
    'leadContact',
    l.contact
  );


  set(
    'leadSolution',
    l.solution
  );


  set(
    'leadScore',
    String(score)
  );


  set(
    'leadStatus',
    l.status
  );


  const bar=
    document.getElementById('scoreBar');


  if(bar){
    bar.style.width=
      score+'%';
  }


  /*
   * Mantemos o armazenamento local atual
   * para não quebrar o comportamento existente.
   */

  try{

    localStorage.setItem(
      'lacrose_agent_demo_lead',
      JSON.stringify({
        lead:l,
        messages:state.messages,
        updatedAt:
          new Date().toISOString()
      })
    );

  }catch(e){}


  /*
   * E agora também sincronizamos
   * com o backend seguro.
   */

  schedulePersist();
}



/* =========================================================
   OPÇÕES DE PROBLEMA
   ========================================================= */

function problemOptions(){

  const i=
    state.lead.intent;


  if(i==='ti'){

    return[

      [
        'Internet / Wi-Fi',
        'Problemas de internet, Wi-Fi ou rede'
      ],

      [
        'Acesso a arquivos',
        'Controle de acesso, permissões ou arquivos'
      ],

      [
        'Segurança',
        'Segurança da rede ou dos computadores'
      ],

      [
        'Backup',
        'Backup e proteção contra perda de dados'
      ],

      [
        'Servidor / PCs',
        'Servidor, computadores ou infraestrutura'
      ],

      [
        'Outro',
        '',
        'focus'
      ]
    ];
  }



  if(i==='sistema'){

    return[

      [
        'Clientes / atendimento',
        'Preciso de um sistema para controlar clientes e atendimentos'
      ],

      [
        'Financeiro / caixa',
        'Preciso de um sistema para financeiro, caixa ou movimentações'
      ],

      [
        'Agenda / operação',
        'Preciso de um sistema para agenda ou operação diária'
      ],

      [
        'Estoque',
        'Preciso de um sistema para estoque ou almoxarifado'
      ],

      [
        'Integrações',
        'Preciso integrar informações ou sistemas diferentes'
      ],

      [
        'Outro',
        '',
        'focus'
      ]
    ];
  }



  if(i==='automacao'){

    return[

      [
        'Leads / atendimento',
        'Quero automatizar recebimento, qualificação e acompanhamento de leads'
      ],

      [
        'E-mail / tarefas',
        'Quero automatizar e-mails, classificação e criação de tarefas'
      ],

      [
        'Documentos',
        'Quero extrair dados de documentos e cadastrar ou processar automaticamente'
      ],

      [
        'Cobrança / follow-up',
        'Quero automatizar acompanhamento de cobranças e follow-ups'
      ],

      [
        'Relatórios',
        'Quero automatizar consolidação de dados e relatórios'
      ],

      [
        'Outro',
        '',
        'focus'
      ]
    ];
  }



  return[

    [
      'Está lento',
      'A solução atual está lenta ou atrapalhando o trabalho'
    ],

    [
      'Faltam recursos',
      'A solução atual não tem os recursos que precisamos'
    ],

    [
      'Muito manual',
      'Ainda existe muito trabalho manual e repetitivo'
    ],

    [
      'Dados espalhados',
      'As informações ficam espalhadas em vários lugares'
    ],

    [
      'Difícil de usar',
      'A solução atual é difícil de usar ou confusa'
    ],

    [
      'Outro',
      '',
      'focus'
    ]
  ];
}



/* =========================================================
   RESPOSTAS RÁPIDAS
   ========================================================= */

function quickConfig(field){

  const common={

    mode:'single',

    hint:
      'Escolha uma opção ou escreva com suas palavras.'
  };


  if(field==='problem'){

    return{

      ...common,

      options:
        problemOptions()
          .map(
            ([label,value,action])=>({
              label,
              value,
              action
            })
          )
    };
  }



  if(field==='segment'){

    return{

      ...common,

      options:[

        {
          label:'Clínica / Saúde',
          value:'Clínica / Saúde'
        },

        {
          label:'Comércio / Varejo',
          value:'Comércio / Varejo'
        },

        {
          label:'Escritório / Serviços',
          value:'Escritório / Serviços'
        },

        {
          label:'Telecom / Provedor',
          value:'Telecom / Provedor'
        },

        {
          label:'Beleza / Estética',
          value:'Beleza / Estética'
        },

        {
          label:'Outro segmento',
          action:'focus',
          placeholder:'Digite o segmento da empresa...'
        }
      ]
    };
  }



  if(field==='scale'){

    const suffix=
      state.lead.intent==='ti'
        ?'equipamentos / usuários'
        :'pessoas / usuários';


    return{

      ...common,

      options:[

        {
          label:'1 a 5',
          value:`1 a 5 ${suffix}`
        },

        {
          label:'6 a 10',
          value:`6 a 10 ${suffix}`
        },

        {
          label:'11 a 20',
          value:`11 a 20 ${suffix}`
        },

        {
          label:'21 a 50',
          value:`21 a 50 ${suffix}`
        },

        {
          label:'Mais de 50',
          value:`Mais de 50 ${suffix}`
        },

        {
          label:'Não sei ainda',
          value:'Escala ainda não definida'
        }
      ]
    };
  }



  if(field==='current'){

    return{

      mode:'multi',

      hint:
        'Marque uma ou mais opções e toque em continuar.',

      options:[

        {
          label:'Planilhas',
          value:'Planilhas'
        },

        {
          label:'WhatsApp',
          value:'WhatsApp'
        },

        {
          label:'Sistema pronto',
          value:'Sistema de mercado'
        },

        {
          label:'Sistema próprio',
          value:'Sistema próprio'
        },

        {
          label:'Processo manual',
          value:'Processo manual'
        },

        {
          label:'Rede / equipamentos locais',
          value:'Rede ou equipamentos locais'
        },

        {
          label:'Nada estruturado',
          value:'Nada estruturado'
        },

        {
          label:'Não sei',
          value:'Solução atual não identificada'
        }
      ]
    };
  }



  if(field==='impact'){

    return{

      mode:'multi',

      hint:
        'Pode marcar mais de um impacto.',

      options:[

        {
          label:'Perda de tempo',
          value:'Perda de tempo',
          level:'Médio'
        },

        {
          label:'Retrabalho / erros',
          value:'Retrabalho e erros',
          level:'Médio'
        },

        {
          label:'Risco de segurança',
          value:'Risco de segurança',
          level:'Alto'
        },

        {
          label:'Prejuízo financeiro',
          value:'Prejuízo financeiro',
          level:'Alto'
        },

        {
          label:'Clientes afetados',
          value:'Clientes afetados',
          level:'Alto'
        },

        {
          label:'Dificulta crescer',
          value:'Dificuldade de crescer',
          level:'Médio'
        },

        {
          label:'Só quero melhorar',
          value:'Melhoria preventiva',
          level:'Baixo'
        }
      ]
    };
  }



  if(field==='urgency'){

    return{

      ...common,

      options:[

        {
          label:'Está parado agora',
          value:'Alta'
        },

        {
          label:'Preciso esta semana',
          value:'Alta'
        },

        {
          label:'Nas próximas semanas',
          value:'Média'
        },

        {
          label:'Neste mês',
          value:'Média'
        },

        {
          label:'Projeto planejado',
          value:'Baixa'
        },

        {
          label:'Sem pressa',
          value:'Baixa'
        }
      ]
    };
  }



  if(field==='location'){

    return{

      ...common,

      options:[

        {
          label:'Jequié',
          value:'Jequié'
        },

        {
          label:'Vitória da Conquista',
          value:'Vitória da Conquista'
        },

        {
          label:'Outra cidade',
          action:'focus',
          placeholder:'Digite a cidade da empresa...'
        }
      ]
    };
  }



  if(field==='contact'){

    return{

      ...common,

      hint:
        'Escolha como prefere informar o contato e digite os dados.',

      options:[

        {
          label:'WhatsApp',
          action:'focus',
          placeholder:'Digite seu nome e WhatsApp...'
        },

        {
          label:'E-mail',
          action:'focus',
          placeholder:'Digite seu nome e e-mail...'
        }
      ]
    };
  }



  if(field==='investment'){

    return{

      ...common,

      options:[

        {
          label:'Ainda não defini',
          value:'Faixa de investimento ainda não definida'
        },

        {
          label:'Até R$ 2 mil',
          value:'Até R$ 2 mil'
        },

        {
          label:'R$ 2 a 5 mil',
          value:'R$ 2 a 5 mil'
        },

        {
          label:'R$ 5 a 10 mil',
          value:'R$ 5 a 10 mil'
        },

        {
          label:'Acima de R$ 10 mil',
          value:'Acima de R$ 10 mil'
        },

        {
          label:'Quero proposta após diagnóstico',
          value:'Prefere proposta com base no diagnóstico'
        }
      ]
    };
  }


  return null;
}



/* =========================================================
   CAMPO DE TEXTO
   ========================================================= */

function setInputForField(field){

  if(!el.input){
    return;
  }


  const placeholders={

    problem:
      'Ou explique o problema com suas palavras...',

    segment:
      'Ou digite o segmento...',

    scale:
      'Ou descreva o tamanho aproximado...',

    current:
      'Ou explique como funciona hoje...',

    impact:
      'Ou conte qual é o impacto...',

    urgency:
      'Ou descreva a urgência...',

    location:
      'Ou digite a cidade...',

    contact:
      'Digite seu nome e telefone ou e-mail...',

    investment:
      'Ou informe uma faixa de investimento...'
  };


  el.input.placeholder=
    placeholders[field]||
    'Escreva sua resposta...';
}



function hideContextReplies(){

  if(!el.context){
    return;
  }


  el.context.hidden=true;


  state.quickSelection.clear();


  if(el.replyOptions){
    el.replyOptions.innerHTML='';
  }


  if(el.replyActions){
    el.replyActions.hidden=true;
  }
}



/* =========================================================
   RENDER DAS RESPOSTAS RÁPIDAS
   ========================================================= */

function renderQuickReplies(field){

  const cfg=
    quickConfig(field);


  setInputForField(field);


  if(
    !cfg ||
    !el.context ||
    !el.replyOptions
  ){

    hideContextReplies();

    return;
  }


  state.quickSelection.clear();


  el.replyOptions.innerHTML='';


  el.context.hidden=false;


  el.quickLabel.textContent=
    cfg.mode==='multi'
      ?'SELECIONE UMA OU MAIS'
      :'RESPOSTAS RÁPIDAS';


  el.quickHint.textContent=
    cfg.hint||
    'Escolha uma opção ou escreva com suas palavras.';


  el.replyActions.hidden=
    cfg.mode!=='multi';


  cfg.options.forEach(
    (
      option,
      index
    )=>{

      const btn=
        document.createElement('button');


      btn.type='button';


      btn.className=
        'reply-chip'+
        (
          cfg.mode==='multi'
            ?' multi'
            :''
        );


      btn.dataset.index=
        String(index);


      btn.setAttribute(
        'aria-pressed',
        'false'
      );


      if(cfg.mode==='multi'){

        const mark=
          document.createElement('span');

        mark.className=
          'check-mark';

        mark.textContent=
          '✓';

        btn.appendChild(mark);
      }


      const label=
        document.createElement('span');


      label.textContent=
        option.label;


      btn.appendChild(label);


      btn.addEventListener(
        'click',
        ()=>{

          if(
            option.action==='focus'
          ){

            if(option.placeholder){

              el.input.placeholder=
                option.placeholder;
            }


            el.input.focus();

            return;
          }


          if(
            cfg.mode==='multi'
          ){

            const selected=
              state.quickSelection.has(index);


            if(selected){

              state.quickSelection.delete(index);

            }else{

              state.quickSelection.add(index);
            }


            btn.classList.toggle(
              'selected',
              !selected
            );


            btn.setAttribute(
              'aria-pressed',
              String(!selected)
            );


            updateConfirmState();


          }else{

            submitText(

              option.value||
              option.label,

              {

                value:
                  option.value||
                  option.label,

                fromQuick:true
              }
            );
          }
        }
      );


      el.replyOptions.appendChild(btn);
    }
  );


  updateConfirmState();
}



function updateConfirmState(){

  if(!el.confirmReplies){
    return;
  }


  el.confirmReplies.disabled=
    state.quickSelection.size===0;


  el.confirmReplies.textContent=
    state.quickSelection.size
      ?`Continuar com ${state.quickSelection.size} selecionada${state.quickSelection.size>1?'s':''}`
      :'Selecione pelo menos uma opção';
}



function confirmMultiReplies(){

  const cfg=
    quickConfig(
      state.awaiting
    );


  if(
    !cfg ||
    cfg.mode!=='multi'
  ){
    return;
  }


  const selected=
    [...state.quickSelection]

      .sort(
        (a,b)=>a-b
      )

      .map(
        i=>cfg.options[i]
      )

      .filter(Boolean);


  if(!selected.length){
    return;
  }


  const value=
    selected

      .map(
        o=>o.value||o.label
      )

      .join(' · ');


  let impactLevel='';


  if(
    state.awaiting==='impact'
  ){

    const levels=
      selected.map(
        o=>o.level
      );


    impactLevel=
      levels.includes('Alto')
        ?'Alto'
        :levels.includes('Médio')
          ?'Médio'
          :'Baixo';
  }


  submitText(
    value,
    {
      value,
      impactLevel,
      fromQuick:true
    }
  );
}



/* =========================================================
   FLUXO DE PERGUNTAS
   ========================================================= */

function askNext(){

  updatePreview();


  const field=
    nextMissing();


  if(field){

    state.awaiting=
      field;


    agentSay(
      FIELD_QUESTIONS[field],
      300,
      ()=>renderQuickReplies(field)
    );


    return;
  }


  state.awaiting='';


  state.completed=true;


  state.lead.solution=
    solutionFor();


  scoreLead();


  updatePreview();


  hideContextReplies();


  const l=
    state.lead;


  agentSay(

    `Fechei o diagnóstico inicial. Classifiquei esta oportunidade como “${l.status}”. A solução provável é: ${l.solution} A próxima etapa é a revisão humana da Lacrose antes de orçamento, proposta ou qualquer compromisso comercial.`,

    420
  );
}



/* =========================================================
   ENVIO DE RESPOSTA
   ========================================================= */

function submitText(
  text,
  meta={}
){

  text=clean(text);


  if(!text){
    return;
  }


  hideContextReplies();


  addMessage(
    'user',
    text,
    'Visitante'
  );


  if(
    !state.lead.problem &&
    state.awaiting!=='problem'
  ){

    state.awaiting=
      'problem';
  }


  setAwaited(
    text,
    meta
  );


  absorbKnown(text);


  if(
    !state.lead.intent &&
    state.lead.problem
  ){

    state.lead.intent=
      detectIntent(
        state.lead.problem
      )||
      'melhoria';
  }


  if(el.quick){

    el.quick.style.display=
      'none';
  }


  updatePreview();


  setTimeout(
    askNext,
    110
  );
}



/* =========================================================
   INÍCIO POR INTENÇÃO
   ========================================================= */

function startIntent(
  intent,
  label
){

  state.lead.intent=
    intent;


  state.awaiting=
    'problem';


  state.completed=
    false;


  addMessage(

    'user',

    label||
    INTENT_LABELS[intent],

    'Visitante'
  );


  if(el.quick){

    el.quick.style.display=
      'none';
  }


  updatePreview();


  agentSay(

    `Perfeito. Vou tratar isso como “${INTENT_LABELS[intent]}”. ${FIELD_QUESTIONS.problem}`,

    300,

    ()=>renderQuickReplies('problem')
  );
}



/* =========================================================
   REINICIAR CONVERSA
   ========================================================= */

function resetAgent(){

  /*
   * Se já existia uma conversa real,
   * uma nova conversa recebe outro identificador.
   */

  const hadVisitorActivity=
    state.messages.some(
      message=>message.role==='user'
    );


  if(hadVisitorActivity){

    agentSessionId=
      createAgentSessionId();


    lastPersistBody='';
  }


  Object.assign(
    state.lead,
    {

      intent:'',

      segment:'',

      scale:'',

      problem:'',

      current:'',

      impact:'',

      impactLevel:'',

      urgency:'',

      location:'',

      contact:'',

      investment:'',

      solution:'',

      status:'Em diagnóstico',

      score:0
    }
  );


  state.awaiting=
    'problem';


  state.messages=[];


  state.completed=false;


  state.quickSelection.clear();


  if(el.messages){

    el.messages.innerHTML='';
  }


  if(el.quick){

    el.quick.style.display=
      'grid';
  }


  if(el.input){

    el.input.value='';

    el.input.placeholder=
      'Ou simplesmente conte o problema da sua empresa...';
  }


  hideContextReplies();


  try{

    localStorage.removeItem(
      'lacrose_agent_demo_lead'
    );

  }catch(e){}


  addMessage(

    'agent',

    'Olá! Eu sou o Agente Lacrose. Conte o problema da sua empresa e eu vou fazer apenas as perguntas necessárias para montar um diagnóstico comercial inicial. Você pode tocar em uma opção abaixo ou simplesmente escrever.',

    'Agente Lacrose'
  );


  updatePreview();
}



/* =========================================================
   PAINEL
   ========================================================= */

function encodeDemo(obj){

  const json=
    JSON.stringify(obj);


  return btoa(
    unescape(
      encodeURIComponent(json)
    )
  );
}



/* =========================================================
   EVENTOS
   ========================================================= */

if(el.form){

  el.form.addEventListener(
    'submit',
    e=>{

      e.preventDefault();


      const text=
        el.input.value;


      el.input.value='';


      submitText(text);
    }
  );



  el.input.addEventListener(
    'keydown',
    e=>{

      if(
        e.key==='Enter' &&
        !e.shiftKey
      ){

        e.preventDefault();

        el.form.requestSubmit();
      }
    }
  );



  document
    .querySelectorAll('[data-start]')
    .forEach(
      btn=>btn.addEventListener(
        'click',
        ()=>startIntent(
          btn.dataset.start,
          btn.querySelector('span')?.textContent
        )
      )
    );



  document
    .querySelectorAll('[data-intent]')
    .forEach(
      a=>a.addEventListener(
        'click',
        ()=>{

          const intent=
            a.dataset.intent;


          if(intent){

            setTimeout(
              ()=>{

                if(
                  !state.lead.problem &&
                  state.lead.intent!==intent
                ){

                  startIntent(
                    intent,
                    INTENT_LABELS[intent]
                  );
                }

              },
              350
            );
          }
        }
      )
    );



  el.preferTyping
    ?.addEventListener(
      'click',
      ()=>{

        hideContextReplies();

        el.input?.focus();
      }
    );



  el.confirmReplies
    ?.addEventListener(
      'click',
      confirmMultiReplies
    );



  el.example
    ?.addEventListener(
      'click',
      ()=>{

        resetAgent();


        setTimeout(
          ()=>submitText(
            'Tenho uma clínica com 12 computadores e estou tendo problemas com controle de acesso e arquivos.'
          ),
          120
        );
      }
    );



  el.reset
    ?.addEventListener(
      'click',
      resetAgent
    );



  el.openAdmin
    ?.addEventListener(
      'click',
      ()=>{

        updatePreview();


        const payload={

          lead:
            state.lead,

          messages:
            state.messages,

          updatedAt:
            new Date().toISOString()
        };


        let url=
          'admin/';


        try{

          url+=
            '?demo='+
            encodeURIComponent(
              encodeDemo(payload)
            );

        }catch(e){}


        window.location.href=
          url;
      }
    );


  resetAgent();
}