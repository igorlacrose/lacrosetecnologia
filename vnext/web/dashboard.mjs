const stage={qualification:'Qualificação',proposal:'Proposta',negotiation:'Negociação',won:'Ganha',lost:'Perdida'};
const segment={new:'Novo',active:'Ativo',followup:'Acompanhamento',inactive:'Inativo',unclassified:'Sem classificação'};
const channel={internal:'Interno',phone:'Telefone',email:'E-mail',whatsapp:'WhatsApp',meeting:'Reunião',oca:'OCA'};
const brl=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
const ns='http://www.w3.org/2000/svg';
function svg(tag,attrs={},children=[]){const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));for(const c of children)n.append(typeof c==='string'?document.createTextNode(c):c);return n;}
function graph(title,children,viewBox='0 0 520 180'){return svg('svg',{viewBox,role:'img','aria-label':title,class:'dash-svg'},[svg('title',{},[title]),...children]);}
const colors=['#2563eb','#0891b2','#16a34a','#d97706','#64748b','#7c3aed','#db2777','#94a3b8'];
function chartBars(e,rows,labels){
 if(!rows.some(x=>x.value>0))return e('p','Sem registros.');
 const max=Math.max(1,...rows.map(x=>x.value));
 return graph('Distribuição',rows.flatMap((r,i)=>[svg('text',{x:0,y:i*35+12,class:'dash-axis'},[(labels[r.name]??r.name).slice(0,40)]),svg('rect',{x:0,y:i*35+18,width:420*r.value/max,height:9,rx:4,fill:colors[i%8]}),svg('text',{x:440,y:i*35+26,class:'dash-axis'},[String(r.value)])]),'0 0 520 '+Math.max(60,rows.length*35));
}
function ring(e,rows,labels){
 const total=rows.reduce((s,r)=>s+r.value,0);if(!total)return e('p','Sem registros.');
 let offset=0;const circumference=2*Math.PI*49;
 const arcs=rows.map((r,i)=>{const len=r.value/total*circumference;const arc=svg('circle',{cx:80,cy:70,r:49,fill:'none','stroke-width':13,stroke:colors[i%8],'stroke-dasharray':len+' '+(circumference-len),'stroke-dashoffset':-offset,transform:'rotate(-90 80 70)'},[svg('title',{},[(labels[r.name]??r.name)+': '+r.value])]);offset+=len;return arc;});
 const wrap=e('div',undefined,'dash-ring');wrap.append(graph('Distribuição',[...arcs,svg('text',{x:80,y:75,'text-anchor':'middle',class:'dash-total'},[String(total)])],'0 0 160 140'));
 const legend=e('div',undefined,'records');rows.forEach((r,i)=>legend.append(e('p',(labels[r.name]??r.name)+' · '+r.value+' ('+Math.round(r.value/total*100)+'%)')));wrap.append(legend);return wrap;
}
function cashGraph(e,rows,start,end){
 if(!rows.length)return e('p','Sem movimentos no caixa neste período.');
 const d=new Date(start+'T12:00:00Z'),last=new Date(end+'T12:00:00Z'),days=Math.round((last-d)/86400000)+1,step=Math.ceil(days/7);
 const buckets=[];for(let i=0;i<days;i+=step){const day=new Date(+d+i*86400000).toISOString().slice(0,10),until=new Date(+d+Math.min(days-1,i+step-1)*86400000).toISOString().slice(0,10);const list=rows.filter(r=>r.day>=day&&r.day<=until);buckets.push({day,received:list.reduce((s,r)=>s+Number(r.received),0),reversed:list.reduce((s,r)=>s+Number(r.reversed),0)});}
 const max=Math.max(1,...buckets.flatMap(b=>[b.received,b.reversed])),x=i=>48+i*450/Math.max(1,buckets.length-1),y=n=>152-125*n/max;
 const series=k=>buckets.map((b,i)=>(i?'L':'M')+x(i)+' '+y(b[k])).join(' ');
 const area=series('received')+' L'+x(buckets.length-1)+' 152 L48 152 Z';
 return graph('Evolução dos recebimentos e estornos em dinheiro',[
  svg('defs',{},[svg('linearGradient',{id:'lkzCashArea',x1:'0',y1:'0',x2:'0',y2:'1'},[svg('stop',{offset:'0%','stop-color':'#2563eb','stop-opacity':'.28'}),svg('stop',{offset:'100%','stop-color':'#2563eb','stop-opacity':'.02'})])]),
  ...[0,1,2,3,4].map(i=>svg('line',{x1:48,y1:27+i*31.25,x2:498,y2:27+i*31.25,stroke:'#e2e8f0','stroke-dasharray':'3 4'})),
  svg('path',{d:area,fill:'url(#lkzCashArea)'}),
  svg('path',{d:series('received'),fill:'none',stroke:'#2563eb','stroke-width':2.5,'stroke-linejoin':'round'}),
  svg('path',{d:series('reversed'),fill:'none',stroke:'#94a3b8','stroke-width':2,'stroke-dasharray':'5 3'}),
  ...buckets.flatMap((b,i)=>[svg('circle',{cx:x(i),cy:y(b.received),r:3,fill:'#2563eb'},[svg('title',{},[b.day+' · Recebido '+brl(b.received)+' · Estornado '+brl(b.reversed)])]),svg('text',{x:x(i),y:175,'text-anchor':'middle',class:'dash-axis'},[b.day.slice(8)+'/'+b.day.slice(5,7)])])
 ],'0 0 530 190');
}
const preferences={period:'month',hidden:new Set()};
export async function buildDashboard({api,element:e,card,navigate,isCurrent,message}){
 const root=e('div',undefined,'fuel-dashboard'),controls=e('div',undefined,'dash-controls'),kpis=e('div',undefined,'fuel-kpis'),grid=e('div',undefined,'dash-grid');
 const period=e('select');period.setAttribute('aria-label','Período dos indicadores de movimento');
 for(const [key,label] of [['week','Últimos 7 dias'],['month','Últimos 30 dias'],['quarter','Últimos 90 dias']])period.add(new Option(label,key));period.value=preferences.period;
 const choices=e('details');choices.append(e('summary','Personalizar gráficos'));
 const labels={recent:'Relacionamentos recentes',clients:'Carteira de clientes',cash:'Evolução de caixa',products:'Assinaturas por produto',stages:'Funil comercial',contacts:'Atendimentos por canal'};
 for(const [key,label] of Object.entries(labels)){const l=e('label',label),check=e('input');check.type='checkbox';check.checked=!preferences.hidden.has(key);check.onchange=()=>{if(check.checked)preferences.hidden.delete(key);else preferences.hidden.add(key);for(const c of grid.children)c.hidden=preferences.hidden.has(c.dataset.chart);};l.prepend(check);choices.append(l);}
 controls.append(period,choices);root.append(controls,kpis,grid);
 let version=0;async function refresh(){
  const v=++version;const data=await api('dashboard',undefined,{period:period.value});if(!isCurrent()||v!==version)return;grid.replaceChildren();kpis.replaceChildren();
  function add(key,value,desc,chart,route){const panel=e('div',undefined,'dash-panel'),heading=e('div',undefined,'dash-head'),h=e('div');h.append(e('h2',labels[key]),e('strong',value,'dash-value'));const b=e('button','Ver detalhes');b.type='button';b.onclick=()=>navigate(route);heading.append(h,b);panel.append(heading,chart,e('p',desc,'dash-note'));panel.dataset.chart=key;panel.hidden=preferences.hidden.has(key);grid.append(panel);}
  const total=rows=>rows.reduce((s,r)=>s+r.value,0);
  function kpi(label,value,note,icon,route){const box=e('button',undefined,'fuel-kpi');box.type='button';box.onclick=()=>navigate(route);const top=e('span',undefined,'fuel-kpi-label');top.append(e('span',icon,'fuel-kpi-icon'),e('span',label));box.append(top,e('strong',String(value)),e('small',note));kpis.append(box);}
  const receipts=data.cash?.reduce((s,r)=>s+Number(r.received),0),reversed=data.cash?.reduce((s,r)=>s+Number(r.reversed),0);
  if(data.cash!==null)kpi('Caixa líquido',brl(receipts-reversed),'Dinheiro · período selecionado','R$','cash');
  kpi('Clientes',total(data.clients),'Carteira não arquivada','C','clients');
  kpi('Leads abertos',data.totals.open_leads,'Ainda não convertidos','L','leads');
  kpi('Assinaturas',data.totals.drafts,'Rascunhos · não são receita','A','subscription_drafts');
  const table=e('div',undefined,'fuel-table-scroll');
  if(data.recent.length){const t=e('table',undefined,'fuel-table'),head=e('thead'),hr=e('tr');for(const label of ['Cliente','Canal','Data e hora'])hr.append(e('th',label));head.append(hr);t.append(head);const body=e('tbody');for(const r of data.recent){const row=e('tr');row.append(e('td',r.client),e('td',channel[r.channel]??r.channel),e('td',new Date(r.created_at).toLocaleString('pt-BR')));body.append(row);}t.append(body);table.append(t);}else table.append(e('p',data.restricted?'Histórico restrito à equipe autorizada.':'Nenhum contato recente no período.'));
  add('recent',String(data.recent.length),'Últimos 6 registros da ficha de relacionamento no período.',table,'clients');
  add('clients',String(total(data.clients)),'Posição atual da carteira'+(data.restricted?' · classificação restrita.':'.'),ring(e,data.clients,segment),'clients');
  if(data.cash!==null)add('cash',brl(receipts-reversed),'Recebimentos '+brl(receipts)+' · estornos '+brl(reversed)+' · '+data.start_date+' a '+data.end_date+'. Apenas dinheiro registrado.',cashGraph(e,data.cash,data.start_date,data.end_date),'cash');
  const ranking=e('div',undefined,'fuel-ranking');data.products.forEach((p,i)=>{const row=e('div');row.append(e('span',String(i+1),'fuel-rank'),e('strong',p.name),e('span',String(p.value)));ranking.append(row);});if(!data.products.length)ranking.append(e('p','Sem assinaturas cadastradas.'));
  add('products',String(data.totals.drafts),'Até 8 produtos com assinaturas em rascunho. Não representa contratos ativos.',ranking,'subscription_drafts');
  add('stages',String(total(data.stages)),'Posição atual das oportunidades (todos os períodos).',chartBars(e,data.stages,stage),'opportunities');
  add('contacts',String(total(data.contacts)),'Atendimentos registrados no período'+(data.restricted?' (histórico CRM restrito).':'.'),ring(e,data.contacts,channel),'interactions');
 }
 period.onchange=()=>{preferences.period=period.value;refresh().catch(err=>{if(isCurrent())message(err.message,true);});};
 await refresh();return root;
}
