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

    messages:state.messages.map(
      message=>({

        role:message.role,

        text:message.text,

        time:message.time
      })
    ),

    completed:state.completed
  };
}


async function persistAgentSnapshot(){

  if(!hasVisitorActivity()){
    return;
  }


  const body=
    JSON.stringify(
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
  const requestSession=agentSessionId;
  const reportOcaStatus=state.oca && state.completed;


  try{

    const response=
      await fetch(
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

        detail=
          await response.text();

      }catch(e){}


      throw new Error(
        `Falha ao registrar diagnóstico: ${response.status} ${detail}`
      );
    }


    lastPersistBody=body;
    if(reportOcaStatus && requestSession===agentSessionId){
      setOcaStatus('Pedido recebido para análise pela Lacrose Tecnologia.');
    }


  }catch(error){

    if(reportOcaStatus && requestSession===agentSessionId){
      setOcaStatus('Não foi possível confirmar o envio. Envie uma nova mensagem para tentar novamente ou fale pelo WhatsApp no rodapé do site.');
    }

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


  persistTimer=
    setTimeout(
      persistAgentSnapshot,
      delay
    );
}



/* =========================================================
   MENU
   ========================================================= */

const menu=
  document.getElementById('menu'),

links=
  document.getElementById('links');


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


const ADVISOR=window.LacroseOcaAdvisor;
const OCA_KNOWLEDGE=window.LacroseOcaKnowledge;
const OCA_INTERPRET_ENDPOINT='https://icrtewhazpfauuroswri.supabase.co/functions/v1/oca-interpret';
let ocaInterpretPending=false,ocaInterpretEpoch=0,ocaInterpretAbort=null;
let ocaApprovedTopic='unknown';

function mayAskOcaAi(text,meta,wasCompleted){
  if(wasCompleted||state.oca||meta.fromQuick||state.awaiting!=='problem'||
     ocaInterpretPending||OCA_KNOWLEDGE?.isSpecificRequest(text))return false;
  // Não usar IA para diagnósticos extensos nem para dados pessoais.
  if(text.length>320||/@|https?:\/\/|(?:\d[\s.\-()]*){7,}/i.test(text))return false;
  return /\?|^(?:voc[eê]s|a lacrose|essa empresa|qual|quais|como|onde|por que|ser[aá] que|tem como)\b/i.test(text);
}
async function classifyOcaQuestion(text){
  const controller=new AbortController();
  ocaInterpretAbort=controller;
  const timeout=setTimeout(()=>controller.abort(),6800);
  try{
    const response=await fetch(OCA_INTERPRET_ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'omit',
      signal:controller.signal,
      body:JSON.stringify({
        sessionId:agentSessionId,question:text,lastTopic:ocaApprovedTopic
      })
    });
    if(!response.ok)return null;
    const data=await response.json();
    if(!data?.ok||typeof data.id!=='string')return null;
    return OCA_KNOWLEDGE?.entry(data.id)||null;
  }catch{return null;}
  finally{
    clearTimeout(timeout);
    if(ocaInterpretAbort===controller)ocaInterpretAbort=null;
  }
}
const OCA_SITE='Site integrado com sistema personalizado';
const OCA_SITE_OPENING='Qual é o seu negócio e o que você quer que o site ou projeto faça ou integre? O orçamento depende do escopo que definirmos juntos.';
const OCA_SITE_CONTACT='Qual telefone ou e-mail a Lacrose pode usar para retornar com a análise?';

function setOcaStatus(message){
  const status=document.getElementById('ocaStatus');
  if(status){
    status.hidden=!message;
    status.textContent=message;
  }
}

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
    'Em qual cidade e estado sua empresa ou operação está?',

  contact:
    'Para deixar a oportunidade pronta para análise da Lacrose, informe seu nome e um telefone ou e-mail de contato.'
};


const state={

  oca:false,
  contactDeclined:false,
  faqContext:null,

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
    document.getElementById('runExample')
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

function addMessage(
  role,
  text,
  meta
){

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

  const t=
    lower(text);


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

  const t=
    lower(text);

  // Clínica de estética não é sinônimo de clínica de saúde genérica.
  if(/cl[ií]nica(?:\s+de)?\s+est[eé]tica/.test(t))return 'Beleza / Estética';

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
      /barbearia|barbeiro|sal[aã]o|est[eé]tica|studio|beleza/,
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

  const t=
    lower(text);


  const m=
    t.match(
      /\b(\d{1,5})\s*(computadores?|pcs?|m[aá]quinas?|usu[aá]rios?|pessoas?|funcion[aá]rios?|colaboradores?|unidades?|filiais?|lojas?|atendimentos?|clientes?)\b/i
    );


  return m
    ?`${m[1]} ${m[2]}`
    :'';
}



function detectImpactLevel(text){

  const t=
    lower(text);


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

  const t=
    lower(text);


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



function detectEmail(text){

  return (
    String(text || '')
      .match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
      )?.[0] || ''
  );
}



function normalizePhoneDigits(raw){

  let digits=
    String(raw || '')
      .replace(/\D/g,'');


  if(
    digits.startsWith('00') &&
    digits.length>11
  ){

    digits=
      digits.slice(2);
  }


  /*
   * Aceita o zero de operadora/tronco usado em alguns formatos:
   * 073 99905-0973 -> 73 99905-0973
   */

  if(
    digits.startsWith('0') &&
    (
      digits.length===11 ||
      digits.length===12
    )
  ){

    digits=
      digits.slice(1);
  }


  return digits;
}



function detectPhone(text){

  const withoutEmail=
    String(text || '')
      .replace(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig,
        ' '
      );


  const candidates=
    withoutEmail.match(
      /(?:\+?\d[\d\s().\-\/]{7,}\d)/g
    ) || [];


  for(
    const candidate
    of candidates
  ){

    const digits=
      normalizePhoneDigits(
        candidate
      );


    /*
     * Brasil:
     * 73 99905-0973
     * (73) 99905-0973
     * 73999050973
     * +55 73 99905-0973
     * 55 73 99905 0973
     */

    if(
      digits.length===10 ||
      digits.length===11 ||
      (
        digits.startsWith('55') &&
        (
          digits.length===12 ||
          digits.length===13
        )
      )
    ){

      return digits;
    }


    /*
     * Também aceita número internacional explícito com +,
     * desde que esteja dentro do tamanho válido do E.164.
     */

    if(
      candidate.trim().startsWith('+') &&
      digits.length>=10 &&
      digits.length<=15
    ){

      return digits;
    }
  }


  return'';
}



function absorbContact(text){

  const email=
    detectEmail(text);

  const phone=
    detectPhone(text);


  if(
    !email &&
    !phone
  ){

    return false;
  }


  const existing=
    clean(
      state.lead.contact
    );


  const parts=
    existing
      ?existing
        .split(' · ')
        .map(clean)
        .filter(Boolean)
      :[];


  const existingText=
    parts.join(' · ');


  if(
    email &&
    !detectEmail(existingText)
  ){

    parts.push(email);
  }


  if(
    phone &&
    !detectPhone(existingText)
  ){

    parts.push(phone);
  }


  state.lead.contact=
    [...new Set(parts)]
      .join(' · ');


  return true;
}



function absorbKnown(text){

  const l=
    state.lead;


  if(!l.intent){

    l.intent=
      detectIntent(text);
  }


  if(!l.segment){

    l.segment=
      detectSegment(text);
  }


  if(!l.scale){

    l.scale=
      detectScale(text);
  }


  if(!l.impactLevel){

    l.impactLevel=
      detectImpactLevel(text);
  }


  if(!l.urgency){

    l.urgency=
      detectUrgency(text);
  }


  /*
   * Contato pode ser informado em qualquer momento da conversa,
   * inclusive depois do diagnóstico já ter sido concluído.
   */

  absorbContact(text);
}



function normalizeUrgency(text){

  const t=
    lower(text);


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

  const l=
    state.lead,

  field=
    state.awaiting;


  if(!field){
    return;
  }


  if(field==='problem'){

    l.problem=
      clean(text);

  }else if(field==='segment'){

    l.segment=
      meta.value||
      cap(text);

  }else if(field==='scale'){

    l.scale=
      meta.value||
      clean(text);

  }else if(field==='current'){

    l.current=
      meta.value||
      clean(text);

  }else if(field==='impact'){

    l.impact=
      meta.value||
      clean(text);


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
      clean(text);

  }else if(field==='contact'){
    if(ADVISOR?.isContactDecline(text)){
      state.contactDeclined=true;
      l.contact='';
    }else{
      l.contact=clean(text);
      state.contactDeclined=false;
    }
  }

  if(/\b(na verdade|corrigindo|correcao|nao e)\b/.test(lower(text))){
    const corrected=detectSegment(text);
    if(corrected)l.segment=corrected;
  }
  absorbKnown(text);
}



function requiredFields(){
  // Não obrigar o visitante a responder oito perguntas genéricas.
  return ['problem','segment','current','contact'];
}



function nextMissing(){

  const l=
    state.lead;


  if(
    !l.intent &&
    l.problem
  ){

    l.intent=
      detectIntent(
        l.problem
      )||
      'melhoria';
  }


  for(const field of requiredFields()){
    if(field==='contact' && state.contactDeclined)continue;
    if(!clean(l[field]))return field;
  }


  return'';
}



/* =========================================================
   SOLUÇÃO E SCORE
   ========================================================= */

function solutionFor(){

  if(state.oca){
    return OCA_SITE;
  }

  const l=
    state.lead;


  if(
    !l.intent &&
    !l.problem
  ){

    return'Será sugerida conforme o diagnóstico evoluir.';
  }


  const t=
    lower(
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


    return'Diagnóstico de infraestrutura e segurança + plano de correção priorizado + possibilidade de suporte ou acompanhamento técnico.';
  }


  if(
    l.intent==='automacao'
  ){

    return'Mapeamento do processo + automação do fluxo com regras de negócio e IA onde fizer sentido + logs + aprovação humana para ações críticas.';
  }


  if(
    l.intent==='sistema'
  ){

    return'Descoberta de requisitos + definição de escopo + sistema sob medida, com autenticação, banco de dados, permissões e integrações definidas pelo processo.';
  }


  return'Auditoria da solução atual + identificação de gargalos + plano de melhoria, integração ou substituição gradual conforme necessidade e impacto.';
}



function scoreLead(){

  const l=
    state.lead;


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


  s=
    Math.min(
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

  const l=
    state.lead;


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

      node.textContent=
        value||'—';
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
            (
              [
                label,
                value,
                action
              ]
            )=>({

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
    return ADVISOR?.quickOptions('current',state.lead)||null;
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


  /*
   * Localização fica propositalmente sem opções prontas.
   * O cliente digita livremente cidade/estado.
   */


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
      'Digite cidade e estado. Ex.: Feira de Santana/BA',

    contact:
      'Digite seu nome e telefone ou e-mail...'
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


      btn.type=
        'button';


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


      if(
        cfg.mode==='multi'
      ){

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

            if(
              option.placeholder
            ){

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
              state.quickSelection.has(
                index
              );


            if(selected){

              state.quickSelection.delete(
                index
              );

            }else{

              state.quickSelection.add(
                index
              );
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


      el.replyOptions.appendChild(
        btn
      );
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

  if(state.oca){
    if(!state.lead.problem || !state.lead.contact){
      state.awaiting=state.lead.problem?'contact':'problem';
      agentSay(state.lead.problem?OCA_SITE_CONTACT:OCA_SITE_OPENING,300);
      return;
    }

    state.awaiting='';
    state.completed=true;
    setOcaStatus('Enviando pedido para análise comercial.');
    agentSay('A equipe da Lacrose Tecnologia vai conversar com você para alinhar os requisitos e aprovar o orçamento antes de enviá-lo.',300);
    schedulePersist();
    return;
  }


  const field=
    nextMissing();


  if(field){

    state.awaiting=
      field;


    agentSay(
      ADVISOR?.questionFor(field,state.lead)||FIELD_QUESTIONS[field],
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
    state.contactDeclined
      ?'Entendi sua necessidade inicial. Você pode continuar perguntando sobre nossos serviços por aqui. Sem um contato autorizado, não faremos retorno por telefone ou e-mail.'
      :'Obrigado! Registrei seu pedido para avaliação da Lacrose Tecnologia. Um responsável poderá alinhar os detalhes e confirmar o escopo antes de apresentar qualquer proposta.',
    360
  );
}



/* =========================================================
   ENVIO DE RESPOSTA
   ========================================================= */

async function submitText(
  text,
  meta={}
){

  text=
    clean(text);


  if(!text||ocaInterpretPending){
    return;
  }


  const wasCompleted=
    state.completed;


  const contactBefore=
    state.lead.contact;


  hideContextReplies();


  addMessage(
    'user',
    text,
    'Visitante'
  );

  // Atender perguntas comerciais sem consumir campos do diagnóstico.
  const approvedMatch=OCA_KNOWLEDGE?.match(text);
  const directAnswer=approvedMatch
    ?{text:approvedMatch.answer,context:{kind:'approved',id:approvedMatch.id}}
    :ADVISOR?.answerTurn(text,state.lead,state.faqContext);
  if(directAnswer){
    // Informações de contato fornecidas junto de uma dúvida comercial também
    // devem compor o lead, sem preencher problema/segmento indevidamente.
    const hadContact=Boolean(state.lead.contact);
    absorbContact(text);
    if(state.lead.contact!=='' && (!hadContact||state.lead.contact!==contactBefore)){
      state.contactDeclined=false;
      updatePreview();
    }
    state.faqContext=directAnswer.context;
    if(approvedMatch)ocaApprovedTopic=approvedMatch.id;
    const continueAfterContact=state.awaiting==='contact' && Boolean(state.lead.contact);
    agentSay(directAnswer.text,260,continueAfterContact?()=>askNext():undefined);
    return;
  }
  // Perguntas comerciais desconhecidas: IA escolhe somente ID aprovado.
  // Se faltar chave, saldo, rede ou confiança, o fluxo anterior segue intacto.
  if(mayAskOcaAi(text,meta,wasCompleted)){
    const epoch=ocaInterpretEpoch;
    ocaInterpretPending=true;
    if(el.input)el.input.disabled=true;
    setOcaStatus('Interpretando sua pergunta...');
    let matched=null;
    try{matched=await classifyOcaQuestion(text);}
    finally{
      if(epoch===ocaInterpretEpoch){
        ocaInterpretPending=false;
        if(el.input)el.input.disabled=false;
        setOcaStatus('');
      }
    }
    if(epoch!==ocaInterpretEpoch)return;
    if(matched){
      state.faqContext={kind:'approved',id:matched.id};
      ocaApprovedTopic=matched.id;
      agentSay(matched.answer,260);
      return;
    }
  }
  state.faqContext=null;

  /*
   * Depois que o diagnóstico terminou, ainda aceitamos telefone,
   * e-mail ou informação complementar sem reiniciar o fluxo nem
   * repetir a mensagem final do diagnóstico.
   */

  if(wasCompleted){

    absorbKnown(text);


    updatePreview();


    if(
      state.lead.contact !==
      contactBefore
    ){

      agentSay(
        'Contato atualizado. As novas informações foram adicionadas à oportunidade para continuidade do atendimento.',
        260
      );

    }else{

      agentSay(
        'Informação recebida e adicionada ao histórico desta oportunidade.',
        260
      );
    }


    return;
  }


  if(state.oca){
    if(!state.lead.problem){
      state.lead.problem=text;
    }
    absorbContact(text);
    askNext();
    return;
  }

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
  label,
  oca=false
){

  state.oca=oca;
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

    oca?OCA_SITE_OPENING:`Perfeito. Vou tratar isso como “${INTENT_LABELS[intent]}”. ${FIELD_QUESTIONS.problem}`,

    300,

    oca?undefined:()=>renderQuickReplies(
      'problem'
    )
  );
}



/* =========================================================
   REINICIAR CONVERSA
   ========================================================= */

function resetAgent(){
  ++ocaInterpretEpoch;
  ocaInterpretAbort?.abort();
  ocaInterpretAbort=null;
  ocaInterpretPending=false;
  ocaApprovedTopic='unknown';
  if(el.input)el.input.disabled=false;

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
  state.contactDeclined=false;
  state.faqContext=null;

  state.messages=[];


  state.completed=false;
  state.oca=false;
  setOcaStatus('');


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
      'Pergunte sobre nossos serviços ou descreva o que precisa...';
  }


  hideContextReplies();



  addMessage(

    'agent',

    'Olá! Sou o assistente da Lacrose Tecnologia. Posso explicar nossos serviços, conversar sobre seu projeto e informar os valores de lançamento previstos de LibertyOS e BarbarOS. O que você gostaria de saber ou resolver?',

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


      if(ocaInterpretPending)return;
      const text=
        el.input.value;


      el.input.value='';


      submitText(
        text
      );
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
    .querySelectorAll(
      '[data-start]'
    )
    .forEach(
      btn=>btn.addEventListener(
        'click',
        ()=>startIntent(
          btn.dataset.start,
          btn.querySelector('span')?.textContent,
          btn.hasAttribute('data-oca')
        )
      )
    );



  document
    .querySelectorAll(
      '[data-intent]'
    )
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
            'Tenho uma clínica de estética e quero automatizar e-mails para criar tarefas.'
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




  resetAgent();
}
