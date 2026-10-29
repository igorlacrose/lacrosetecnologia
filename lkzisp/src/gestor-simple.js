/* Layout aprovado do Gestor, isolado do painel MASTER.
   Não faz requisições HTTP: recebe exclusivamente resumos já autorizados. */
export const gestorSimpleState={city:'',sector:'',view:'home',choice:'',reason:'',sending:false,context:null};
export function mountGestorSimple(host,model,handlers){
 if(!model||!model.mfaConfirmed||!['gestor','administrador'].includes(model.role))throw Error('Gestor exige MFA e vínculo válido.');
 const root=host.attachShadow({mode:'open'});
 root.innerHTML="<link rel=\"stylesheet\" href=\"./src/gestor-simple.css?v=137\">\n<header><div class=\"container\"><div class=\"brand\"><div class=\"brand-symbol\">LKZ<span>ISP</span></div><div class=\"brand-copy\"><strong>Intelligence</strong><small>Painel do Gestor</small></div></div><div class=\"top-right\"><span class=\"preview-tag\">SESSÃO SEGURA</span><button class=\"top-account\" data-go=\"conta\" aria-label=\"Abrir Minha conta\"><span class=\"inline-icon\" id=\"account-icon\"></span><span>Minha conta</span></button></div></div></header>\n<main class=\"container\"><div class=\"hero\"><div class=\"hero-row\"><div><div class=\"eyebrow\">LKZ ISP · GESTÃO SEM COMPLICAÇÃO</div><h1 id=\"hero-title\">Olá, Gestor! 👋</h1><p id=\"hero-copy\">Escolha o que deseja acompanhar. Toque nos botões e veja os resultados sem complicação.</p></div><div class=\"hero-icon\" id=\"hero-icon\" aria-hidden=\"true\"></div></div></div>\n<div class=\"filter-shell\"><div class=\"filter-row\"><div class=\"filter-group\"><label for=\"city\">Cidade</label><select id=\"city\" aria-label=\"Filtrar cidade\"><option value=\"\">Todas as cidades</option><option>Jequié</option><option>Ipiaú</option><option>Itagibá</option><option>Jitaúna</option></select></div><div class=\"filter-group\"><label for=\"sector\">Setor</label><select id=\"sector\" aria-label=\"Filtrar setor\"><option value=\"\">Todos os setores</option><option>Atendimento</option><option>NOC</option><option>Suporte N2</option><option>Técnicos</option></select></div><button class=\"small-clear\" data-action=\"clear-filters\">Limpar filtros</button></div><div class=\"filter-note\" id=\"filter-note\" aria-live=\"polite\"></div></div>\n<div id=\"content\" aria-live=\"polite\"></div>\n<footer class=\"footer-note\"><strong>LKZ ISP Intelligence</strong> · Indicadores consolidados autorizados e avaliações auditadas.<br><a href=\"https://lacrosetecnologia.com.br/\" target=\"_blank\" rel=\"noopener noreferrer\">Desenvolvido por Lacrose Tecnologia</a></footer></main>\n";
 const $=s=>root.querySelector(s);
 const snap=model.snapshot||null;
 const state=gestorSimpleState;
 const identity=model.tenantId+'|'+(snap?.id||'none');
 if(state.context!==identity)Object.assign(state,{city:'',sector:'',view:'home',choice:'',reason:'',sending:false,context:identity});
 const paths={user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',chart:'<path d="M3 3v18h18"/><path d="M7 16v-4m5 4V8m5 8V5"/>',clipboard:'<rect x="6" y="5" width="12" height="16" rx="2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-4"/>',file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8m-8 4h8"/>',shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',arrow:'<path d="m9 18 6-6-6-6"/>',back:'<path d="m15 18-6-6 6-6"/>',info:'<circle cx="12" cy="12" r="10"/><path d="M12 11v5m0-8v.01"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M5 17v3h14v-3"/>',alert:'<path d="M10.3 3.8 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z"/><path d="M12 9v4m0 4v.01"/>',layers:'<path d="m12 2 9 5-9 5-9-5 9-5zm-9 10 9 5 9-5M3 17l9 5 9-5"/>'};
function ico(n){return '<svg aria-hidden="true" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'+(paths[n]||paths.grid)+'</svg>'}

 const cityGroups=snap?.cities||{},sectorGroups=snap?.sectors||{};
 const cities=Object.keys(cityGroups).sort((a,b)=>a.localeCompare(b,'pt-BR'));
 const sectors=Object.keys(sectorGroups).sort((a,b)=>a.localeCompare(b,'pt-BR'));
 const sum=(xs,k)=>xs.reduce((a,x)=>a+(Number(x[k])||0),0);
 const fmt=n=>n===null||n===undefined?'—':new Intl.NumberFormat('pt-BR').format(Number(n)||0);
 const pct=(a,b)=>b?Math.round(100*a/b):0;
 const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const group=(g,old=null)=>({total:Number(g?.total)||0,completed:Number(g?.finalized)||0,pending:Number(g?.pending)||0,old});
 const allSummary=()=>snap?group(snap,Number(snap.pendingOlder7d)||0):{total:0,completed:0,pending:0,old:null};
 const summary=()=>state.city?group(cityGroups[state.city]):state.sector?group(sectorGroups[state.sector]):allSummary();
 const filterName=()=>[state.city||'Todas as cidades',state.sector||'Todos os setores'].join(' · ');
 function section(title,subtitle,back=false){return `<div class="section-bar"><div><h2>${title}</h2><p>${subtitle}</p></div>${back?`<button class="ghost-link" data-go="home">${ico('back')} Voltar</button>`:''}</div>`}
function metric(name,value,icon,target,sub='',kind=''){return `<button class="metric ${kind}" data-go="${target}" aria-label="${name}, ${safe(value)}. Abrir detalhes"><div class="metric-top"><span class="metric-title">${name}</span><span class="metric-icon">${ico(icon)}</span></div><strong>${safe(value)}</strong><small>${sub||'Toque para ver detalhes'}</small></button>`}
function act(title,desc,icon,target){return `<button class="action-card" data-go="${target}"><span class="action-icon">${ico(icon)}</span><span><h3>${title}</h3><p>${desc}</p></span><span class="action-arrow">${ico('arrow')}</span></button>`}

 function list(kind,key,label){
 const items=(kind==='city'?cities:sectors).map(name=>({name,...group((kind==='city'?cityGroups:sectorGroups)[name])}));
 return `<div class="group-list">${items.map(x=>`<button class="group-row" data-filter-${kind}="${safe(x.name)}"><span><strong>${safe(x.name)}</strong><small>${fmt(x.total)} atendimentos · ${pct(x.completed,x.total)}% concluídos</small></span><span class="amount">${fmt(x[key])}<small>${safe(label)}</small></span>${ico('arrow')}</button>`).join('')||'<p>Nenhum grupo neste relatório.</p>'}</div>`;
}
 function home(){if(!snap)return `${section('Resumo da operação','Nenhum dado demonstrativo será exibido.')}
<section class="surface" role="status"><h3>Aguardando indicadores da empresa</h3><p>Seu acesso está protegido. Ainda não foi possível carregar um relatório autorizado. Toque em Atualizar indicadores para consultar novamente.</p><div class="button-row"><button class="btn" data-action="refresh">Atualizar indicadores</button><button class="btn secondary" data-go="conta">Ver minha conta</button></div></section>`;
const s=summary();return `${section('Resumo da operação','Toque em um número ou escolha uma das ações abaixo.')}
<div class="metric-grid">${metric('Atendimentos',fmt(s.total),'users','atendimentos','Total do período')}${metric('Concluídos',pct(s.completed,s.total)+'%','check','atendimentos',fmt(s.completed)+' concluídos')}${metric('Em aberto',fmt(s.pending),'clock','pendencias','Precisam de atenção','warn')}${metric('Há mais de 7 dias',fmt(s.old),'alert','pendencias','Pendências antigas','danger')}</div>
${section('O que você quer fazer?','Tudo em botões. Escolha uma opção para continuar.')}
<div class="action-grid">${act('Ver atendimentos','Totais, andamento e desempenho','users','atendimentos')}${act('Analisar pendências','Encontre onde é preciso agir','clock','pendencias')}${act('Avaliar resultado','Aprovar ou reprovar relatório','clipboard','avaliacoes')}${act('Gerar relatório','Resumo pronto para imprimir ou exportar','file','relatorios')}</div>
<div class="note" style="margin-top:19px">${ico('info')} Indicadores reais do relatório autorizado. Os filtros de cidade e setor são independentes, sem cruzamento entre eles.</div>`}
function atendimentos(){const s=summary();return `${section('Atendimentos','Entenda o que foi concluído e o que continua aberto.',true)}
<div class="metric-grid">${metric('Total',fmt(s.total),'users','atendimentos','Registros')}${metric('Concluídos',fmt(s.completed),'check','atendimentos','Finalizados')}${metric('Em aberto',fmt(s.pending),'clock','pendencias','Acompanhar','warn')}${metric('Taxa de conclusão',pct(s.completed,s.total)+'%','chart','atendimentos','Do período')}</div>
<div class="secondary-grid" style="margin-top:17px"><section class="surface"><div class="row-flex"><h3>Situação geral</h3><span class="status-pill">Visão consolidada</span></div><div class="stat-big">${pct(s.completed,s.total)}%</div><div class="stat-sub">dos atendimentos concluídos</div><div class="progress"><span style="width:${pct(s.completed,s.total)}%"></span></div><p>${fmt(s.completed)} concluídos de ${fmt(s.total)} atendimentos.</p><div class="button-row"><button class="btn" data-go="pendencias">${ico('clock')} Ver os que faltam</button></div></section><section class="surface"><h3>Visão por cidade</h3><p>Escolha uma cidade para filtrar toda a plataforma.</p>${list('city','total','registros')}</section></div><section class="surface"><h3>Visão por setor</h3>${list('sector','total','registros')}</section>`}
function pendencias(){const s=summary();const critical=s.pending&&s.old!==null?pct(s.old,s.pending):0;return `${section('Pendências','Veja onde há mais trabalho acumulado.',true)}
<div class="metric-grid">${metric('Em aberto',fmt(s.pending),'clock','pendencias','Aguardando conclusão','warn')}${metric('Antigas (+7 dias)',fmt(s.old),'alert','pendencias','Prioridade de análise','danger')}${metric('Recentes',s.old===null?'—':fmt(s.pending-s.old),'users','pendencias','Em aberto há até 7 dias')}${metric('Conclusão',pct(s.completed,s.total)+'%','check','atendimentos','No período')}</div>
<div class="secondary-grid" style="margin-top:17px"><section class="surface"><h3>Onde agir primeiro</h3><p><strong>${fmt(s.old)}</strong> pendências estão abertas há mais de sete dias.</p><div class="progress alt"><span style="width:${critical}%"></span></div><div class="stat-sub">${critical}% das pendências são antigas.</div><div class="hint" style="margin-top:18px">Esses números indicam pontos de atenção. Não atribuem responsabilidade pessoal e não mostram dados individuais de clientes.</div></section><section class="surface"><h3>Por cidade</h3><p>Toque para concentrar a análise.</p>${list('city','pending','em aberto')}</section></div><section class="surface"><h3>Por setor</h3>${list('sector','pending','em aberto')}</section><div class="button-row"><button class="btn secondary" data-go="avaliacoes">${ico('clipboard')} Ir para avaliação de resultados</button></div>`}

 function avaliacoes(){
 const s=allSummary(),review=model.review;
 return `${section('Avaliar resultado','Decisão sobre o relatório completo com justificativa e auditoria.',true)}
 <section class="surface"><h3>Relatório autorizado</h3><p>${safe(snap?.earliest||'—')} até ${safe(snap?.latest||'—')} · ${safe(snap?.source||'Nenhum relatório')}</p>
 ${snap?`<div class="metric-grid" style="margin:18px 0">${metric('Atendimentos',fmt(s.total),'users','atendimentos')}${metric('Concluídos',fmt(s.completed),'check','atendimentos')}${metric('Pendentes',fmt(s.pending),'clock','pendencias')}${metric('Antigos +7 dias',fmt(s.old),'alert','pendencias')}</div>`:''}
 <div class="note">A decisão vale para o relatório inteiro, independentemente do filtro selecionado. Não altera registros individuais.</div></section>
 <section class="surface"><h3>${review?'Decisão registrada':'Qual sua decisão?'}</h3>
 ${!snap?'<p>Nenhum relatório disponível. Aguarde a importação pelo MASTER.</p>':
 review?`<div class="notice-success"><strong>${review.decision==='approve'?'Aprovado':'Reprovado'}</strong><p>Justificativa: ${safe(review.rationale)}</p><small>Registro imutável · ${safe(new Date(review.reviewed_at).toLocaleString('pt-BR'))}</small></div>${review.decision==='reject'?'<div class="button-row"><button class="btn" data-go="diagnosis">Ver diagnóstico</button></div>':''}`:
 `<div class="approval-grid"><button class="choice approve ${state.choice==='approve'?'selected':''}" data-choice="approve" ${model.reviewBusy?'disabled':''}>${ico('check')} Aprovar relatório <small>Indicadores aceitos</small></button><button class="choice reject ${state.choice==='reject'?'selected':''}" data-choice="reject" ${model.reviewBusy?'disabled':''}>${ico('alert')} Reprovar relatório <small>Solicitar revisão</small></button></div>
 ${state.choice?`<label class="form-label" for="review-reason">Justificativa obrigatória (20 a 2000 caracteres)</label><textarea id="review-reason" maxlength="2000" placeholder="Escreva os fatos que justificam sua decisão."></textarea><div id="reason-count" class="char-count"></div>
 <div class="button-row"><button class="btn ${state.choice==='reject'?'danger':''}" data-action="confirm-review" ${model.reviewBusy?'disabled':''}>${model.reviewBusy?'Gravando...':'Confirmar decisão'}</button><button class="btn neutral" data-action="cancel-review">Cancelar</button></div>`:''}`}
 ${model.reviewError?`<div class="error-notice" role="alert">${safe(model.reviewError)}</div>`:''}</section>`;
}
 function relatorios(){
 const s=summary(),groups=state.city?[]:state.sector?[[state.sector,sectorGroups[state.sector]]]:Object.entries(sectorGroups);
 return `${section('Relatório executivo','Resumo do período importado, sem dados individuais.',true)}
 <section class="surface"><h3>Resumo da operação</h3><p>${safe(filterName())} · ${safe(snap?.earliest||'—')} a ${safe(snap?.latest||'—')}</p>
 ${snap?`<div class="metric-grid" style="margin:18px 0">${metric('Atendimentos',fmt(s.total),'users','atendimentos')}${metric('Concluídos',fmt(s.completed),'check','atendimentos')}${metric('Pendentes',fmt(s.pending),'clock','pendencias')}${metric('Antigos +7 dias',fmt(s.old),'alert','pendencias')}</div>
 ${state.city?'<p class="note">O relatório não contém o cruzamento cidade × setor. A distribuição por setor não pode ser exibida com filtro de cidade.</p>':
 `<h3>Resumo por setor</h3><div class="table-wrap"><table><thead><tr><th>Setor</th><th>Atendimentos</th><th>Concluídos</th><th>Pendentes</th></tr></thead><tbody>${groups.map(([n,g])=>`<tr><td>${safe(n)}</td><td>${fmt(g.total)}</td><td>${fmt(g.finalized)}</td><td>${fmt(g.pending)}</td></tr>`).join('')}</tbody></table></div>`}
 <div class="button-row"><button class="btn" data-action="print">${ico('file')} Imprimir / salvar PDF</button><button class="btn secondary" data-action="csv">${ico('download')} Exportar CSV</button></div>
 <p class="stat-sub">Indicadores autorizados do relatório importado. Não representam dados em tempo real.</p>`:'<p>Nenhum relatório autorizado para esta empresa.</p>'}
 </section>`;
}
 function conta(){
 return `${section('Minha conta','Seu perfil, segurança e preferências.',true)}
 <div class="secondary-grid"><section class="surface"><h3>Perfil de acesso</h3><p><strong>${safe(model.role==='administrador'?'Administrador':'Gestor')}</strong> · ${safe(model.email)}</p><div class="note">${ico('shield')} Acesso restrito por empresa com MFA e permissões no servidor.</div></section>
 <section class="surface"><h3>O que posso fazer?</h3><div class="group-list"><div class="group-row">${ico('check')} Consultar indicadores consolidados</div><div class="group-row">${ico('check')} Aprovar ou reprovar relatórios com justificativa</div><div class="group-row">${ico('check')} Exportar relatórios autorizados</div><div class="group-row">${ico('shield')} Sem importação ou administração MASTER</div></div></section></div>
 ${model.tenants?.length>1?`<section class="surface"><h3>Empresa ativa</h3><select id="tenant">${model.tenants.map(t=>`<option value="${safe(t.tenant_id)}" ${t.tenant_id===model.tenantId?'selected':''}>${safe(t.tenant_id)}</option>`).join('')}</select></section>`:''}
 <section class="surface"><h3>Interface do Gestor</h3><p>A interface anterior continua disponível, sem modificar dados ou permissões.</p><div class="manager-toggles"><button data-action="classic">Abrir painel clássico</button><button data-action="refresh">Atualizar indicadores</button></div></section>
 <div class="button-row"><button class="btn secondary" data-go="home">Voltar ao início</button><button class="btn danger" data-action="logout">Sair com segurança</button></div>`;
}
 function diagnosis(){
 const r=model.review,s=allSummary();
 return `${section('Diagnóstico','Resultados a investigar.',true)}<section class="surface"><h3>${r?.decision==='reject'?'Relatório reprovado':'Não existe reprovação'}</h3>
 ${r?.decision==='reject'?`<p><strong>Justificativa:</strong> ${safe(r.rationale)}</p><div class="metric-grid">${metric('Pendentes',fmt(s.pending),'clock','pendencias')}${metric('Antigos +7 dias',fmt(s.old),'alert','pendencias')}</div><p class="hint">Possíveis motivos exigem verificação humana. Os dados não comprovam responsabilidade de pessoas.</p>`:'<p>O diagnóstico só aparece após uma reprovação registrada.</p>'}</section>`;
}
 function renderSimple(){
 const titles={home:['Olá, Gestor! 👋','Escolha o que deseja acompanhar. Toque nos botões e veja os resultados sem complicação.','grid'],atendimentos:['Atendimentos','Veja os números sem procurar em vários menus.','users'],pendencias:['O que precisa de atenção?','Encontre pendências em poucos toques.','clock'],avaliacoes:['Avaliar resultados','Aprovar ou reprovar com justificativa auditada.','clipboard'],relatorios:['Gerar relatório','Veja e exporte os resultados autorizados.','file'],conta:['Meu acesso','Seu perfil e permissões.','shield'],diagnosis:['Diagnóstico','Indicadores a investigar após reprovação.','alert']};
 const views={home,atendimentos,pendencias,avaliacoes,relatorios,conta,diagnosis};
 const t=titles[state.view]||titles.home;
 $('#hero-title').textContent=t[0];$('#hero-copy').textContent=t[1];$('#hero-icon').innerHTML=ico(t[2]);$('#account-icon').innerHTML=ico('user');
 $('#filter-note').innerHTML=ico('info')+`<span>Filtro: <strong>${safe(filterName())}</strong> · ${safe(snap?.earliest||'—')} a ${safe(snap?.latest||'—')}. Cidade ou setor, sem cruzamento.</span>`;
 $('#content').innerHTML=(views[state.view]||home)();
 const a=$('#review-reason');if(a){a.value=state.reason;const c=$('#reason-count');if(c)c.textContent=`${state.reason.trim().length} caracteres (mínimo 20)`;}
}
 function boot(){
 $('#city').innerHTML='<option value="">Todas as cidades</option>'+cities.map(x=>`<option value="${safe(x)}">${safe(x)}</option>`).join('');
 $('#sector').innerHTML='<option value="">Todos os setores</option>'+sectors.map(x=>`<option value="${safe(x)}">${safe(x)}</option>`).join('');
 $('#city').value=state.city;$('#sector').value=state.sector;
 $('.preview-tag').textContent=snap?'DADOS IMPORTADOS · MFA':'SEM RELATÓRIOS';
 $('.brand-copy small').textContent=(model.role==='administrador'?'Painel do Administrador':'Painel do Gestor')+' · v'+String(model.build||'137');
 const filter=(k,v)=>{if(v&&!(k==='city'?cities:sectors).includes(v))return;state[k]=v;const other=k==='city'?'sector':'city';state[other]='';$('#'+k).value=v;$('#'+other).value='';state.choice='';state.reason='';renderSimple();};
 $('#city').addEventListener('change',e=>filter('city',e.target.value));
 $('#sector').addEventListener('change',e=>filter('sector',e.target.value));
 root.addEventListener('input',e=>{if(e.target.id==='review-reason'){state.reason=e.target.value;const c=$('#reason-count');if(c)c.textContent=`${state.reason.trim().length} caracteres (mínimo 20)`;}});
 root.addEventListener('change',e=>{if(e.target.id==='tenant'&&e.target.value!==model.tenantId)handlers.switchTenant(e.target.value);});
 root.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b||state.sending)return;
 if(b.hasAttribute('data-go')){if(!['home','atendimentos','pendencias','avaliacoes','relatorios','conta','diagnosis'].includes(b.dataset.go))return;state.view=b.dataset.go;state.choice='';state.reason='';renderSimple();window.scrollTo({top:0,behavior:'instant'});return;}
 if(b.hasAttribute('data-filter-city')){filter('city',b.dataset.filterCity);return;}
 if(b.hasAttribute('data-filter-sector')){filter('sector',b.dataset.filterSector);return;}
 if(b.hasAttribute('data-choice')){if(!snap||model.review)return;state.choice=b.dataset.choice;state.reason='';renderSimple();$('#review-reason')?.focus();return;}
 const action=b.dataset.action;
 if(action==='clear-filters'){filter('city','');filter('sector','');return;}
 if(action==='cancel-review'){state.choice='';state.reason='';renderSimple();return;}
 if(action==='confirm-review'){state.reason=$('#review-reason')?.value?.trim()||'';if(!snap||model.review||!['approve','reject'].includes(state.choice)||state.reason.length<20||state.reason.length>2000){$('#review-reason')?.focus();return;}state.sending=true;b.disabled=true;try{await handlers.review(state.choice,state.reason);state.choice='';state.reason='';}finally{state.sending=false;}return;}
 if(action==='print'){if(snap)window.print();return;}
 if(action==='csv'){if(snap)handlers.export({city:state.city,sector:state.sector});return;}
 if(action==='classic'){handlers.classic();return;}
 if(action==='refresh'){handlers.refresh();return;}
 if(action==='logout'){handlers.logout();return;}
 });
 renderSimple();
}
 boot();
}
