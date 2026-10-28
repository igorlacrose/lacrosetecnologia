import {evaluateDataQuality, QUALITY_STATUS} from './quality.js';
import {detectMapping, buildSnapshot, subjectGroups,radarItems,calculateCost,moneyBRL,sampleCost} from './engine.js';
import {readReport} from './importer.js';
import {buildEmployeeMetrics} from './employee-analytics.js';
import {getAllSnapshots,saveSnapshot,deleteSnapshots,getSetting,saveSetting} from './db.js';
import {GROUPS, PERMISSIONS, describeAccess, mayInvite} from './roles.js';
import {newBrand, validateBrandName, validateHexColor, validateDomain, prepareBrandImage, applyBrandPreview} from './branding.js';
import {encryptBackup, decryptBackup} from './backup.js';
import {CloudAccess} from './cloud-auth.js?v=120';
import {IDLE_LIMIT_MS} from './trusted-session.js';

const root=document.getElementById('app');
const IS_PUBLIC_HOMOLOGATION=location.protocol==='https:'; // gate externo: operações requerem RLS/MFA e leitura de volta
const cloud=new CloudAccess();
let lastActivity=Date.now();
let sessionEnding=false;
const cloudUi={busy:false,message:'',error:'',factors:[],secret:'',factorId:'',memberships:[],audit:[],invitations:[],invitationsLoading:false,recovery:false};
const state={view:'cloud',selectedTenant:null,cloudReady:false,snapshot:null,snapshots:[],staged:null,mapping:null,sourceName:'',demo:false,
 selectedSector:'Todos',selectedCity:'Todas',productivityTab:'sector',employeeMetrics:{},employeeLoading:false,employeeSectorFilter:'Todos',cost:{...sampleCost},menuOpen:false,importBusy:false,brand:newBrand(),backupStage:null,backupDownload:null,backupBusy:false,reviews:[],reviewIntent:null,reviewBusy:false,reviewError:''};
const ic=name=>`<svg class="icon" aria-hidden="true"><use href="#ic-${name}"></use></svg>`;
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const fmt=n=>new Intl.NumberFormat('pt-BR').format(Number(n)||0);
const pct=(n,d)=>d>0?(100*n/d).toFixed(1).replace('.',',')+'%':'—';
const sorted=(obj,k='pending')=>Object.entries(obj||{}).sort((a,b)=>(b[1][k]||0)-(a[1][k]||0));
const num=(n)=>Number.isFinite(n)?Math.max(0,n):0;
let toastTimer;
function toast(message,err=false){let el=document.getElementById('toast');if(!el){el=document.createElement('div');el.id='toast';document.body.appendChild(el)}el.textContent=message;el.className='toast'+(err?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.remove(),5500)}
function mockSnapshot(){
 const rows=[];const heads=['Status','Assunto','Setor','Cidade','Abertura','Fechamento','Prioridade'];
 const subjects=['FN-ENTREGA DE BOLETO','ST-ENTREGA DE BOLETO NSON','RT-SEM CONEXÃO','RT - MANUNTENÇÃO DB ALTO','RT-INSTALAÇÃO FIBRA OPTICA','RT-LENTIDÃO'];
 const sectors=['Técnicos Jequié','ENTREGADOR DE BOLETOS','Técnicos Itagiba','Financeiro','Call Center'];
 for(let i=0;i<590;i++){
  const p=i%7<5;const open=46305+(i%17)+((i%20)/24);const status=p?'Finalizada':(i%2?'Encaminhada':'Aberta');
  rows.push([status,subjects[(i*7+Math.floor(i/17))%subjects.length],sectors[(i+Math.floor(i/25))%sectors.length],['Jequié','Itagibá','Ipiaú'][i%3],open,p?open+(i%4===0?1.4:.3):null,'Normal']);
 }
 return buildSnapshot(rows,detectMapping(heads),{source:'SIMULAÇÃO FICTÍCIA — NÃO SÃO DADOS DO IXC'});
}
function current(){return state.snapshot;}
function getMenu(){
 let items=[['dashboard','dashboard','Dashboard'],['results','check','Central de Resultados'],['quality','alert','Dados necessários'],['tickets','activity','Atendimentos'],['radar','radar','Radar de Ineficiência'],['productivity','users','Produtividade'],['finance','finance','Custos e Financeiro'],['imports','upload','Importações'],['reports','file','Relatórios'],['access','lock','Grupos de acesso'],['users','users','Usuários e Permissões'],['settings','settings','Administração'],['cloud','cloud','Minha conta']];
 if(executiveMode())items=[['dashboard','dashboard','Visão geral'],['results','check','Avaliações'],['reports','file','Relatórios'],['cloud','cloud','Minha conta']];
 if(sectorMode())items=[['dashboard','dashboard','Meu setor'],['reports','file','Relatórios'],['cloud','cloud','Minha conta']];
 // Homologação online: sem acesso ao dashboard antes do MFA e vínculo global.
 // Perfis setoriais consultam exclusivamente snapshots minimizados pelo servidor, com MFA e vínculo.
 if (!canUseAggregateWorkspace()) items=items.filter(([v])=>v==='cloud');
 else {if(!canAdministerLocalWorkspace()) items=items.filter(([v])=>v!=='imports'&&v!=='settings'&&v!=='finance');
  if(!cloudUi.memberships.some(m=>['master','gestor','administrador'].includes(m.role)))items=items.filter(([v])=>v!=='users');}
 return `<aside class="sidebar ${state.menuOpen?'open':''}" id="sidebar">
  <div class="logo">${state.brand.logo?`<img class="brand-logo" src="${state.brand.logo}" alt="Logotipo da empresa">`:`LKZ<span class="mark">ISP</span>`}<small>${esc(state.brand.name)}</small></div>
  <div class="side-heading">GESTÃO E INTELIGÊNCIA</div>
  <nav aria-label="Navegação principal">${items.map(([view,icon,label])=>`<button class="side-link ${state.view===view?'active':''}" data-view="${view}">${ic(icon)}<span>${esc(label)}</span></button>`).join('')}</nav>
  <div class="side-bottom"><div class="mini">PROJETO</div><strong><span class="status-dot"></span>${esc(state.brand.name)}</strong><div class="tiny" style="color:#9cafc2">Gestão na nuvem · V1.0</div></div>
 </aside>`;
}
function isMfaLinked(){return cloud.hasSession && cloud.aal==='aal2' && cloudUi.memberships.length>0;}
function activeRole(){return cloudUi.memberships.find(m=>m.tenant_id===state.selectedTenant)?.role||null;}
function executiveMode(){return ['gestor','administrador'].includes(activeRole());}
function sectorMode(){return ['lider_setor','financeiro'].includes(activeRole());}
function canUseAggregateWorkspace(){return isMfaLinked()&&cloudUi.memberships.some(m=>['master','gestor','administrador','lider_setor','financeiro'].includes(m.role));}
function canAdministerLocalWorkspace(){return isMfaLinked()&&cloudUi.memberships.some(m=>m.role==='master');}
function clearWorkspace(){
 state.snapshots=[];state.snapshot=null;state.staged=null;state.mapping=null;state.demo=false;state.employeeMetrics={};
 state.cloudReady=false;state.selectedTenant=null;state.reviews=[];state.reviewIntent=null;state.reviewError='';
 deleteSnapshots().catch(()=>{});
}
function defaultTenant(){return cloudUi.memberships.find(m=>['master','gestor','administrador','lider_setor','financeiro'].includes(m.role))?.tenant_id||null;}
async function loadCloudWorkspace(tenantId=null){
 if(!canUseAggregateWorkspace()){clearWorkspace();return;}
 const authorized=cloudUi.memberships.filter(m=>['master','gestor','administrador','lider_setor','financeiro'].includes(m.role));
 const chosen=tenantId||state.selectedTenant||defaultTenant();
 const membership=authorized.find(m=>m.tenant_id===chosen);
 if(!membership)throw Error('A empresa selecionada não está autorizada.');
 state.cloudReady=false;
 state.snapshots=[];state.snapshot=null;state.demo=false;state.employeeMetrics={};state.reviews=[];state.reviewIntent=null;
 // Somente a consulta setorial filtra os dados no servidor. Nunca consultar agregados globais para líderes/financeiro.
 const scoped=['lider_setor','financeiro'].includes(membership.role);
 const records=scoped?await cloud.listSectorSnapshots(chosen):await cloud.listAggregateSnapshots(chosen);
 const reviews=(!scoped&&membership.role!=='master')?await cloud.listSnapshotReviews(chosen):[];
 state.selectedTenant=chosen;state.snapshots=records;state.snapshot=records[0]||null;state.reviews=reviews;
 state.cloudReady=true;state.view='dashboard';
}
function canImportToCloud(){return state.cloudReady&&Boolean(state.selectedTenant)&&canAdministerLocalWorkspace()&&navigator.onLine;}
function shell(body){
 return `<div class="shell">${getMenu()}<main class="main"><header class="topbar"><div class="brand-top"><span>${esc(state.brand.name)}</span><span>›</span><span class="crumb">Intelligence</span></div><div class="top-right">
 <button class="btn responsive-toggle" data-action="menu" aria-label="Abrir menu">${ic('menu')}</button>
 <span class="pill ${navigator.onLine?'gray':'amber'}">${navigator.onLine?'● Navegador online':'● Sem internet'}</span>
 <span class="pill ${state.cloudReady?'green':'amber'}">${ic('cloud')} ${state.cloudReady?'Dados sincronizados':'Nuvem não conectada'}</span><span class="pill amber">MFA obrigatório · dados brutos não enviados</span>${canAdministerLocalWorkspace()?`<button class="btn session-end" data-action="backup-open">Finalizar e salvar</button>`:`<button class="btn session-end" data-cloud="logout">Sair com segurança</button>`}<span class="avatar">LKZ</span></div></header>
 <div class="content">${body}</div><footer class="lkz-footer" role="contentinfo"><a href="https://lacrosetecnologia.com.br/" target="_blank" rel="noopener noreferrer">Desenvolvido por Lacrose Tecnologia</a></footer></main></div>${backupDialog()}`;
}
function backupDialog(){
 if(!state.backupStage)return '';
 let inner='';
 if(state.backupStage==='create')inner=`<h2>Baixar backup e encerrar sessão</h2><p>Baixe um backup <strong>criptografado</strong> dos indicadores agregados desta sessão. Não inclui arquivos IXC, nomes, senhas ou dados individuais.</p><p class="notice warning">Fechar a aba não garante download. Utilize este botão e confira o arquivo antes de finalizar. A senha de backup não será armazenada e não poderá ser recuperada.</p><label class="field">Frase secreta do backup (mínimo 16 caracteres)<input id="backup-pass" type="password" autocomplete="new-password" minlength="16" maxlength="200" /></label><label class="field">Repita a frase secreta<input id="backup-confirm" type="password" autocomplete="new-password" minlength="16" maxlength="200" /></label><div class="action-row"><button class="btn primary" data-action="backup-download" ${state.backupBusy?'disabled':''}>Criptografar e baixar</button><button class="btn" data-action="backup-cancel">Cancelar</button></div>`;
 if(state.backupStage==='verify')inner=`<h2>Confira o arquivo baixado</h2><p>Verifique na pasta de downloads se o backup <strong>.lkzbackup.json</strong> foi salvo. Não temos como confirmar automaticamente que o navegador concluiu o download.</p><p class="notice warning"><b>Importante:</b> guarde a frase secreta em local seguro separado do backup. Sem ela, não será possível restaurar.</p><div class="action-row"><button class="btn" data-action="backup-redownload">Baixar novamente</button><button class="btn primary" data-action="backup-finish">Confirmei o arquivo: finalizar avaliação</button><button class="btn" data-action="backup-cancel">Não finalizar</button></div>`;
 if(state.backupStage==='restore')inner=`<h2>Restaurar backup local</h2><p>Somente backups criptografados de indicadores agregados. A restauração nesta versão é permitida apenas no aplicativo local; não modifica a nuvem.</p><label class="field">Selecione arquivo .lkzbackup.json<input id="backup-restore-file" type="file" accept=".json,application/json" /></label><label class="field">Frase secreta do backup<input id="backup-restore-pass" type="password" autocomplete="off" /></label><div class="action-row"><button class="btn primary" data-action="backup-restore">Descriptografar e restaurar</button><button class="btn" data-action="backup-cancel">Cancelar</button></div>`;
 return `<div class="backup-overlay" role="dialog" aria-modal="true" aria-label="Backup local protegido"><section class="backup-modal card">${inner}</section></div>`;
}
const heading=(title,desc,button=true)=>`<div class="page-head"><div><h1>${esc(title)}</h1><p>${esc(desc)}</p></div><div class="action-row">${button?`<button class="btn" data-view="reports">${ic('file')} Relatório</button><button class="btn primary" data-view="imports">${ic('upload')} Importar planilha</button>`:''}</div></div>`;
const noData=()=>`<section class="empty">${ic('upload')}<h3>Nenhum relatório importado</h3><p>Importe um relatório do IXC ou explore a demonstração fictícia.<br/>Só indicadores agregados autorizados serão enviados ao ambiente seguro.</p><button class="btn primary" data-view="imports">Importar XLSX/CSV</button> <button class="btn" data-action="demo">Ver exemplo fictício</button></section>`;
const dataBanner=()=>state.demo?'<div class="notice warning"><b>MODO DEMONSTRAÇÃO FICTÍCIA:</b> todos os números abaixo são simulados e não foram extraídos do seu provedor. Esta simulação nunca é gravada no ambiente seguro.</div>':'<div class="notice"><b>Indicadores confirmados no ambiente seguro:</b> histórico agregado da empresa selecionada, carregado após MFA e controle RLS. Arquivos originais do IXC não foram enviados. Os números retratam a data da exportação e não o status em tempo real.</div>';
const cardKpi=(label,value,detail,icon,tone='blue')=>`<div class="card kpi"><div class="kpi-top"><span>${esc(label)}</span><span class="icon-sq ${tone}">${ic(icon)}</span></div><strong>${esc(value)}</strong><div class="kpi-foot">${esc(detail)}</div></div>`;
function dailyChart(s){
 const days=Object.entries(s.daily||{}).sort((a,b)=>a[0].localeCompare(b[0]));const max=Math.max(1,...days.map(([,v])=>v.total));
 return `<div class="bar-chart" role="img" aria-label="Atendimentos por dia: barras azuis finalizados e verdes pendentes">${days.map(([day,g],i)=>`<div class="bar-slot" title="${esc(day)}: ${g.total} registros"><div class="bar blue" style="height:${Math.max(1,100*g.finalized/max)}%"></div><div class="bar green" style="height:${Math.max(1,100*g.pending/max)}%"></div></div>`).join('')}</div><div class="chart-legend"><span><i class="dot" style="background:#2a91ea"></i>Finalizados</span><span><i class="dot" style="background:#23b788"></i>Não finalizados</span><span>${esc(s.earliest||'—')} a ${esc(s.latest||'—')}</span></div>`;
}
function donut(s){
 const closed=s.finalized,open=s.pending,p=s.total?100*closed/s.total:0;
 return `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(#27b57d 0% ${p}%, #478af1 ${p}% 100%)"><div class="donut-hole"><strong>${fmt(s.total)}</strong><span>atendimentos</span></div></div><div style="min-width:155px"><div class="legend-item"><i class="dot" style="background:#27b57d"></i>Finalizados <b>${fmt(closed)}</b></div><div class="legend-item"><i class="dot" style="background:#478af1"></i>Não finalizados <b>${fmt(open)}</b></div><div class="legend-item"><i class="dot" style="background:#e4e8ee"></i>Taxa encerrada <b>${pct(closed,s.total)}</b></div></div></div>`;
}
const pendingTable=(items,limit=8)=>`<div class="table-scroll"><table><thead><tr><th>Categoria</th><th class="num">Total</th><th class="num">Finalizados</th><th class="num">Pendentes</th><th>Proporção</th></tr></thead><tbody>${items.slice(0,limit).map(([name,g])=>`<tr><td><strong>${esc(name)}</strong></td><td class="num">${fmt(g.total)}</td><td class="num">${fmt(g.finalized)}</td><td class="num"><span class="badge ${g.pending/g.total>=.4?'red':'orange'}">${fmt(g.pending)}</span></td><td style="min-width:110px"><div class="progress-track"><div class="progress-fill ${g.pending/g.total>.4?'danger':'warn'}" style="width:${Math.min(100,100*g.pending/g.total)}%"></div></div><span class="tiny muted">${pct(g.pending,g.total)}</span></td></tr>`).join('')}</tbody></table></div>`;
function dashboard(){const s=current();if(sectorMode())return sectorDashboard();if(executiveMode())return executiveDashboard();return heading('Dashboard','Visão executiva, desempenho e oportunidades de melhoria.')+(!s?noData():dataBanner()+`
 <div class="cards">${cardKpi('Atendimentos',fmt(s.total),'Total no arquivo','activity')}${cardKpi('Finalizados',fmt(s.finalized),pct(s.finalized,s.total)+' do total','check','green')}${cardKpi('Não finalizados',fmt(s.pending),pct(s.pending,s.total)+' dos atendimentos','alert','red')}${cardKpi('Pendências acima de 7 dias',fmt(s.pendingOlder7d),'Idade na data de referência do relatório','clock','orange')}</div>
 <div class="grid-2"><section class="card card-pad"><div class="section-head"><div><h2>Volume de atendimentos</h2><p>Distribuição diária de registros</p></div><span class="pill gray">${esc(s.latest||'—')}</span></div>${dailyChart(s)}</section><section class="card card-pad"><div class="section-head"><div><h2>Status dos atendimentos</h2><p>Fotografia da exportação</p></div></div>${donut(s)}</section></div>
 <div class="grid-2"><section class="card card-pad"><div class="section-head"><div><h2>Assuntos que exigem atenção</h2><p>Ordenados por quantidade pendente</p></div><button class="btn ghost" data-view="tickets">Ver todos ${ic('arrow')}</button></div>${pendingTable(sorted(subjectGroups(s)),6)}</section><section class="card card-pad"><div class="section-head"><div><h2>Radar de Ineficiência</h2><p>Alertas gerados com regras verificáveis</p></div><span class="badge red">${fmt(radarItems(s).length)} sinais</span></div>${radarItems(s).slice(0,3).map(r=>`<div class="radar-item"><div class="heading"><h3>${esc(r.name)}</h3><span class="badge ${r.priority==='Alta'?'red':'orange'}">${esc(r.priority)}</span></div><p>${esc(r.evidence)}</p></div>`).join('')||'<p class="muted">Nenhum alerta acima do limite configurado.</p>'}<button class="btn ghost" data-view="radar">Abrir Radar ${ic('arrow')}</button></section></div>
 <p class="footnote">Não são calculados faturamento, lucro, perdas em reais nem SLA sem relatórios e definições confiáveis para esses indicadores.</p>`);
}
function sectorDashboard(){
 const s=current();
 return heading('Meu setor','Resultados somente do seu setor autorizado.',false)+
 (!s?'<section class="card card-pad"><h2>Sem dados do seu setor</h2><p>Não existem relatórios setoriais disponíveis para o seu vínculo. Solicite ao responsável pela importação que confira o nome do setor.</p></section>':
 '<div class="executive-welcome"><span class="executive-eyebrow">VISÃO SETORIAL</span><h2>'+esc(s.sectorName)+'</h2><p>Indicadores exclusivos do seu setor no período '+esc(s.earliest||'—')+' a '+esc(s.latest||'—')+'.</p></div>'+
 '<div class="cards executive-kpis">'+
 cardKpi('Atendimentos do setor',fmt(s.total),'Total da exportação','activity')+
 cardKpi('Concluídos',fmt(s.finalized),pct(s.finalized,s.total)+' do setor','check','green')+
 cardKpi('Pendentes',fmt(s.pending),'Aguardam acompanhamento','clock','orange')+
 cardKpi('Conclusão',pct(s.finalized,s.total),'No período exportado','chart')+'</div>'+
 '<section class="card card-pad"><h2>Situação do setor</h2>'+donut(s)+'</section>'+
 '<div class="executive-actions"><button class="btn primary" data-view="reports">Gerar relatório do meu setor</button></div>'+
 '<p class="footnote">Os dados do setor foram filtrados pelo servidor. Não incluem atendimentos individuais nem outros setores.</p>');
}
function executiveDashboard(){
 const s=current(),role=activeRole(),signals=s?radarItems(s):[];
 return heading('Visão geral','Indicadores essenciais para decisões rápidas.',false)+
 '<div class="executive-welcome"><span class="executive-eyebrow">PAINEL EXECUTIVO</span><h2>Como está a operação?</h2><p>Informações consolidadas do último relatório importado. Não são dados em tempo real.</p></div>'+
 (!s?'<section class="card card-pad"><h2>Aguardando indicadores</h2><p class="muted">Ainda não existem dados autorizados para apresentar.</p></section>':dataBanner()+
 '<div class="cards executive-kpis">'+
 cardKpi('Atendimentos',fmt(s.total),'Registros do período','activity')+
 cardKpi('Concluídos',pct(s.finalized,s.total),fmt(s.finalized)+' atendimentos','check','green')+
 cardKpi('Pendentes',fmt(s.pending),'Precisam de acompanhamento','clock','orange')+
 cardKpi('Atrasados há mais de 7 dias',fmt(s.pendingOlder7d),'Na data da exportação','alert','red')+'</div>'+
 '<div class="grid-2"><section class="card card-pad"><h2>Panorama dos atendimentos</h2>'+donut(s)+'</section>'+
 '<section class="card card-pad"><h2>Movimento diário</h2>'+dailyChart(s)+'</section></div>'+
 '<section class="card card-pad"><div class="section-head"><div><h2>O que merece atenção?</h2><p>Alertas calculados com base nos dados disponíveis.</p></div><span class="badge orange">'+fmt(signals.length)+' alertas</span></div>'+
 (signals.slice(0,4).map(x=>'<div class="radar-item"><strong>'+esc(x.name)+'</strong><p>'+esc(x.evidence)+'</p></div>').join('')||'<p class="muted">Nenhum alerta identificado pelos critérios atuais.</p>')+'</section>'+
 '<div class="executive-actions"><button class="btn primary" data-view="reports">Gerar relatório</button>'+
 (role==='gestor'?'<button class="btn" data-view="results">Avaliar resultados</button>':'')+'</div>'+
 '<p class="footnote">Os resultados não comprovam responsabilidade individual e devem ser interpretados com contexto operacional.</p>');
}
function tickets(){const s=current();return heading('Atendimentos','Análise por assunto, setor, cidade e status.')+(!s?noData():dataBanner()+`
 <div class="cards">${cardKpi('Total',fmt(s.total),'Registros válidos','activity')}${cardKpi('Finalizados',fmt(s.finalized),pct(s.finalized,s.total),'check','green')}${cardKpi('Pendentes',fmt(s.pending),pct(s.pending,s.total),'alert','red')}${cardKpi('Fechamento acima de 24h',fmt(s.closedOver24),'Entre os finalizados com datas válidas','clock','orange')}</div>
 <div class="grid-2 even"><section class="card card-pad"><div class="section-head"><h2>Pendências por assunto</h2></div>${pendingTable(sorted(subjectGroups(s)),30)}</section><section class="card card-pad"><div class="section-head"><h2>Pendências por cidade</h2></div>${pendingTable(sorted(s.cities),20)}</section></div><section class="card card-pad"><div class="section-head"><h2>Setores</h2></div>${pendingTable(sorted(s.sectors),30)}</section>
 <p class="footnote">O indicador “fechamento acima de 24h” é duração cronológica calculada, não descumprimento oficial de SLA. O arquivo exportado pode conter registros incompletos.</p>`);
}
function radar(){const s=current();const items=s?radarItems(s):[];return heading('Radar de Ineficiência','Gargalos identificados com evidências e ações recomendadas.')+(!s?noData():dataBanner()+`
 <div class="cards">${cardKpi('Sinais encontrados',fmt(items.length),'Regras analíticas explicáveis','radar','red')}${cardKpi('Alta prioridade',fmt(items.filter(x=>x.priority==='Alta').length),'Verificar com gestor','alert','orange')}${cardKpi('Pendências antigas',fmt(s.pendingOlder7d),'Acima de sete dias na fotografia','clock')}${cardKpi('Impacto financeiro','Não calculado','Faltam custos e receitas','finance')}</div>
 <section class="card card-pad"><div class="section-head"><div><h2>Problemas detectados</h2><p>São hipóteses a investigar, não atribuição automática de culpa ou perda.</p></div></div>${items.map((r,i)=>`<div class="radar-item"><div class="heading"><h3>${i+1}. ${esc(r.category)} · ${esc(r.name)}</h3><span class="badge ${r.priority==='Alta'?'red':'orange'}">${esc(r.priority)} prioridade</span></div><p><b>Evidência:</b> ${esc(r.evidence)}</p><div class="action"><b>Ação recomendada:</b> ${esc(r.action)}</div></div>`).join('')||'<div class="empty">Nenhum gargalo ultrapassou os critérios iniciais.</div>'}</section>`);
}
function employeeProductivity(){
 const s=current();if(!s)return noData();
 const records=state.employeeMetrics[s.fingerprint];
 if(!records){
  return '<div class="notice"><b>Produtividade por colaborador:</b> os nomes e indicadores ficam separados dos dados de clientes e são acessíveis apenas a gestores autorizados após MFA.</div>'+
   '<section class="card card-pad"><h2>Atendimentos por colaborador</h2><p class="muted">Os indicadores individuais são consultados exclusivamente no ambiente seguro, usando seu perfil de acesso.</p>'+
   '<button class="btn primary" data-load-employees="true" '+(state.employeeLoading?'disabled':'')+'>'+(state.employeeLoading?'Consultando…':'Consultar colaboradores deste relatório')+'</button></section>';
 }
 const sectors=['Todos',...new Set(records.map(x=>x.sector))].sort((a,b)=>a==='Todos'?-1:b==='Todos'?1:a.localeCompare(b,'pt-BR'));
 const sector=sectors.includes(state.employeeSectorFilter)?state.employeeSectorFilter:'Todos';
 const list=records.filter(x=>sector==='Todos'||x.sector===sector).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
 const total=list.reduce((v,x)=>v+x.total,0),closed=list.reduce((v,x)=>v+x.finalized,0);
 return '<div class="notice"><b>Informações restritas de colaboradores:</b> nomes e desempenho operacional são acessíveis apenas aos perfis gerenciais autorizados. Nenhum dado identificável de cliente é incluído. Comparações exigem considerar carga, função, complexidade e horas trabalhadas.</div>'+
 '<div class="cards">'+cardKpi('Colaboradores',fmt(new Set(list.map(x=>x.name)).size),'Com atendimentos atribuídos','users')+
 cardKpi('Atendimentos atribuídos',fmt(total),'Somente equipe filtrada','activity')+
 cardKpi('Finalizados',fmt(closed),'Não equivale sozinho a desempenho','check','green')+
 cardKpi('Sem atribuição',fmt(Math.max(0,(s.total||0)-state.employeeMetrics[s.fingerprint].reduce((v,x)=>v+x.total,0))),'Sem responsável válido no relatório','alert','orange')+'</div>'+
 '<section class="card card-pad"><div class="section-head"><div><h2>Desempenho operacional identificado</h2><p>Contagens por pessoa e setor; nenhuma bonificação ou penalidade é automática.</p></div></div>'+
 '<label class="field" style="max-width:300px;margin-bottom:18px">Filtrar setor<select id="employee-sector">'+sectors.map(x=>'<option value="'+esc(x)+'" '+(x===sector?'selected':'')+'>'+esc(x)+'</option>').join('')+'</select></label>'+
 (list.length?'<div class="table-scroll"><table><thead><tr><th>Colaborador</th><th>Setor</th><th class="num">Atribuídos</th><th class="num">Concluídos</th><th class="num">Pendentes</th><th class="num">Abertos há +7 dias</th><th class="num">Fechamento +24h</th><th>Taxa de conclusão*</th></tr></thead><tbody>'+
 list.map(x=>'<tr><td><strong>'+esc(x.name)+'</strong></td><td>'+esc(x.sector)+'</td><td class="num">'+fmt(x.total)+'</td><td class="num">'+fmt(x.finalized)+'</td><td class="num">'+fmt(x.pending)+'</td><td class="num">'+fmt(x.pendingOlder7d)+'</td><td class="num">'+fmt(x.closedOver24)+'</td><td>'+(x.total>=5?pct(x.finalized,x.total):'Amostra pequena')+'</td></tr>').join('')+
 '</tbody></table></div>':'<div class="empty">Nenhum colaborador identificado para este relatório. Confira se a coluna Colaborador foi mapeada na importação.</div>')+
 '<p class="footnote" style="margin-top:16px">* Taxa de conclusão considera o estoque exportado, não produtividade por hora. Fechamento acima de 24h é duração cronológica, não violação oficial de SLA. Avaliações, treinamento e bônus exigem critérios definidos e revisão humana.</p>'+
 '<div class="action-row" style="margin-top:14px"><button class="btn" data-load-employees="true">Atualizar dados individuais</button></div></section>';
}
async function loadEmployeeMetrics(){
 const s=current();
 if(!s||!canUseAggregateWorkspace()||!state.selectedTenant||!s.fingerprint||state.employeeLoading)return;
 state.employeeLoading=true;render();
 try{
  const rows=await cloud.readEmployeeMetrics(state.selectedTenant,s.fingerprint);
  state.employeeMetrics[s.fingerprint]=rows;
 }catch(err){toast(err?.message||'Não foi possível consultar dados individuais.',true);}
 finally{state.employeeLoading=false;render();}
}
function productivity(){const s=current();return heading('Produtividade','Produtividade de setores e colaboradores, sem rankings injustos.')+`
 <div class="subtabs"><button class="subtab ${state.productivityTab==='sector'?'active':''}" data-productivity="sector">Por setor</button><button class="subtab ${state.productivityTab==='person'?'active':''}" data-productivity="person">Por colaborador</button></div>`+
 (state.productivityTab==='person'?employeeProductivity():
 (!s?noData():dataBanner()+`<div class="cards">${cardKpi('Setores reconhecidos',fmt(Object.keys(s.sectors||{}).length),'Categorias canônicas','users')}${cardKpi('Concluídos',fmt(s.finalized),'No período exportado','check','green')}${cardKpi('Em aberto',fmt(s.pending),'Sem atribuição individual','clock','orange')}${cardKpi('Índice de eficiência','A definir','Requer jornada, complexidade e metas','chart')}</div><section class="card card-pad"><div class="section-head"><div><h2>Fluxo operacional por setor</h2><p>Volume e pendências — não representam sozinho produtividade ou desempenho.</p></div></div>${pendingTable(sorted(s.sectors,'total'),30)}</section><div class="notice warning" style="margin-top:16px"><b>Atenção:</b> setores executam tarefas de complexidades distintas. Comparações justas exigem jornada, capacidade, tipo de atendimento, dificuldade e motivos externos de atraso.</div>`));
}
function finance(){
 const entries=[['hours','Tempo trabalhado (horas)'],['hourCost','Custo por hora (R$)'],['travel','Deslocamento (R$)'],['materials','Materiais (R$)'],['overhead','Rateio indireto (R$)']];
 return heading('Custos e Financeiro','Primeiro instrumento manual de simulação e parametrização.')+`
 <div class="notice warning"><b>Fonte ainda não integrada:</b> o relatório atual do IXC é operacional. O sistema não calcula receita, lucro ou custo real de clientes sem dados financeiros complementares. Este simulador não está vinculado a nenhum cliente.</div>
 <div class="grid-2 even"><section class="card card-pad"><div class="section-head"><div><h2>Calculadora de custo por atendimento</h2><p>Componentes informados manualmente</p></div></div><div class="cost-grid">${entries.map(([key,label])=>`<label class="field">${esc(label)}<input type="text" inputmode="decimal" data-cost="${key}" value="${esc(state.cost[key])}" autocomplete="off" maxlength="15" /></label>`).join('')}</div><div class="cost-total"><span>Estimativa calculada</span><strong id="cost-result">${esc(moneyBRL(calculateCost(state.cost)))}</strong></div><p class="footnote">O valor só será considerado exato quando todos os custos relevantes forem medidos. Valores temporários, perdidos ao recarregar a página.</p></section>
 <section class="card card-pad"><div class="section-head"><div><h2>Próximos relatórios previstos</h2><p>Importação modular por tipo de fonte</p></div></div><div class="safe-list">${['Faturamento e receitas por competência','Contas a pagar, despesas e centros de custo','Custos diretos, indiretos e deslocamentos','Horas trabalhadas e capacidade por setor','Indicadores financeiros e custo médio por atendimento','Histórico e custo por cliente pseudonimizado'].map(x=>`<div>${ic('clock')}<span>${esc(x)} <span class="badge orange">Planejado</span></span></div>`).join('')}</div></section></div>`;
}
function mappingForm(){const stage=state.staged;if(!stage)return '';
 const fields=['Status','Assunto','Abertura','Setor','Cidade','Fechamento','Prioridade','Colaborador'];
 return `<section class="card card-pad" style="margin-top:17px"><div class="section-head"><div><h2>Validar mapeamento de colunas</h2><p>${fmt(stage.rows.length)} linhas identificadas. Não mostramos valores da planilha para proteger os dados.</p></div><button class="btn" data-action="cancel-stage">Cancelar</button></div><div class="privacy-banner">${ic('lock')} Os dados brutos estão temporariamente na memória do navegador. Somente indicadores operacionais agregados e nomes de colaboradores são transmitidos ao ambiente seguro após validação. Os dados pessoais dos clientes nunca são incluídos.</div><div class="mapping-grid">${fields.map(f=>`<label class="field">${esc(f)}${['Status','Assunto','Abertura'].includes(f)?' *':''}<select data-map="${f}"><option value="-1">Não mapear</option>${stage.headers.map((h,i)=>Object.values(detectMapping(stage.headers)).includes(i)?`<option value="${i}" ${state.mapping[f]===i?'selected':''}>${esc(h||'Coluna '+(i+1))}</option>`:'').join('')}</select></label>`).join('')}</div><div class="action-row" style="margin-top:20px"><button class="btn primary" data-action="process-file">${ic('lock')} Processar e salvar no ambiente seguro</button><button class="btn" data-action="cancel-stage">Descartar arquivo</button></div></section>`;
}
function imports(){return heading('Importar relatório','XLSX/CSV do IXC · processamento local antes de qualquer armazenamento.',false)+`
 <div class="columns"><section class="card card-pad"><div class="section-head"><div><h2>Selecione um arquivo</h2><p>Suporte inicial a relatórios de atendimentos do IXC. Modelos financeiros, comerciais ou desconhecidos exigem um mapeamento específico antes de gerar indicadores.</p></div></div>
 <div class="upload-zone" id="drop-zone"><span class="icon-sq blue">${ic('upload')}</span><b>Arraste o arquivo aqui ou selecione no dispositivo</b><p>Somente XLSX ou CSV · Até 15 MB<br/>O arquivo original não sai do navegador.</p><button class="btn primary" data-action="choose-file">Selecionar arquivo</button></div><input type="file" id="file-input" accept=".xlsx,.csv" hidden />
 <p class="footnote" style="margin-top:12px">Os arquivos são processados apenas no navegador. Indicadores agregados padronizados serão salvos no ambiente seguro com autenticação, MFA, RLS e auditoria.</p>
 </section><section class="card card-pad"><div class="section-head"><div><h2>${ic('lock')} Proteção na importação</h2></div></div>
 <div class="safe-list">${['Arquivo bruto não enviado ou armazenado','Descartar Cliente, CPF, telefone e endereço','Descartar login, senha, hashes e tokens','Ignorar campos de mensagem e texto livre','Aceitar somente categorias padronizadas','Registrar métricas individuais dos colaboradores com acesso gerencial restrito'].map(x=>`<div>${ic('check')}<span>${esc(x)}</span></div>`).join('')}</div><div class="notice warning" style="margin-top:17px;margin-bottom:0"><b>Clientes protegidos:</b> o nome do colaborador é usado exclusivamente para gestão de produtividade, sob RLS/MFA. Nome e contato de clientes, login e senha não são enviados.</div></section></div>
 ${mappingForm()}
 <section class="card card-pad" style="margin-top:17px"><div class="section-head"><div><h2>Histórico na nuvem</h2><p>Indicadores persistidos e recuperados do ambiente de gestão</p></div></div>${state.snapshots.length?`<div class="timeline">${state.snapshots.map(s=>`<div class="timeline-row"><span><strong>${esc(s.source)}</strong><br/><span class="tiny muted">${esc(new Date(s.importedAt).toLocaleString('pt-BR'))} · ${fmt(s.total)} registros</span></span><button class="btn" data-snapshot="${esc(s.id)}">Abrir</button></div>`).join('')}</div>`:'<p class="muted">Nenhum indicador foi gravado para esta empresa no ambiente seguro.</p>'}</section>`;
}
function reports(){const s=current();return heading('Relatórios executivos','Imprima ou exporte somente indicadores autorizados para sua conta.',false)+(!s?'<section class="card card-pad"><h2>Nenhum relatório disponível</h2><p class="muted">Aguarde a importação autorizada de indicadores.</p></section>':dataBanner()+
 '<section class="card card-pad executive-report"><div class="section-head"><div><h2>Resumo operacional consolidado</h2><p>Referência: '+esc(s.earliest||'—')+' a '+esc(s.latest||'—')+'</p></div></div>'+
 '<div class="cards">'+cardKpi('Atendimentos',fmt(s.total),'Total','activity')+cardKpi('Concluídos',fmt(s.finalized),pct(s.finalized,s.total),'check','green')+cardKpi('Pendentes',fmt(s.pending),'Não finalizados','clock','orange')+'</div>'+
 '<h3>Distribuição por setor</h3>'+pendingTable(sorted(s.sectors,'total'),50)+
 '<p class="footnote">Dados consolidados da exportação, não representam informações em tempo real. Relatório sem dados pessoais.</p></section>'+
 '<div class="action-row executive-report-actions"><button class="btn primary" data-action="print-report">Imprimir / salvar PDF</button><button class="btn" data-action="export">Baixar CSV</button></div>');
}
function access(){
 const headers=['Dashboard setorial','Todos os setores','Financeiro do setor','Ajuste financeiro*','Configurar White Label','Convites comuns','Convidar Gestor','Auditoria regular','Auditoria MASTER'];
 return heading('Grupos de acesso','Perfis padronizados · autorização real será verificada no backend e no banco.',false)+`
 <div class="notice warning"><b>Funcionalidades liberadas:</b> identidade com MFA, consulta e gravação de agregados no ambiente seguro sob RLS, histórico e auditoria. Convites ainda não enviam mensagens nem concedem vínculos; ajustes financeiros, decisões e planos corretivos aguardam APIs autorizadas.</div>
 <section class="card card-pad"><div class="section-head"><div><h2>Cinco perfis e convites controlados</h2><p>MASTER e Gestor podem solicitar convites a Gestores; Administrador só solicita outros grupos. Vínculo efetivo exige confirmação segura no backend.</p></div></div>
 <div class="table-scroll"><table><thead><tr><th>Grupo</th>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
 ${GROUPS.map(g=>`<tr><td><strong>${esc(g.name)}</strong><div class="tiny muted">${esc(g.description)}</div></td>${PERMISSIONS.map(perm=>`<td><span class="badge ${describeAccess(g.id,perm)==='Permitido'?'green':'orange'}">${describeAccess(g.id,perm)}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
 <section class="card card-pad" style="margin-top:17px"><h2>Regras obrigatórias</h2><div class="safe-list">
 <div>${ic('lock')}<span>Líder e Financeiro: filtros por setor são aplicados na consulta do servidor, e não apenas no navegador.</span></div>
 <div>${ic('lock')}<span>Administrador: dados globais somente leitura, mas pode convidar usuários comuns. Gestor também pode convidar Gestores. MASTER é autoridade global, não pode ser criado por outros usuários.</span></div>
 <div>${ic('lock')}<span>Registros financeiros são append-only; correção exige justificativa, comprovante, autoria e histórico. Acesso financeiro dependerá de função de backend autenticada.</span></div>
 <div>${ic('lock')}<span>Correção e exclusão pelo MASTER serão revisões/estornos com justificativa e auditoria exclusiva, preservando originais e recuperação. Só o MASTER vê suas próprias ações na auditoria; o histórico não pode ser apagado.</span></div>
 <div>${ic('lock')}<span>Fora da internet: visualização permitida somente em cache autorizado e protegido. Escritas financeiras exigirão confirmação do servidor.</span></div>
 </div></section>`;
}
function settings(){return heading('Administração','Prévia de identidade visual; publicação depende de autorização do gestor e backend seguro.',false)+`
 <div class="notice warning"><b>Personalização experimental:</b> as alterações abaixo valem apenas nesta aba; não são salvas, sincronizadas nem publicadas. Na versão online o gestor terá controles exclusivos, domínio verificado e logos processadas no servidor.</div>
 <div class="grid-2 even"><section class="card card-pad"><div class="section-head"><div><h2>White Label · Identidade visual</h2><p>Faça testes antes de configurar a instância oficial</p></div></div>
 <div class="safe-list">
 <label class="field">Nome comercial <input id="brand-name" value="${esc(state.brand.name)}" maxlength="50" autocomplete="off" /></label>
 <label class="field">Cor principal <input id="brand-color" type="color" value="${esc(state.brand.primary)}" /></label>
 <label class="field">Logo (PNG/JPG/WebP, até 2 MB)<input id="brand-image" type="file" accept="image/png,image/jpeg,image/webp" /></label>
 <label class="field">Domínio pretendido, sem protocolo <input id="brand-domain" value="${esc(state.brand.domain)}" placeholder="gestao.exemplo.com.br" autocomplete="off" maxlength="150" /></label>
 </div><div class="action-row" style="margin-top:16px"><button class="btn primary" data-action="brand-apply">Aplicar prévia</button><button class="btn" data-action="brand-reset">Restaurar identidade LKZ</button><button class="btn" data-action="brand-export">Exportar kit PWA</button></div>
 <p class="footnote" style="margin-top:12px">O domínio não é alterado por este campo. Requer comprovação de propriedade, DNS, HTTPS e configuração da hospedagem. O ícone do app instalado pode exigir reinstalação.</p>
 </section><section class="card card-pad"><div class="section-head"><div><h2>Instalação e ícone mobile</h2><p>PWA no navegador; sem executável nativo nesta fase</p></div></div>
 <div class="brand-preview"><div class="brand-preview-icon">${state.brand.icon?`<img src="${state.brand.icon}" alt="Prévia de ícone">`:ic('chart')}</div><strong>${esc(state.brand.name)}</strong><span class="tiny muted">Prévia de identidade do aplicativo</span></div>
 <div class="safe-list"><div>${ic('check')}<span>Atualização do logo e cores da interface durante a sessão de teste</span></div><div>${ic('check')}<span>Banco dedicado com MFA, RLS e histórico de agregados em nuvem</span></div><div>${ic('alert')}<span>White Label permanente, domínio por provedor e validação de ícones ainda pendentes</span></div><div>${ic('alert')}<span>Convites, ajustes financeiros, planos corretivos e backups gerenciados em validação</span></div></div>
 </section></div>
 <section class="card card-pad" style="margin-top:17px"><div class="section-head"><div><h2>Histórico, backup e segurança</h2><p>Indicadores persistidos no ambiente seguro após autenticação</p></div></div><p class="muted">Limpa apenas a tela e dados temporários. O histórico gravado no banco permanece intocado.</p><div class="action-row"><button class="btn" data-action="backup-open">Finalizar e baixar backup criptografado</button><button class="btn" data-action="backup-open-restore">Restaurar backup local</button><button class="btn danger" data-action="reset">${ic('trash')} Limpar somente a visualização</button></div><p class="footnote">A exportação é por ação explícita. Fechar navegador ou aba não garante download; dados desta prévia não são sincronizados na nuvem. O backup não substitui recuperação do banco de produção.</p><hr class="separator"/><p class="footnote">Pendências para operação empresarial integral: convites completos, decisões e planos corretivos autorizados, comprovantes privados, backup do banco restaurado em ambiente isolado, controle de dispositivos e testes end-to-end multiusuário.</p></section>`;
}
function dataQuality(){
 const q=evaluateDataQuality(current(),state.snapshots);
 return heading('Dados necessários','Auditoria automática de suficiência: o sistema não apresenta valores exatos sem evidências.',false)+
 `<div class="notice warning"><strong>${q.precise?'Cobertura completa':'Relatórios com limitações identificadas.'}</strong> Indicadores indisponíveis não são preenchidos com valores fictícios. Envie os relatórios indicados ou registre os custos por meio de lançamentos autorizados quando o backend estiver ativo.</div>`+
 `<div class="cards">${cardKpi('Indicadores calculáveis',fmt(q.counts.ready),'Com dados suficientes','check','green')}${cardKpi('Parciais',fmt(q.counts.partial),'Leitura com ressalvas','clock','orange')}${cardKpi('Dados insuficientes',fmt(q.counts.blocked),'Solicitar fontes adicionais','alert','red')}${cardKpi('Fontes de atendimento',fmt(state.snapshots.length),'Snapshots somente nesta sessão','file')}</div>`+
 `<section class="card card-pad"><h2>Verificação por resultado esperado</h2><p class="muted">As fontes solicitadas são requisitos mínimos — podem existir outras necessidades após validação dos dados.</p><div class="quality-grid">`+
 q.issues.map(i=>`<article class="quality-item"><div class="section-head"><strong>${esc(i.title)}</strong><span class="badge ${i.status==='ready'?'green':i.status==='partial'?'orange':'red'}">${esc(QUALITY_STATUS[i.status])}</span></div><p>${esc(i.detail)}</p>${i.missing.length?`<strong>Forneça ou corrija:</strong><ul>${i.missing.map(v=>`<li>${esc(v)}</li>`).join('')}</ul>`:'<p class="good">Não há dados adicionais obrigatórios identificados para esta métrica.</p>'}</article>`).join('')+
 `</div></section><div class="action-row" style="margin-top:16px"><button class="btn primary" data-view="imports">Importar mais relatórios</button><button class="btn" data-view="reports">Ver relatórios disponíveis</button></div>`;
}
function executiveReviews(){
 const s=current(),manager=activeRole()==='gestor';
 const previous=s?state.reviews.find(x=>x.snapshot_id===s.id):null;
 const signals=s?radarItems(s):[];
 return heading('Avaliações','Revisão dos resultados consolidados do período.',false)+
 (!s?'<section class="card card-pad"><h2>Nenhum resultado disponível</h2><p>O responsável deve importar um relatório antes da avaliação.</p></section>':
 '<section class="card card-pad"><div class="section-head"><div><h2>Resultado para análise</h2><p>Referência: '+esc(s.earliest||'—')+' a '+esc(s.latest||'—')+'</p></div></div>'+
 '<div class="cards">'+cardKpi('Atendimentos',fmt(s.total),'Total do relatório','activity')+
 cardKpi('Concluídos',fmt(s.finalized),pct(s.finalized,s.total),'check','green')+
 cardKpi('Pendentes',fmt(s.pending),'Não finalizados','clock','orange')+'</div>'+
 '<h3>Principais alertas</h3>'+
 (signals.length?signals.slice(0,5).map(x=>'<article class="radar-item"><strong>'+esc(x.name)+'</strong><p>'+esc(x.evidence)+'</p></article>').join(''):
 '<p class="muted">Nenhum alerta calculado no período.</p>')+
 '<p class="footnote">A avaliação aprova ou reprova o <strong>conjunto de indicadores deste relatório</strong>, não pessoas, alertas isolados ou metas financeiras.</p>'+
 (previous?
 '<div class="notice"><strong>'+ (previous.decision==='approve'?'Relatório aprovado':'Relatório reprovado')+
 '</strong><p>Justificativa registrada: '+esc(previous.rationale)+'</p><p class="footnote">Decisão imutável e auditada, registrada em '+esc(new Date(previous.decided_at).toLocaleString('pt-BR'))+'.</p></div>':
 manager?
 '<div class="executive-actions"><button class="btn primary" data-review-choice="approve">Aprovar resultado</button><button class="btn danger" data-review-choice="reject">Reprovar resultado</button></div>'+
 (state.reviewIntent?
 '<form id="executive-review-form" class="safe-list"><h3>'+ (state.reviewIntent==='approve'?'Confirmar aprovação':'Confirmar reprovação')+
 '</h3><p>Explique o motivo da decisão para preservar um histórico claro de avaliação.</p>'+
 '<label class="field">Justificativa (mínimo 20 caracteres)<textarea id="executive-review-reason" required minlength="20" maxlength="4000" rows="4" placeholder="Descreva as evidências e o contexto da decisão."></textarea></label>'+
 '<div class="action-row"><button type="submit" class="btn primary" '+(state.reviewBusy?'disabled':'')+'>Registrar decisão</button><button type="button" class="btn" data-review-cancel>Cancelar</button></div></form>':'')+
 (state.reviewError?'<div class="notice warning">'+esc(state.reviewError)+'</div>':''):
 '<div class="notice">Este perfil pode consultar o resultado e a justificativa, mas não pode aprovar nem reprovar.</div>')+
 '</section>');
}
async function submitExecutiveReview(){
 if(activeRole()!=='gestor'||!state.cloudReady||!current()||!state.selectedTenant||!['approve','reject'].includes(state.reviewIntent)||state.reviewBusy){
  toast('Ação não autorizada para este perfil.',true);return;
 }
 const s=current(),reason=document.getElementById('executive-review-reason')?.value?.trim()||'';
 if(reason.length<20||reason.length>4000){toast('Escreva uma justificativa com 20 a 4000 caracteres.',true);return;}
 if(state.reviews.some(x=>x.snapshot_id===s.id)){toast('Este resultado já foi avaliado.',true);return;}
 state.reviewBusy=true;state.reviewError='';render();
 try{
  await cloud.reviewSnapshot(state.selectedTenant,s.id,state.reviewIntent,reason);
  state.reviews=await cloud.listSnapshotReviews(state.selectedTenant);
  state.reviewIntent=null;toast('Decisão registrada e auditada com sucesso.');
 }catch(e){state.reviewError=e?.message||'Não foi possível registrar a decisão.';}
 finally{state.reviewBusy=false;render();}
}
function results(){
 if(executiveMode())return executiveReviews();
 const s=current(),signals=s?radarItems(s):[];
 const q=evaluateDataQuality(s,state.snapshots);
 return heading('Central de Resultados','Painel de revisão do gestor: problemas primeiro, evidências e dados faltantes.',false)+
 `<div class="notice warning"><b>Revisão de desenvolvimento, sem login seguro.</b> Aprovar, reprovar, atribuir responsáveis nominais e abrir planos corretivos persistentes estarão disponíveis somente após implantação da autenticação, RLS e trilha de auditoria. Esta visualização não autoriza operações.</div>`+
 (!s?noData():dataBanner()+
 `<div class="cards">${cardKpi('Sinais de atenção',fmt(signals.length),'Priorizados por regra explícita','alert','red')}${cardKpi('Pendências',fmt(s.pending),pct(s.pending,s.total)+' do período exportado','clock','orange')}${cardKpi('Resultados sem dados',fmt(q.counts.blocked),'Não publicar como precisos','lock','red')}${cardKpi('Histórico comparável','Não disponível','Exige outros períodos não sobrepostos','chart')}</div>`+
 `<section class="card card-pad"><div class="section-head"><div><h2>Resultados negativos para avaliação</h2><p>Os dados mostram associações, não responsabilidade pessoal comprovada.</p></div></div>`+
 (signals.length?signals.map((r,i)=>`<article class="radar-item"><div class="heading"><h3>${i+1}. ${esc(r.category)} — ${esc(r.name)}</h3><span class="badge ${r.priority==='Alta'?'red':'orange'}">${esc(r.priority)}</span></div><p><b>Evidência:</b> ${esc(r.evidence)}</p><p><b>Contribuintes a investigar:</b> fluxo de trabalho, capacidade, classificação, prazos e fatores externos. Não há identificação pessoal segura neste relatório.</p><div class="action"><b>Ação sugerida:</b> ${esc(r.action)}</div><p><b>Séries 7/30/90 dias:</b> ${q.issues.find(x=>x.id==='trend')?.status==='blocked'?'dados insuficientes; importe períodos distintos.':'requer séries históricas homogêneas para cada janela.'}</p><div class="action-row"><button class="btn" type="button" disabled title="Exige autenticação e validação no servidor">Aprovar diagnóstico · indisponível</button><button class="btn danger" type="button" disabled title="Exige autenticação e auditoria">Reprovar resultado · indisponível</button></div></article>`).join(''):'<p class="muted">Nenhum sinal atende aos limiares com os dados importados.</p>')+
 `</section><section class="card card-pad" style="margin-top:17px"><h2>Próximo passo para um dossiê preciso</h2><p class="muted">Precisamos dos históricos, horas e custos, correlação pseudonimizada e evidência de conclusão antes de atribuir causas e responsáveis.</p><button class="btn primary" data-view="quality">Ver dados necessários e pendentes</button></section>`);
}

function loginLanding(){
 return `<main class="auth-layout"><section class="auth-story">
  <div class="auth-mark">LKZ <span>ISP</span><small>INTELLIGENCE</small></div>
  <div class="auth-story-body"><span class="auth-eyebrow">INTELIGÊNCIA PARA PROVEDORES</span>
   <h1>Uma visão mais clara.<em>Decisões mais fortes.</em></h1>
   <p>Operação, produtividade e resultados da sua empresa, reunidos em um ambiente de gestão seguro.</p>
   <div class="auth-benefits"><span>◎ Indicadores confiáveis</span><span>◎ Gestão por equipe</span><span>◎ Acesso protegido</span></div>
  </div><div class="auth-story-foot"><span class="auth-dot"></span> LKZ ISP Intelligence <span>·</span> Lacrose Tecnologia</div>
 </section><section class="auth-login">
  <div class="auth-login-inner"><div class="auth-mobile-logo">LKZ <b>ISP</b> <span>INTELLIGENCE</span></div>
   <div class="auth-secure">◈ ÁREA RESTRITA</div><h2>Bem-vindo de volta</h2>
   <p class="auth-desc">Acesse seu ambiente gerencial com a sua conta.</p>
   ${cloudUi.error?'<div class="auth-alert" role="alert">'+esc(cloudUi.error)+'</div>':''}
   ${cloudUi.message?'<div class="auth-notice" role="status">'+esc(cloudUi.message)+'</div>':''}
   <form id="cloud-login-form" class="auth-form" autocomplete="on">
    <label for="cloud-email">E-mail corporativo</label>
    <input id="cloud-email" name="email" type="email" autocomplete="username" placeholder="seu@email.com" maxlength="254" required>
    <div class="auth-pass-head"><label for="cloud-password">Senha</label><button type="button" class="auth-link" data-cloud="recover">Esqueci minha senha</button></div>
    <div class="auth-pass-row"><input id="cloud-password" name="password" type="password" autocomplete="current-password" placeholder="Sua senha de acesso" maxlength="250" required><button type="button" id="password-toggle" aria-label="Mostrar senha" aria-pressed="false">Mostrar</button></div>
    <label class="auth-remember"><input id="remember-device" type="checkbox"><span>Confiar neste dispositivo por até 6 horas de inatividade</span></label>
    <button class="auth-submit" type="submit" ${cloudUi.busy?'disabled':''}>Entrar na plataforma <span>→</span></button>
   </form><div class="auth-register"><span>Recebeu um convite ou está acessando pela primeira vez?</span>
    <button type="button" data-cloud="signup">Definir minha senha</button></div>
   <div class="auth-security-note">🔒 Acesso com verificação em duas etapas. Em dispositivos compartilhados, não marque a opção de confiança.</div>
  </div><div class="auth-footer"><a href="https://lacrosetecnologia.com.br/" rel="noopener noreferrer">Desenvolvido por Lacrose Tecnologia</a></div>
 </section></main>`;
}
function usersPage(){
 const editable=cloudUi.memberships.filter(m=>m.role==='master');
 if(!editable.length)return heading('Usuários e Permissões','Acesso restrito à gestão.',false)+
   '<div class="notice warning">Você não possui permissão para gerenciar usuários.</div>';
 const selected=editable.find(m=>m.tenant_id===state.selectedTenant)||editable[0];
 const allowed=['gestor','administrador','lider_setor','financeiro'].filter(r=>mayInvite(selected.role,r));
 return heading('Usuários e Permissões','Convide colaboradores por e-mail, com senha própria e MFA obrigatório.',false)+
 `<div class="notice"><b>Convite seguro:</b> o usuário recebe um e-mail, define a própria senha e confirma o MFA. Só depois o vínculo da empresa é ativado. O grupo MASTER nunca pode ser convidado. <strong>Remetente: convites@lacrosetecnologia.com.br.</strong></div>
 <section class="card card-pad" style="max-width:850px"><div class="section-head"><div><h2>Convidar usuário</h2><p>Permissões aplicadas pela empresa e pelo perfil da conta atual.</p></div></div>
 <form id="cloud-invite-form" class="safe-list">
  <label class="field">Empresa<select id="invite-tenant" required>${editable.map(m=>`<option value="${esc(m.tenant_id)}" ${m.tenant_id===selected.tenant_id?'selected':''}>${esc(m.tenant_id)} (${esc(m.role)})</option>`).join('')}</select></label>
  <label class="field">E-mail do colaborador<input id="invite-email" type="email" autocomplete="off" placeholder="colaborador@empresa.com.br" maxlength="254" required></label>
  <label class="field">Perfil<select id="invite-role" required>${allowed.map(r=>`<option value="${esc(r)}">${esc(GROUPS.find(g=>g.id===r)?.name||r)}</option>`).join('')}</select></label>
  <label class="field">Setor (exigido para líder ou financeiro)<input id="invite-sector" maxlength="36" autocomplete="off" placeholder="Identificador UUID do setor"></label>
  <p class="footnote">Quando o Resend estiver configurado e o domínio verificado, o convite é enviado automaticamente. Se não estiver, permanece pendente para envio posterior. Nunca compartilhe senhas.</p>
  <button class="btn primary" type="submit" ${cloudUi.busy?'disabled':''}>Convidar por e-mail</button>
 </form></section>
 <section class="card card-pad" style="margin-top:18px"><div class="section-head"><div><h2>Convites da empresa</h2><p>Confirme quem recebeu convite e quem ainda precisa finalizar o primeiro acesso.</p></div>
 <button type="button" class="btn" data-cloud="reload-invites" ${cloudUi.busy?'disabled':''}>Atualizar lista</button></div>
 ${cloudUi.invitationsLoading?'<p class="muted">Consultando convites autorizados…</p>':''}
 ${cloudUi.invitations.length?'<div class="table-scroll"><table><thead><tr><th>E-mail</th><th>Perfil</th><th>Situação</th><th>Ação</th></tr></thead><tbody>'+
 cloudUi.invitations.map(i=>'<tr><td>'+esc(i.invited_email)+'</td><td>'+esc(i.requested_role)+'</td><td>'+esc(i.status==='sent'?'Enviado; aguardando MFA':i.status==='accepted'?'Acesso ativado':i.status==='pending'?'Aguardando envio':i.status==='sending'?'Envio em processamento':i.status==='expired'?'Expirado':i.status)+'</td><td>'+
 (i.status==='pending'&&new Date(i.expires_at)>new Date()?'<button class="btn" type="button" data-invite-send="'+esc(i.id)+'">Enviar e-mail</button>':'—')+'</td></tr>').join('')+
 '</tbody></table></div>':'<p class="muted">Nenhum convite encontrado para esta empresa.</p>'}
 </section>
 <section class="card card-pad" style="margin-top:18px"><h2>Quem pode convidar quem?</h2>
 <div class="table-scroll"><table><thead><tr><th>Perfil atual</th><th>Gestor</th><th>Administrador</th><th>Líder</th><th>Financeiro</th></tr></thead><tbody>
 ${['master','gestor','administrador'].map(r=>`<tr><td>${esc(GROUPS.find(g=>g.id===r)?.name)}</td>${['gestor','administrador','lider_setor','financeiro'].map(target=>`<td><span class="badge ${mayInvite(r,target)?'green':'orange'}">${mayInvite(r,target)?'Permitido':'Negado'}</span></td>`).join('')}</tr>`).join('')}
 </tbody></table></div></section>`;
}
async function loadInvitations(){
 if(!cloud.hasSession || cloud.aal!=='aal2'||!state.selectedTenant ||
  !cloudUi.memberships.some(m=>m.tenant_id===state.selectedTenant&&['master','gestor','administrador'].includes(m.role)))return;
 if(cloudUi.invitationsLoading)return;
 cloudUi.invitationsLoading=true;
 try{cloudUi.invitations=await cloud.listInvitations(state.selectedTenant);}
 catch(err){cloudUi.error=err?.message||'Não foi possível consultar convites.';}
 finally{cloudUi.invitationsLoading=false;render();}
}
function cloudPage(){
 const logged=cloud.hasSession,verified=cloud.aal==='aal2';
 const name=esc(cloud.email||'—');
 return heading('Conta e Nuvem','Autenticação real no ambiente exclusivo: MFA obrigatório para leitura por empresa/setor.',false)+
 `<div class="notice warning"><b>Operação inicial controlada:</b> esta seção conecta à identidade e aos vínculos. Os arquivos originais do IXC não são enviados. Os indicadores agregados aprovados são gravados no ambiente seguro; aprovações financeiras permanecem bloqueadas. Senhas não são armazenadas. Em dispositivo confiável, o acesso de retorno é protegido por criptografia e limitado a 6 horas de inatividade.</div>`+
 `<section class="card card-pad" style="max-width:790px"><div class="section-head"><div><h2>${logged?'Sua sessão':'Acesso protegido'}</h2><p>Banco exclusivo LKZ ISP Intelligence · região São Paulo</p></div><span class="badge ${verified?'green':'orange'}">${verified?'MFA confirmado':logged?'MFA necessário':'Não autenticado'}</span></div>`+
 (cloudUi.error?`<div class="notice warning" role="alert">${esc(cloudUi.error)}</div>`:'')+
 (cloudUi.message?`<div class="notice" role="status">${esc(cloudUi.message)}</div>`:'')+
 (!logged?`<form id="cloud-login-form" class="safe-list" autocomplete="on"><label class="field">E-mail<input id="cloud-email" type="email" autocomplete="username" maxlength="250" required></label><label class="field">Senha<input id="cloud-password" type="password" autocomplete="current-password" minlength="1" maxlength="250" required></label><div class="action-row"><button class="btn primary" type="submit" ${cloudUi.busy?'disabled':''}>Entrar com segurança</button><button class="btn" type="button" data-cloud="signup" ${cloudUi.busy?'disabled':''}>Primeiro acesso · definir minha senha</button><button class="btn" type="button" data-cloud="recover">Recuperar acesso</button></div></form><p class="footnote">O cadastro não concede acesso empresarial. O MASTER inicial só será ativado depois de confirmar o e-mail e concluir o cadastro protegido. Usuários convidados definem sua própria senha. Nunca informe senhas por mensagem.</p>`:
 `<div class="safe-list"><div>${ic('check')}<span>Identidade: <strong>${name}</strong> · sessão ${esc(cloud.aal.toUpperCase())}</span></div></div>`+
 (cloud.recoveryPending?`<h3>Redefinir senha</h3><p>Link de recuperação validado; defina a nova senha.</p><form id="cloud-reset-form" class="safe-list"><label class="field">Nova senha<input id="cloud-new-password" type="password" minlength="12" maxlength="200" autocomplete="new-password" required></label><button class="btn primary" type="submit">Salvar nova senha</button></form>`:cloud.invitationSetupPending?`<h3>Primeiro acesso por convite</h3><p class="muted">Seu e-mail foi validado. Defina sua senha exclusiva antes de configurar o segundo fator.</p><form id="cloud-invite-password-form" class="safe-list"><label class="field">Crie sua senha (mínimo 12 caracteres)<input id="cloud-invite-password" type="password" minlength="12" maxlength="200" autocomplete="new-password" required></label><button class="btn primary" type="submit" ${cloudUi.busy?'disabled':''}>Salvar senha e configurar MFA</button></form>`:verified?`<h3>Vínculos autorizados pelo servidor</h3>${canUseAggregateWorkspace()?`<div class="action-row"><label class="field">Empresa ativa<select id="active-tenant">${cloudUi.memberships.filter(m=>['master','gestor','administrador','lider_setor','financeiro'].includes(m.role)).map(m=>`<option value="${esc(m.tenant_id)}" ${state.selectedTenant===m.tenant_id?'selected':''}>${esc(m.tenant_id)} (${esc(m.role)})</option>`).join('')}</select></label></div>`:''}${cloud.email?.toLowerCase()==='lacrose.igor@gmail.com' && !cloudUi.memberships.some(m=>m.role==='master')?`<div class="notice warning"><b>Ativação inicial do MASTER:</b> com e-mail confirmado e TOTP ativo, você pode solicitar a ativação da sua conta administrativa.</div><button class="btn primary" type="button" data-cloud="bootstrap" ${cloudUi.busy?'disabled':''}>Ativar meu acesso MASTER</button>`:''}
 ${cloudUi.memberships.length?`<div class="table-scroll"><table><thead><tr><th>Empresa (identificador)</th><th>Grupo</th><th>Setor autorizado</th></tr></thead><tbody>${cloudUi.memberships.map(m=>`<tr><td>${esc(m.tenant_id)}</td><td>${esc(m.role)}</td><td>${esc(m.sector_id||'Todos — perfil global')}</td></tr>`).join('')}</tbody></table></div>`:`<div class="notice warning">Nenhuma empresa autorizada para esta conta ou vínculo ainda não ativado. A conta MASTER inicial exige ativação administrativa após confirmar o e-mail e MFA.</div>`}${cloudUi.memberships.some(m=>['master','gestor'].includes(m.role))?`<section class="card card-pad" style="margin-top:18px"><h3>Auditoria autorizada</h3><p class="footnote">O MASTER consulta todos os eventos, inclusive seus próprios atos. O Gestor vê apenas os eventos comuns autorizados para sua empresa.</p><button type="button" class="btn" data-cloud="audit">Consultar auditoria</button><div class="safe-list">${cloudUi.audit.map(a=>`<div>${esc(a.event_name)} · ${esc(a.occurred_at)}</div>`).join('')}</div></section>`:''}<div class="action-row"><button class="btn" data-cloud="memberships" ${cloudUi.busy?'disabled':''}>Atualizar vínculos</button><button class="btn danger" data-cloud="logout">Sair</button></div>`:
 `<h3>Segundo fator obrigatório (TOTP)</h3><p class="muted">Sem código do aplicativo autenticador, as políticas do banco impedem consultar os dados empresariais.</p>`+
 (cloudUi.factors.length?`<p class="muted">Autenticador verificado encontrado. Digite o código atual.</p>`:
 ` <p class="muted">Ainda não existe um autenticador verificado nesta sessão. Use "Configurar autenticador" para gerar um segredo temporário, salvando-o em um app autenticador.</p><button class="btn" data-cloud="enroll" ${cloudUi.busy?'disabled':''}>Configurar autenticador</button>`)+
 (cloudUi.secret?`<div class="notice warning"><strong>Segredo TOTP — não compartilhe nem salve em print:</strong><p class="break-all"><code>${esc(cloudUi.secret)}</code></p><p>Adicione esse segredo ao seu autenticador e confirme o código abaixo. O segredo só existe em memória durante esta sessão.</p></div>`:'')+
 `<form id="cloud-mfa-form" autocomplete="off"><label class="field">Código de seis dígitos<input id="cloud-totp" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label><button class="btn primary" type="submit" ${cloudUi.busy?'disabled':''}>Confirmar MFA</button></form><div class="action-row"><button class="btn danger" data-cloud="logout">Sair sem acessar dados</button></div>`))+
 `</section><p class="footnote">Sem a opção de dispositivo confiável, a sessão fica apenas em memória. Com a opção ativada, o token de retorno é criptografado localmente por até 6 horas de inatividade, sujeito à validação do servidor e ao MFA. Autorizações são aplicadas no banco.</p>`;
}
async function cloudAction(type){
 if(cloudUi.busy)return;
 cloudUi.busy=true;cloudUi.error='';cloudUi.message='';
 try{
  if(type==='signup'){
   const email=document.getElementById('cloud-email')?.value||'';
   const input=document.getElementById('cloud-password'); const password=input?.value||'';
   if(input)input.value='';
   const outcome=await cloud.signUp(email,password);
   cloudUi.message=outcome.confirmationRequired?'Confira sua caixa de e-mail e confirme a conta. Seu acesso empresarial só será liberado depois do vínculo administrativo.':'Conta criada. Configure o autenticador antes de solicitar vínculo administrativo.';
  }else if(type==='recover'){
   const email=document.getElementById('cloud-email')?.value||'';
   await cloud.requestPasswordReset(email);
   cloudUi.message='Se a conta existir, um link de recuperação será enviado. Verifique o e-mail e o spam.';
  }else if(type==='invite-password'){
   const input=document.getElementById('cloud-invite-password');const password=input?.value||'';
   if(input)input.value='';
   await cloud.setInvitedPassword(password);
   cloudUi.factors=(await cloud.listFactors()).filter(f=>f.status==='verified');
   cloudUi.message='Senha definida. Agora confirme seu aplicativo autenticador para ativar o convite.';
  }else if(type==='reset'){
   const password=document.getElementById('cloud-new-password')?.value||'';
   await cloud.setRecoveredPassword(password);
   cloudUi.message='Senha redefinida. Faça login novamente e confirme o MFA.';
  }else if(type==='login'){
   const email=document.getElementById('cloud-email')?.value||'';
   const input=document.getElementById('cloud-password'); const password=input?.value||'';
   if(input)input.value='';
   const trustRequested=Boolean(document.getElementById('remember-device')?.checked);
   await cloud.signIn(email,password);
   await cloud.setDeviceTrust(trustRequested);
   lastActivity=Date.now();
   cloudUi.factors=(await cloud.listFactors()).filter(f=>f.status==='verified');
   cloudUi.message='Identidade confirmada; prossiga com o segundo fator.';
   if(cloud.aal==='aal2'){await cloud.acceptInvitations();cloudUi.memberships=await cloud.readMemberships();await loadCloudWorkspace();}
  }else if(type==='enroll'){
   const d=await cloud.enrollTotp();cloudUi.factorId=d.id;cloudUi.secret=d.secret;
   cloudUi.message='Registre o segredo no aplicativo autenticador e confirme o código.';
  }else if(type==='verify'){
   const code=document.getElementById('cloud-totp')?.value?.trim()||'';
   await cloud.verifyTotp(code,cloudUi.factorId||cloudUi.factors[0]?.id);
   cloudUi.secret='';cloudUi.factorId='';cloudUi.factors=[];
   const activated=await cloud.acceptInvitations();
   cloudUi.memberships=await cloud.readMemberships();await loadCloudWorkspace();
   if(activated.accepted)cloudUi.message=activated.accepted+' convite(s) confirmado(s); acesso empresarial habilitado.';
   lastActivity=Date.now();
   cloudUi.message='MFA confirmado. A leitura respeita as permissões do banco.';
  }else if(type==='bootstrap'){
   const result=await cloud.activateFirstMaster();
   cloudUi.memberships=await cloud.readMemberships();await loadCloudWorkspace();
   cloudUi.message=result.status==='activated'?'Conta MASTER ativada com MFA.':'Conta MASTER já estava ativada.';
  }else if(type==='memberships'){
   cloudUi.memberships=await cloud.readMemberships();await loadCloudWorkspace();cloudUi.message='Vínculos e indicadores conferidos no banco.';
  }else if(type==='invite'){
   const tenant_id=document.getElementById('invite-tenant')?.value||'';
   const invited_email=document.getElementById('invite-email')?.value||'';
   const requested_role=document.getElementById('invite-role')?.value||'';
   const sector_id=document.getElementById('invite-sector')?.value?.trim()||null;
   const result=await cloud.createInvitation({tenant_id,invited_email,requested_role,sector_id});
   cloudUi.message=result.sent?'Envio solicitado por convites@lacrosetecnologia.com.br. O destinatário deve confirmar o e-mail e o MFA.':
     'Convite registrado, mas ainda não enviado. '+(result.reason||'Configure o SMTP do Resend no servidor.');
   if(state.selectedTenant===tenant_id)cloudUi.invitations=await cloud.listInvitations(tenant_id);
  }else if(type==='reload-invites'){
   cloudUi.invitations=await cloud.listInvitations(state.selectedTenant);
   cloudUi.message='Lista de convites atualizada.';
  }else if(type.startsWith('retry-invite:')){
   const id=type.slice('retry-invite:'.length);
   await cloud.sendInvitation(id);
   cloudUi.invitations=await cloud.listInvitations(state.selectedTenant);
   cloudUi.message='E-mail enviado à fila do provedor. Aguarde a confirmação do destinatário.';
  }else if(type==='audit'){
   const approved=cloudUi.memberships.find(m=>['master','gestor'].includes(m.role));
   if(!approved)throw Error('Esta conta não tem acesso à auditoria.');
   cloudUi.audit=await cloud.readAudit(approved.tenant_id);
   cloudUi.message='Auditoria consultada com filtros de acesso aplicados pelo ambiente seguro.';
  }else if(type==='logout'){
   await cloud.signOut();clearWorkspace();cloudUi.secret='';cloudUi.factorId='';cloudUi.memberships=[];cloudUi.audit=[];cloudUi.invitations=[];cloudUi.factors=[];
   cloudUi.message='Sessão encerrada.';
  }
 }catch(e){cloudUi.error=e?.message||'Não foi possível concluir a operação.';}
 finally{cloudUi.busy=false;render();}
}
const pages={dashboard,results,quality:dataQuality,tickets,radar,productivity,finance,imports,reports,access,users:usersPage,settings,cloud:cloudPage};
function render(){
 if(!cloud.hasSession){root.innerHTML=loginLanding();bindActions();return;}
 if(!canUseAggregateWorkspace())state.view='cloud';
 else if(executiveMode()&&!['dashboard','results','reports','cloud'].includes(state.view))state.view='dashboard';
 else if(sectorMode()&&!['dashboard','reports','cloud'].includes(state.view))state.view='dashboard';
 else if(!canAdministerLocalWorkspace()&&['imports','finance','settings','users','access','quality','tickets','radar','productivity'].includes(state.view))state.view='dashboard';
 const page=pages[state.view]||cloudPage;
 root.innerHTML=shell(page());applyBrandPreview(state.brand);bindActions();}
function setView(v){
 if(v!=='cloud'&&!canUseAggregateWorkspace())v='cloud';
 else if(executiveMode()&&!['dashboard','results','reports','cloud'].includes(v))v='dashboard';
 else if(sectorMode()&&!['dashboard','reports','cloud'].includes(v))v='dashboard';
 else if(!canAdministerLocalWorkspace()&&['imports','finance','settings','users','access','quality','tickets','radar','productivity'].includes(v))v='dashboard';
 state.view=v;state.menuOpen=false;state.reviewIntent=null;
 if(v!=='imports'&&state.staged){state.staged=null;state.mapping=null;}
 render();if(v==='users'&&canAdministerLocalWorkspace())loadInvitations();
 window.scrollTo({top:0,behavior:'instant'});
}
function bindActions(){
 root.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
 root.querySelector('#active-tenant')?.addEventListener('change',e=>{cloudUi.busy=true;loadCloudWorkspace(e.target.value).then(()=>{cloudUi.message='Empresa autorizada e indicadores sincronizados.'}).catch(err=>{cloudUi.error=err.message;state.view='cloud'}).finally(()=>{cloudUi.busy=false;render()});});
 root.querySelectorAll('[data-cloud]').forEach(b=>b.addEventListener('click',()=>cloudAction(b.dataset.cloud)));
 root.querySelector('#password-toggle')?.addEventListener('click',e=>{const inp=root.querySelector('#cloud-password');if(!inp)return;const showing=inp.type==='text';inp.type=showing?'password':'text';e.currentTarget.textContent=showing?'Mostrar':'Ocultar';e.currentTarget.setAttribute('aria-pressed',String(!showing));});
 root.querySelector('#cloud-login-form')?.addEventListener('submit',e=>{e.preventDefault();cloudAction('login')});
 root.querySelector('#cloud-mfa-form')?.addEventListener('submit',e=>{e.preventDefault();cloudAction('verify')});
 root.querySelector('#cloud-reset-form')?.addEventListener('submit',e=>{e.preventDefault();cloudAction('reset')});
 root.querySelector('#cloud-invite-password-form')?.addEventListener('submit',e=>{e.preventDefault();cloudAction('invite-password')});
 root.querySelectorAll('[data-invite-send]').forEach(b=>b.addEventListener('click',()=>cloudAction('retry-invite:'+b.dataset.inviteSend)));
 root.querySelector('#cloud-invite-form')?.addEventListener('submit',e=>{e.preventDefault();cloudAction('invite')});
 root.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>action(b.dataset.action)));
 root.querySelectorAll('[data-review-choice]').forEach(b=>b.addEventListener('click',()=>{if(activeRole()!=='gestor')return;state.reviewIntent=b.dataset.reviewChoice;state.reviewError='';render();}));
 root.querySelector('[data-review-cancel]')?.addEventListener('click',()=>{state.reviewIntent=null;state.reviewError='';render();});
 root.querySelector('#executive-review-form')?.addEventListener('submit',e=>{e.preventDefault();submitExecutiveReview();});
 root.querySelectorAll('[data-productivity]').forEach(b=>b.addEventListener('click',()=>{state.productivityTab=b.dataset.productivity;render();if(state.productivityTab==='person')loadEmployeeMetrics();}));
 root.querySelectorAll('[data-load-employees]').forEach(b=>b.addEventListener('click',()=>loadEmployeeMetrics()));
 root.querySelector('#employee-sector')?.addEventListener('change',e=>{state.employeeSectorFilter=e.target.value;render()});
 root.querySelectorAll('[data-map]').forEach(sel=>sel.addEventListener('change',()=>state.mapping[sel.dataset.map]=Number(sel.value)));
 root.querySelectorAll('[data-snapshot]').forEach(b=>b.addEventListener('click',()=>{state.snapshot=state.snapshots.find(s=>s.id===b.dataset.snapshot);state.demo=false;setView('dashboard')}));
 root.querySelectorAll('[data-cost]').forEach(el=>el.addEventListener('input',()=>{state.cost[el.dataset.cost]=el.value.replace(/[^0-9,.]/g,'').slice(0,12);document.getElementById('cost-result').textContent=moneyBRL(calculateCost(state.cost));saveSetting('cost',state.cost).catch(()=>toast('Não foi possível salvar a configuração local.',true))}));
 const inp=document.getElementById('file-input');if(inp)inp.addEventListener('change',e=>{if(e.target.files?.[0])receiveFile(e.target.files[0])});
 const drop=document.getElementById('drop-zone');if(drop){drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag')});drop.addEventListener('dragleave',()=>drop.classList.remove('drag'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('drag');if(e.dataTransfer.files?.[0])receiveFile(e.dataTransfer.files[0]);})}
}
async function receiveFile(file){if(!canImportToCloud()){toast('É necessário estar online, com MFA e conexão ativa ao ambiente seguro para importar.',true);return;}if(!canAdministerLocalWorkspace()){toast('Acesso e MFA do Gestor ou MASTER obrigatórios.',true);return;}if(state.importBusy)return;state.importBusy=true;state.staged=null;state.mapping=null;toast('Lendo arquivo somente na memória. Apenas agregados saneados serão enviados após sua confirmação.');
 try{const staged=await readReport(file);state.staged=staged;state.mapping=detectMapping(staged.headers);state.sourceName=file.name.replace(/[^a-zA-ZÀ-ÿ0-9()_. -]/g,'').slice(0,80)||'Relatório importado';render();}
 catch(err){state.staged=null;toast(err?.message||'Falha ao ler o arquivo.',true)}finally{state.importBusy=false;}}
async function updateBrand(){
 try{
  const name=validateBrandName(document.getElementById('brand-name').value);
  const primary=validateHexColor(document.getElementById('brand-color').value);
  const domain=validateDomain(document.getElementById('brand-domain').value);
  const input=document.getElementById('brand-image');
  let logo=state.brand.logo,icon=state.brand.icon,icon512=state.brand.icon512;
  if(input.files?.[0]){
   const prepared=await prepareBrandImage(input.files[0]);
   logo=prepared.logo;icon=prepared.icon;icon512=prepared.icon512;
  }
  state.brand={name,primary,domain,logo,icon,icon512};
  render();toast('Prévia White Label aplicada. Nada foi gravado ou publicado.');
 }catch(e){toast(e.message||'Não foi possível validar a identidade visual.',true);}
}
async function exportBrandKit(){
 const b=state.brand;
 if(!b.icon || !b.icon512){toast('Primeiro envie uma logo válida e aplique a prévia.',true);return;}
 if(typeof JSZip==='undefined'){toast('Gerador de pacote offline indisponível.',true);return;}
 const zip=new JSZip();
 const toBase64=data=>data.slice(data.indexOf(',')+1);
 zip.file('icon-192.png',toBase64(b.icon),{base64:true});
 zip.file('icon-512.png',toBase64(b.icon512),{base64:true});
 const manifest={name:b.name,short_name:b.name.slice(0,16),description:'LKZ ISP Intelligence',start_url:'./',scope:'./',display:'standalone',background_color:'#f3f6fb',theme_color:b.primary,icons:[{src:'./icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'./icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}]};
 zip.file('manifest.webmanifest',JSON.stringify(manifest,null,2));
 zip.file('LEIA-ME.txt','KIT WHITE LABEL - LKZ ISP Intelligence\n\nArquivos gerados apenas no dispositivo. Para uso real, um operador autorizado deve publicar em HTTPS e na origem correta, apontar o HTML para o manifesto e verificar os atalhos. A mudança de URL exige validação de DNS/HTTPS separada. Apps já instalados podem exigir reinstalação. Não substitui configuração segura multiempresa.');
 const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE'});
 const url=URL.createObjectURL(blob);
 const link=document.createElement('a');link.href=url;link.download='lkz-white-label-pwa-kit.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
 toast('Kit de ícones/manifesto gerado localmente; ainda precisa ser publicado.');
}
async function action(name){if(name==='print-report'){if(!canUseAggregateWorkspace()||!current()||state.view!=='reports'){toast('Relatório não autorizado.',true);return;}window.print();return;}
 if(name==='export'){if(!canUseAggregateWorkspace()||!current()){toast('Relatório não autorizado.',true);return;}exportSafe();return;}
 if(!canAdministerLocalWorkspace()){toast('Operação não autorizada nesta conta.',true);return;}
 if(name==='backup-open'){state.backupStage='create';render();return;}
 if(name==='backup-open-restore'){state.backupStage='restore';render();return;}
 if(name==='backup-cancel'){state.backupStage=null;state.backupDownload=null;render();return;}
 if(name==='backup-download'){await downloadBackup();return;}
 if(name==='backup-redownload'){if(state.backupDownload)triggerBackupDownload(state.backupDownload);return;}
 if(name==='backup-finish'){await cloud.signOut();clearWorkspace();Object.assign(state,{sourceName:'',brand:newBrand(),backupStage:null,backupDownload:null,view:'cloud'});render();toast('Backup baixado; sessão encerrada. Indicadores continuam no ambiente seguro.');return;}
 if(name==='backup-restore'){if(IS_PUBLIC_HOMOLOGATION){toast('Restauração online de backup ainda indisponível. O histórico válido permanece no ambiente seguro.',true);return;}await restoreBackup();return;}
 if(name==='brand-export'){await exportBrandKit();return;}
 if(name==='brand-reset'){state.brand=newBrand();render();toast('Identidade LKZ restaurada nesta aba.');return;}
 if(name==='brand-apply'){await updateBrand();return;}
 if(name==='menu'){state.menuOpen=!state.menuOpen;render();return}
 if(name==='choose-file'){document.getElementById('file-input')?.click();return}
 if(name==='cancel-stage'){state.staged=null;state.mapping=null;render();return}
 if(name==='demo'){state.demo=true;state.snapshot=mockSnapshot();setView('dashboard');return}
 if(name==='process-file'){
  if(!canImportToCloud()){toast('Sem conexão autorizada ao ambiente seguro. Não descartamos a planilha.',true);return;}
  if(!state.staged)return;
  try{const snap=buildSnapshot(state.staged.rows,state.mapping,{source:'IXC · Relatório de atendimentos'});
   const staff=buildEmployeeMetrics(state.staged.rows,state.mapping,snap.referenceDate);
   const base=JSON.stringify({total:snap.total,earliest:snap.earliest,latest:snap.latest,statuses:snap.statuses,subjects:snap.subjects,sectors:snap.sectors,cities:snap.cities,daily:snap.daily});
   const encodeFingerprint=async str=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str))),x=>x.toString(16).padStart(2,'0')).join('');
   const oldFingerprint=await encodeFingerprint(base);
   snap.fingerprint=await encodeFingerprint(JSON.stringify({...JSON.parse(base),employees:staff.metrics}));
   // Atualizar um relatório anterior já sincronizado sem duplicar seus totais.
   // O hash legado foi criado com exatamente o mesmo resumo, sem a coluna Colaborador.
   const previous=state.snapshots.find(x=>x.fingerprint===snap.fingerprint) ||
     state.snapshots.find(x=>x.fingerprint===oldFingerprint);
   const priorEmployees=previous?await cloud.readEmployeeMetrics(state.selectedTenant,previous.fingerprint):[];
   const alreadyImported=Boolean(previous&&priorEmployees.length===staff.metrics.length);
   const confirmed=await cloud.saveSnapshotWithEmployees(state.selectedTenant,previous||snap,staff.metrics);
   // Dados brutos descartados apenas após leitura de volta do servidor.
   state.staged=null;state.mapping=null;state.sourceName='';
   state.snapshots=confirmed.records;state.snapshot=confirmed.snapshot;
   state.employeeMetrics[confirmed.snapshot.fingerprint]=confirmed.employees;
   state.demo=false;
   setView('dashboard');
   toast(alreadyImported?'Relatório já importado: nenhuma duplicidade criada.':'Relatório salvo com sucesso, com '+fmt(staff.assigned)+' atribuições. Nenhum dado pessoal de cliente foi enviado.');
  }catch(err){toast(err?.message||'Erro na importação.',true)}return;
 }
 if(name==='reset'){
  if(!window.confirm('Limpar apenas a visualização desta sessão? Os indicadores na nuvem NÃO serão apagados.'))return;
  state.snapshot=null;state.demo=false;render();toast('Visualização limpa. Histórico mantido no ambiente seguro.');return;
 }
 if(name==='export'){exportSafe();return;}
}
function triggerBackupDownload(text){
 const blob=new Blob([text],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download='LKZ-ISP-backup-'+new Date().toISOString().slice(0,10)+'.lkzbackup.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function downloadBackup(){
 if(state.backupBusy)return;
 if(!state.snapshots.length){toast('Nenhum relatório importado nesta sessão para salvar. Use Restaurar backup para abrir um backup anterior.',true);return;}
 const pass=document.getElementById('backup-pass')?.value||'',again=document.getElementById('backup-confirm')?.value||'';
 if(pass!==again){toast('As frases secretas não coincidem.',true);return;}
 state.backupBusy=true;
 try{const sealed=await encryptBackup(state.snapshots,pass);state.backupDownload=JSON.stringify(sealed);triggerBackupDownload(state.backupDownload);state.backupStage='verify';render();}
 catch(e){toast(e.message||'Não foi possível criar o backup protegido.',true)}finally{state.backupBusy=false;}
}
async function restoreBackup(){
 if(state.backupBusy)return;
 const file=document.getElementById('backup-restore-file')?.files?.[0];const pass=document.getElementById('backup-restore-pass')?.value||'';
 if(!file||file.size>3_000_000){toast('Selecione um backup válido de até 3 MB.',true);return;}
 state.backupBusy=true;
 try{
  const copies=await decryptBackup(await file.text(),pass);let added=0;
  for(const copy of copies){if(copy.fingerprint&&state.snapshots.some(s=>s.fingerprint===copy.fingerprint))continue;
   const rec=await saveSnapshot(copy);state.snapshots.push(rec);added++;}
  state.snapshots.sort((a,b)=>b.importedAt.localeCompare(a.importedAt));state.snapshot=state.snapshots[0]||null;state.demo=false;state.backupStage=null;render();toast(`${added} conjuntos de indicadores restaurados localmente.`);
 }catch(e){toast(e?.message||'Não foi possível restaurar o backup.',true)}finally{state.backupBusy=false;}
}
function exportSafe(){const s=current();if(!s)return;
 const csv=[['Grupo','Categoria','Total','Finalizados','Pendentes'],...(sectorMode()?[]:Object.entries(subjectGroups(s)).map(([n,g])=>['Assunto',n,g.total,g.finalized,g.pending])),...Object.entries(s.sectors||{}).map(([n,g])=>['Setor',n,g.total,g.finalized,g.pending]),...(sectorMode()?[]:Object.entries(s.cities||{}).map(([n,g])=>['Cidade',n,g.total,g.finalized,g.pending]))];
 const content='\uFEFF'+csv.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=sectorMode()?'lkz-isp-relatorio-meu-setor.csv':'lkz-isp-indicadores-agregados.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function init(){
 try{const cb=await cloud.handleAuthCallback();if(cb){
  cloudUi.message=cb.recovery?'Defina sua nova senha antes de continuar.':cb.invited?'Convite confirmado. Defina uma senha e ative seu MFA.':'E-mail confirmado. Confirme o MFA para acessar.';
  if(!cb.recovery && !cb.invited && cloud.aal!=='aal2')cloudUi.factors=(await cloud.listFactors()).filter(f=>f.status==='verified');
  if(!cb.recovery && !cb.invited && cloud.aal==='aal2'){await cloud.acceptInvitations();cloudUi.memberships=await cloud.readMemberships();await loadCloudWorkspace();}
 }else{
  const resumed=await cloud.restoreTrustedDevice();
  if(resumed){
   await cloud.acceptInvitations();
   cloudUi.memberships=await cloud.readMemberships();
   await loadCloudWorkspace();
   cloudUi.message='Dispositivo confiável reconhecido. Sessão protegida restaurada.';
   lastActivity=Date.now();
  }
 }}catch(e){cloudUi.error=e?.message||'Erro ao validar o link.';}
 // A leitura do ambiente de gestão após autenticação é a única origem dos indicadores empresariais.
 // Não substituir os registros confirmados pelo armazenamento volátil legado.
 try{const setting=await getSetting('cost');if(setting?.value)state.cost={...sampleCost,...setting.value};}
 catch{state.cost={...sampleCost};}
 if(!state.cloudReady){state.snapshots=[];state.snapshot=null;}
 render();if('serviceWorker'in navigator && (location.protocol==='https:'||!IS_PUBLIC_HOMOLOGATION))navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
async function verifyInactivity(){
 if(sessionEnding||!cloud.hasSession)return;
 if(Date.now()-lastActivity<IDLE_LIMIT_MS)return;
 sessionEnding=true;
 try{await cloud.signOut();clearWorkspace();cloudUi.memberships=[];cloudUi.factors=[];cloudUi.secret='';cloudUi.message='Sua sessão foi encerrada após 6 horas de inatividade.';state.view='cloud';render();}
 catch{cloud.clear();clearWorkspace();render();}
 finally{sessionEnding=false;}
}
function noteActivity(){
 if(!cloud.hasSession)return;
 if(Date.now()-lastActivity>=IDLE_LIMIT_MS){verifyInactivity();return;}
 lastActivity=Date.now();
 cloud.recordUserActivity().catch(()=>{});
}
document.addEventListener('pointerdown',noteActivity,{passive:true});
document.addEventListener('keydown',noteActivity,{passive:true});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){verifyInactivity();}});
window.addEventListener('focus',()=>verifyInactivity());
setInterval(verifyInactivity,60000);
window.addEventListener('online',()=>render());window.addEventListener('offline',()=>render());
init();
