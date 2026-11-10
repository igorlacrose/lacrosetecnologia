'use strict';
(() => {
  const endpoint = 'https://icrtewhazpfauuroswri.supabase.co';
  const pubKey = 'sb_publishable_6PdAW2f-dpXhsaZXI0lyBg_PcGtuWgs';
  const byId = id => document.getElementById(id);
  const login = byId('loginScreen'), mfaScreen = byId('mfaScreen'), shell = byId('shell');
  const status = byId('status'), content = byId('content');
  const titles = {
    overview: ['Painel geral', 'Visão dos registros comerciais acessíveis.'],
    oca: ['OCA e oportunidades', 'Acompanhamento dos diagnósticos e revisões humanas.'],
    clients: ['Clientes', 'Contatos comerciais registrados.'],
    conversations: ['Atendimentos', 'Histórico preservado dos canais integrados.'],
    approvals: ['Aprovações', 'Pendências e exceções que aguardam decisão.'],
    account: ['Minha conta e segurança', 'Autenticação, acesso e encerramento de sessão.']
  };
  const state = {user:null, profile:null, current:'overview', search:'', leads:[],contacts:[],conversations:[],approvals:[],followups:[],selected:null,lastSync:null};
  let client = null, factorId = null, challengeId = null, idleTimer = null;
  const IDLE_MS = 30 * 60 * 1000;

  function el(tag, cls, value) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }
  function append(parent, ...children) {children.forEach(child => parent.appendChild(child));return parent;}
  function dateLabel(raw) {
    if(!raw) return '—';
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('pt-BR', {timeZone:'America/Bahia',dateStyle:'short',timeStyle:'short'}).format(d) : '—';
  }
  function feedback(message, error=false) {
    status.textContent = message || '';
    status.classList.toggle('error',error);
  }
  function authMessage(message) {byId('authFeedback').textContent = message || '';}
  function mfaMessage(message) {byId('mfaFeedback').textContent = message || '';}
  function closeMenu() {
    shell.classList.remove('menu-open');
    byId('toggleMenu').setAttribute('aria-expanded','false');
  }
  function clearState() {
    state.user=null;state.profile=null;state.leads=[];state.contacts=[];
    state.conversations=[];state.approvals=[];state.followups=[];state.selected=null;
    clearTimeout(idleTimer);content.replaceChildren();closeMenu();
    byId('password').value='';byId('mfaCode').value='';byId('qr').removeAttribute('src');
    byId('secret').textContent='';
  }
  function showLogin(message='') {
    clearState();shell.hidden=true;mfaScreen.hidden=true;login.hidden=false;
    authMessage(message);
  }
  async function signOut(message='Sessão encerrada.') {
    try {if(client) await client.auth.signOut();} catch {}
    showLogin(message);
  }
  function restartIdle() {
    if(!state.user) return;
    clearTimeout(idleTimer);
    idleTimer=setTimeout(() => signOut('Sessão encerrada por inatividade.'),IDLE_MS);
  }
  ['pointerdown','keydown'].forEach(type => document.addEventListener(type,restartIdle,{passive:true}));
  async function authenticateProfile(user) {
    const {data,error} = await client.from('profiles').select('full_name,role,active').eq('id',user.id).maybeSingle();
    if(error) throw error;
    if(!data || !data.active || !['master','admin'].includes(data.role)) throw new Error('Conta sem acesso administrativo.');
    return data;
  }
  async function beginMfa(profile,user) {
    state.user=user;state.profile=profile;
    const {data,error} = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if(error) throw error;
    if(data && data.currentLevel==='aal2') return enter();
    const {data:factors,error:fe}=await client.auth.mfa.listFactors();
    if(fe) throw fe;
    let factor = factors && factors.totp && factors.totp.find(x => x.status==='verified');
    if(!factor) {
      const {data:enroll,error:ee}=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'LKZ ADM 2.0'});
      if(ee) throw ee;
      factor=enroll;
      byId('enroll').hidden=false;
      byId('qr').src=enroll.totp.qr_code;
      byId('secret').textContent=enroll.totp.secret;
    } else {byId('enroll').hidden=true;}
    const {data:challenge,error:ce}=await client.auth.mfa.challenge({factorId:factor.id});
    if(ce) throw ce;
    factorId=factor.id;challengeId=challenge.id;
    login.hidden=true;mfaScreen.hidden=false;mfaMessage('');
  }
  async function enter() {
    const {data:aal,error}=await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if(error || !aal || aal.currentLevel!=='aal2') throw new Error('MFA necessário para abrir o painel.');
    const profile=await authenticateProfile(state.user);
    state.profile=profile;login.hidden=true;mfaScreen.hidden=true;shell.hidden=false;
    byId('profileLabel').textContent=profile.full_name || state.user.email || 'Administrador';
    restartIdle();await refreshData();
  }
  function metric(label,value,caption) {
    return append(el('article','metric'),el('small',null,label),el('strong',null,value),el('span',null,caption));
  }
  function panel(title) {return append(el('section','panel'),el('h2',null,title));}
  function empty(message) {return el('p','empty',message);}
  function row(title,subtitle,badge) {
    const base=el('div','item'), left=el('div','copy');
    append(left,el('strong',null,title),el('small',null,subtitle));
    append(base,left);
    if(badge) append(base,el('span','flag'+(badge==='Pendente'?' pending':''),badge));
    return base;
  }
  function searchMatches(...values) {
    const term=state.search.toLocaleLowerCase('pt-BR').trim();
    return !term || values.some(v=>String(v||'').toLocaleLowerCase('pt-BR').includes(term));
  }
  function labelStatus(s) {
    return ({new:'Novo',diagnosing:'Em diagnóstico',qualified:'Qualificado',human_review:'Revisão humana',contacted:'Contatado',proposal:'Proposta',won:'Fechado',lost:'Perdido',archived:'Arquivado',pending:'Pendente',approved:'Aprovado',rejected:'Rejeitado',completed:'Concluído',active:'Ativo'})[s]||s||'—';
  }
  function renderOverview() {
    const review=state.leads.filter(x=>x.needs_human_review||x.status==='human_review');
    const pending=state.approvals.filter(x=>x.status==='pending');
    const due=state.followups.filter(x=>x.status==='pending');
    const metrics=el('div','grid');
    append(metrics,metric('Contatos carregados',state.contacts.length,'Limite da consulta: 200'),metric('Oportunidades carregadas',state.leads.length,'Limite da consulta: 200'),metric('Revisões humanas',review.length,'Nos registros carregados'),metric('Aprovações pendentes',pending.length,'Nos registros carregados'));
    const sections=el('div','sections'), priorities=panel('Ações que exigem atenção'), connection=panel('Estado operacional');
    if(!pending.length&&!review.length&&!due.length) append(priorities,empty('Não foram encontradas pendências no conjunto carregado.'));
    pending.slice(0,6).forEach(x=>append(priorities,row('Aprovação pendente',x.action_type+' · '+dateLabel(x.requested_at),'Pendente')));
    review.slice(0,6).forEach(x=>append(priorities,row(x.problem||'Oportunidade a revisar',dateLabel(x.updated_at),'Revisar')));
    due.slice(0,6).forEach(x=>append(priorities,row('Retorno programado',dateLabel(x.due_at),'Pendente')));
    append(connection,el('p',null,'Dados consultados via Supabase após autenticação e MFA. Nenhuma operação financeira é simulada ou executada nesta versão.'));
    append(connection,el('div','warning','OCA atual: triagem e revisão humana. Negociação, cobrança e provisionamento automáticos ainda precisam ser homologados.'));
    append(sections,priorities,connection);
    append(content,metrics,sections);
  }
  function renderOca() {
    const grid=el('div','grid'), review=state.leads.filter(x=>x.status==='human_review'), qualified=state.leads.filter(x=>x.status==='qualified');
    append(grid,metric('Oportunidades',state.leads.length,'Carregadas'),metric('Qualificados',qualified.length,'Carregados'),metric('Revisão humana',review.length,'Carregados'),metric('Fechados',state.leads.filter(x=>x.status==='won').length,'Carregados'));
    const p=panel('Oportunidades reais'), matches=state.leads.filter(x=>searchMatches(x.problem,x.category,x.intent,x.status));
    append(p,el('p','search-help','Os dados de diagnóstico são indicadores, não decisões de cobrança.'));
    if(!matches.length) append(p,empty('Nenhum registro corresponde ao filtro.'));
    matches.slice(0,80).forEach(x=>append(p,row(x.problem||'Diagnóstico sem descrição',(x.category||x.intent||'Sem categoria')+' · '+dateLabel(x.updated_at),labelStatus(x.status))));
    append(content,grid,p);
  }
  function renderClients() {
    const p=panel('Contatos comerciais'), matches=state.contacts.filter(x=>searchMatches(x.person_name,x.company_name,x.email,x.phone,x.city));
    append(p,el('p','search-help','Dados do cadastro existente. Limite de 200 registros por atualização.'));
    if(!matches.length) append(p,empty('Nenhum contato encontrado no conjunto carregado.'));
    matches.forEach(x=>append(p,row(x.company_name||x.person_name||'Contato sem nome',(x.person_name&&x.company_name?x.person_name+' · ':'')+(x.email||x.phone||'Sem contato')+' · '+(x.city||'Sem cidade'),null)));
    append(content,p);
  }
  async function showConversation(conversationId, target) {
    target.replaceChildren(empty('Carregando histórico…'));
    const {data,error}=await client.from('messages').select('role,content,created_at,id').eq('conversation_id',conversationId).order('id',{ascending:false}).limit(100);
    if(state.selected!==conversationId||state.current!=='conversations') return;
    target.replaceChildren();
    if(error){append(target,empty('Não foi possível consultar as mensagens.'));feedback('Falha na consulta do histórico.',true);return;}
    if(!data||!data.length){append(target,empty('Não há mensagens neste registro.'));return;}
    const intro=el('p','search-help','Últimas '+data.length+' mensagens; conteúdo exibido como texto, sem execução de HTML.');
    append(target,intro);
    data.slice().reverse().forEach(m=>{
      const box=el('div','message'+(m.role==='user'?' user':''));
      append(box,el('small',null,(m.role==='user'?'Visitante':'Agente')+' · '+dateLabel(m.created_at)),el('div','message-body',m.content));
      append(target,box);
    });
  }
  function renderConversations() {
    const container=el('div','details'), list=panel('Atendimentos'), view=panel('Histórico');
    const matches=state.conversations.filter(x=>searchMatches(x.channel,x.status,x.id));
    append(list,el('p','search-help','Últimas 200 conversas carregadas.'));
    if(!matches.length) append(list,empty('Nenhum atendimento encontrado.'));
    matches.forEach(x=>{
      const b=el('button','list-button'+(state.selected===x.id?' active':''));b.type='button';
      append(b,el('strong',null,'Atendimento '+x.id.slice(0,8).toUpperCase()),el('small',null,(x.channel||'Site')+' · '+labelStatus(x.status)+' · '+dateLabel(x.last_message_at)));
      b.addEventListener('click',()=>{state.selected=x.id;render();});
      append(list,b);
    });
    if(state.selected && matches.some(x=>x.id===state.selected)) showConversation(state.selected,view);
    else append(view,empty('Selecione um atendimento para consultar as mensagens.'));
    append(container,list,view);append(content,container);
  }
  function renderApprovals() {
    const p=panel('Aprovações e exceções');
    const matches=state.approvals.filter(x=>searchMatches(x.action_type,x.status));
    append(p,el('p','search-help','Esta fase é somente leitura. As decisões serão disponibilizadas após validação de autorização e auditoria no backend.'));
    if(!matches.length) append(p,empty('Nenhuma aprovação corresponde ao filtro.'));
    matches.forEach(x=>append(p,row(x.action_type||'Decisão operacional',dateLabel(x.requested_at),labelStatus(x.status))));
    append(content,p);
  }
  function renderAccount() {
    const p=panel('Sessão administrativa'), profile=state.profile;
    append(p,row('Usuário',profile.full_name||state.user.email));
    append(p,row('Perfil',profile.role==='master'?'MASTER':'Administrador'));
    append(p,row('MFA','Exigido para acesso aos dados comerciais','Ativo'));
    append(p,row('Inatividade','Encerramento automático após 30 minutos'));
    append(p,el('p','search-help','Nenhuma credencial privada é persistida no armazenamento local por esta interface.'));
    append(content,p);
  }
  function render() {
    const title=titles[state.current]||titles.overview;
    byId('screenTitle').textContent=title[0];byId('screenSubtitle').textContent=title[1];
    document.querySelectorAll('[data-screen]').forEach(b=>b.classList.toggle('active',b.dataset.screen===state.current));
    content.replaceChildren();
    if(state.current==='overview') renderOverview();
    else if(state.current==='oca') renderOca();
    else if(state.current==='clients') renderClients();
    else if(state.current==='conversations') renderConversations();
    else if(state.current==='approvals') renderApprovals();
    else renderAccount();
  }
  async function refreshData() {
    if(!state.user) return;
    byId('refresh').disabled=true;
    feedback('Atualizando dados protegidos…');
    try {
      const results=await Promise.all([
        client.from('contacts').select('id,company_name,person_name,email,phone,city,updated_at').order('updated_at',{ascending:false}).limit(200),
        client.from('leads').select('id,contact_id,category,intent,problem,score,status,needs_human_review,updated_at').order('updated_at',{ascending:false}).limit(200),
        client.from('conversations').select('id,lead_id,channel,status,last_message_at').order('last_message_at',{ascending:false}).limit(200),
        client.from('approvals').select('id,lead_id,action_type,status,requested_at').order('requested_at',{ascending:false}).limit(200),
        client.from('followups').select('id,lead_id,status,due_at').order('due_at',{ascending:true}).limit(200)
      ]);
      const failure=results.find(x=>x.error);
      if(failure) throw failure.error;
      [state.contacts,state.leads,state.conversations,state.approvals,state.followups]=results.map(x=>x.data||[]);
      state.lastSync=new Date();byId('lastSync').textContent='Consulta: '+dateLabel(state.lastSync);
      feedback('Leitura concluída. Indicadores referentes aos registros carregados.');
      render();
    } catch(error) {
      feedback('Falha na consulta: verifique a sessão, MFA e permissões. Não houve alteração de dados.',true);
      content.replaceChildren(empty('Dados indisponíveis nesta sessão.'));
    } finally {byId('refresh').disabled=false;}
  }
  byId('loginForm').addEventListener('submit',async e=>{
    e.preventDefault();authMessage('');
    const button=byId('loginBtn');button.disabled=true;
    try {
      if(!window.supabase) throw new Error('Biblioteca de autenticação indisponível.');
      client=window.supabase.createClient(endpoint,pubKey,{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false}});
      const {data,error}=await client.auth.signInWithPassword({email:byId('email').value.trim(),password:byId('password').value});
      if(error) throw error;
      const p=await authenticateProfile(data.user);
      await beginMfa(p,data.user);
    } catch(error) {
      try{if(client) await client.auth.signOut();}catch{}
      showLogin('Não foi possível autenticar. Verifique credenciais e permissões.');
    } finally {button.disabled=false;}
  });
  byId('mfaForm').addEventListener('submit',async e=>{
    e.preventDefault();const button=byId('mfaBtn');button.disabled=true;mfaMessage('');
    try {
      const {error}=await client.auth.mfa.verify({factorId,challengeId,code:byId('mfaCode').value.trim()});
      if(error) throw error;
      await enter();
    } catch {mfaMessage('Código inválido, expirado ou conta sem permissão.');}
    finally {button.disabled=false;}
  });
  byId('cancelMfa').addEventListener('click',()=>signOut('Autenticação cancelada.'));
  byId('signout').addEventListener('click',()=>signOut());
  byId('refresh').addEventListener('click',refreshData);
  byId('search').addEventListener('input',e=>{state.search=e.target.value;render();});
  document.querySelectorAll('[data-screen]').forEach(b=>b.addEventListener('click',()=>{
    state.current=b.dataset.screen;state.search='';byId('search').value='';render();closeMenu();
  }));
  byId('toggleMenu').addEventListener('click',()=>{
    const isOpen=shell.classList.toggle('menu-open');byId('toggleMenu').setAttribute('aria-expanded',String(isOpen));
  });
  byId('backdrop').addEventListener('click',closeMenu);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
})();
