/* LKZ ISP v1.3 — apresentação executiva. Não toma decisões de autorização:
   snapshots setoriais são filtrados no Supabase antes de chegar a este módulo. */
export const EXECUTIVE_ROLES=Object.freeze(['gestor','administrador','lider_setor','financeiro']);
export const executiveViews=Object.freeze({
 gestor:['dashboard','productivity','results','reports'],
 administrador:['dashboard','productivity','reports'],
 lider_setor:['dashboard','productivity','reports'],
 financeiro:['dashboard','productivity','reports']
});
const e=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const number=n=>new Intl.NumberFormat('pt-BR').format(Number(n)||0);
const per=(n,d)=>d>0?new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(100*n/d)+'%':'—';
const n=v=>Number.isFinite(Number(v))?Math.max(0,Number(v)):0;
const period=s=>[s?.earliest,s?.latest].filter(Boolean).map(e).join(' até ')||'Período não informado';
const updated=s=>s?.importedAt?new Date(s.importedAt).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'Data não informada';
const info=s=>s?.sectorOnly?e(s.sectorName||'Meu setor'):'Todos os setores autorizados';
const kpi=(name,value,note,tone='blue')=>'<article class="exec-kpi exec-'+tone+'"><span>'+e(name)+'</span><strong>'+e(value)+'</strong><small>'+e(note)+'</small></article>';
export function activeRole(memberships,tenant){
 if(memberships?.some(m=>m.role==='master'))return 'master';
 return memberships?.find(m=>m.tenant_id===tenant&&EXECUTIVE_ROLES.includes(m.role))?.role||null;
}
export function canOpenExecutiveView(role,view){
 return Boolean(executiveViews[role]?.includes(view)||view==='cloud');
}
export function executiveNavigation(role){
 const nav={dashboard:['dashboard','Visão geral'],productivity:['users','Desempenho'],results:['check','Aprovações'],reports:['file','Relatórios']};
 return (executiveViews[role]||[]).map(v=>[v,...nav[v]]);
}
const header=(title,subtitle,s)=>'<div class="exec-heading"><div><div class="exec-eyebrow">PAINEL EXECUTIVO · '+info(s)+'</div><h1>'+e(title)+'</h1><p>'+e(subtitle)+'</p></div><span class="exec-updated">Atualizado: '+e(updated(s))+'</span></div>';
const empty=(kind='resultados')=>'<section class="exec-empty"><h2>Nenhum '+e(kind)+' disponível</h2><p>Os indicadores serão exibidos quando houver dados autorizados para sua empresa ou setor.</p></section>';
const stat=s=>'<section class="exec-kpis">'+kpi('Atendimentos',number(s.total),'Registros da fotografia')+
 kpi('Concluídos',number(s.finalized),per(s.finalized,s.total)+' do total','green')+
 kpi('Não concluídos',number(s.pending),per(s.pending,s.total)+' do total','orange')+
 kpi('Pendências antigas',number(s.pendingOlder7d),'Mais de 7 dias na exportação','rose')+'</section>';
function donut(s){const p=Math.max(0,Math.min(100,s.total?100*n(s.finalized)/n(s.total):0));
 return '<div class="exec-ring-group"><div class="exec-ring" style="--portion:'+p+'"><div><strong>'+per(s.finalized,s.total)+'</strong><span>concluídos</span></div></div>'+
 '<div class="exec-ring-legend"><div><i class="exec-dot green"></i>Concluídos <b>'+number(s.finalized)+'</b></div><div><i class="exec-dot blue"></i>Não concluídos <b>'+number(s.pending)+'</b></div></div></div>';
}
function bars(s){
 const entries=Object.entries(s.daily||{}).sort(([a],[b])=>a.localeCompare(b));
 if(s.sectorOnly)return '<p class="exec-hint">Este arquivo não contém evolução diária separada por setor. Os totais acima representam somente o seu setor; nenhuma série de outros setores é exibida.</p>';
 if(!entries.length)return '<p class="exec-hint">A exportação não contém datas diárias suficientes para este gráfico.</p>';
 const max=Math.max(1,...entries.map(([,v])=>n(v.total)));
 return '<div class="exec-bars" role="img" aria-label="Gráfico de atendimentos diários da empresa">'+entries.slice(-32).map(([d,v])=>
 '<div class="exec-bar-slot" title="'+e(d)+': '+number(v.total)+' atendimentos"><span style="height:'+Math.max(2,Math.min(100,100*n(v.finalized)/max))+'%" class="exec-bar-fin"></span><span style="height:'+Math.max(2,Math.min(100,100*n(v.pending)/max))+'%" class="exec-bar-pend"></span></div>').join('')+'</div>'+
 '<div class="exec-legend"><span><i class="exec-dot green"></i>Concluídos</span><span><i class="exec-dot blue"></i>Em aberto</span></div>';
}
const scopeNote=s=>'<p class="exec-note"><strong>Fonte:</strong> exportação IXC · '+e(period(s))+'. Os dados retratam a data do relatório, não o monitoramento em tempo real. Fechamento acima de 24h não equivale a violação de SLA.</p>';
export function renderExecutiveDashboard({snapshot:s}={}){
 if(!s)return header('Visão geral','O que importa para sua operação.')+empty();
 return '<div class="exec-page">'+header('Visão geral','Resultados importantes, sem complicações.',s)+stat(s)+
 '<div class="exec-panels"><section class="exec-panel"><h2>Atendimentos concluídos</h2><p>Visão rápida dos resultados no período</p>'+donut(s)+'</section>'+
 '<section class="exec-panel"><h2>Movimento dos atendimentos</h2><p>'+e(s.sectorOnly?'Totais disponíveis para o setor':'Distribuição por data de atendimento')+'</p>'+bars(s)+'</section></div>'+
 '<div class="exec-action-strip"><div><h2>Precisa apresentar esses resultados?</h2><p>Gere um relatório organizado e pronto para imprimir.</p></div><button class="exec-button" type="button" data-view="reports">Ver relatório e imprimir</button></div>'+scopeNote(s)+'</div>';
}
export function renderExecutiveProductivity({snapshot:s,employees=null}={}){
 if(!s)return header('Desempenho','Visualize o que aconteceu no período.')+empty();
 const sectors=Object.entries(s.sectors||{}).sort((a,b)=>n(b[1].total)-n(a[1].total));
 const max=Math.max(1,...sectors.map(([,v])=>n(v.total)));
 let card='<section class="exec-panel"><h2>'+e(s.sectorOnly?'Meu setor':'Atendimentos por setor')+'</h2>'+
 '<p>Volume e conclusão · comparações exigem considerar a complexidade de cada atividade</p><div class="exec-sector-list">'+
 sectors.map(([name,g])=>'<div class="exec-sector"><div><strong>'+e(name)+'</strong><span>'+number(g.total)+' atendimentos · '+per(g.finalized,g.total)+' concluídos</span></div><div class="exec-sector-track"><i style="width:'+Math.max(1,Math.min(100,100*n(g.total)/max))+'%"></i></div></div>').join('')+'</div></section>';
 if(!s.sectorOnly){if(!employees)card+='<section class="exec-panel"><h2>Equipe</h2><p>Consulte somente colaboradores vinculados aos resultados autorizados.</p><button class="exec-button" type="button" data-load-employees="true">Consultar colaboradores</button></section>';
 else card+='<section class="exec-panel"><h2>Equipe</h2><p>Indicadores operacionais atribuídos. Quantidade de atendimentos não representa, sozinha, avaliação de desempenho.</p><div class="exec-sector-list">'+employees.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')).map(x=>'<div class="exec-sector"><div><strong>'+e(x.name)+'</strong><span>'+e(x.sector)+' · '+number(x.finalized)+' concluídos de '+number(x.total)+'</span></div><div class="exec-sector-track"><i style="width:'+Math.min(100,100*n(x.finalized)/Math.max(1,n(x.total)))+'%"></i></div></div>').join('')+'</div></section>';}
 return '<div class="exec-page">'+header('Desempenho','Resultados por setor, com informações fáceis de interpretar.',s)+stat(s)+card+scopeNote(s)+'</div>';
}
export function renderExecutiveReviews({snapshot:s,reviews=[],choice=null,role='gestor'}={}){
 if(role!=='gestor')return empty('aprovações');
 if(!s)return header('Aprovações','Resultados consolidados para análise.')+empty();
 const old=reviews.find(r=>r.snapshot_id===s.id);
 let core='';
 if(old)core='<div class="exec-decision-status"><strong>'+e(old.decision==='approve'?'Resultado aprovado':'Resultado reprovado')+'</strong><p>'+e(old.rationale)+'</p><small>Decisão registrada em '+e(new Date(old.reviewed_at).toLocaleString('pt-BR'))+'. Este parecer não pode ser alterado.</small></div>';
 else core='<div class="exec-confirm"><h3>Qual é sua avaliação?</h3><p>Analise os indicadores antes de registrar seu parecer definitivo.</p>'+
 '<div class="exec-decision-buttons"><button type="button" data-review-choice="approve" class="exec-button exec-approve">Aprovar resultados</button>'+
 '<button type="button" data-review-choice="reject" class="exec-button exec-reject">Reprovar resultados</button></div>'+
 (choice?'<form id="exec-review-form" class="exec-review-form"><strong>'+e(choice==='approve'?'Confirmar aprovação':'Confirmar reprovação')+'</strong>'+
 '<label for="exec-review-note">Justificativa (mínimo 20 caracteres)</label>'+
 '<textarea id="exec-review-note" minlength="20" maxlength="2000" required placeholder="Descreva de maneira simples o motivo do seu parecer."></textarea>'+
 '<div class="exec-decision-buttons"><button class="exec-button exec-approve" type="submit">Confirmar decisão definitiva</button><button class="exec-button secondary" type="button" data-review-cancel>Cancelar</button></div></form>':'')+'</div>';
 return '<div class="exec-page">'+header('Aprovações','Análise humana obrigatória antes de formalizar resultados.',s)+stat(s)+
 '<section class="exec-panel"><h2>Resultado consolidado do período</h2><p>'+e(period(s))+'</p>'+donut(s)+core+'</section>'+
 '<p class="exec-note"><strong>Atenção:</strong> aprovação confirma o parecer sobre os indicadores exibidos. Não é aceite de SLA, decisão financeira ou avaliação individual automática. Cada decisão fica gravada com data, autoria e histórico de auditoria.</p></div>';
}
export function renderExecutiveReports({snapshot:s,role='administrador'}={}){
 if(!s)return header('Relatórios','Prontos para impressão e PDF.')+empty('relatórios');
 return '<div class="exec-page exec-report-view"><div class="exec-report-controls"><div><h1>Relatório executivo</h1><p>Imprima ou escolha "Salvar como PDF" no navegador.</p></div><button class="exec-button" type="button" data-exec-print>Imprimir / Salvar PDF</button></div>'+
 '<article class="exec-report-paper" id="exec-printable"><div class="exec-report-head"><div><small>LKZ ISP INTELLIGENCE</small><h1>Relatório consolidado</h1><p>'+info(s)+'</p></div><strong>LACROSE<br>TECNOLOGIA</strong></div>'+
 '<div class="exec-report-info"><span>Período: <strong>'+e(period(s))+'</strong></span><span>Dados atualizados: <strong>'+e(updated(s))+'</strong></span><span>Escopo: <strong>'+e(s.sectorOnly?'Somente o próprio setor':'Todos os setores autorizados')+'</strong></span></div>'+
 stat(s)+'<div class="exec-report-chart"><h2>Panorama dos atendimentos</h2>'+donut(s)+'</div>'+
 '<section class="exec-report-summary"><h2>Resumo</h2><p>No período informado, foram registrados <strong>'+number(s.total)+'</strong> atendimentos'+(s.sectorOnly?' no setor autorizado':' nos setores autorizados')+'. Desses, <strong>'+number(s.finalized)+'</strong> foram concluídos e <strong>'+number(s.pending)+'</strong> não estavam concluídos na exportação.</p>'+
 '<p>Conclusão: <strong>'+per(s.finalized,s.total)+'</strong>. Pendências acima de sete dias: <strong>'+number(s.pendingOlder7d)+'</strong>.</p></section>'+
 '<footer class="exec-report-foot">Gerado no LKZ ISP Intelligence · Lacrose Tecnologia · Fonte: indicadores consolidados do IXC.<br>Relatório de fotografia histórica, não painel em tempo real; sem dados identificáveis de clientes. Fechamento acima de 24h não constitui automaticamente violação de SLA.</footer></article></div>';
}
