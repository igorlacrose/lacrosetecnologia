const stage={qualification:'Qualificação',proposal:'Proposta',negotiation:'Negociação',won:'Ganha',lost:'Perdida'};
const segment={new:'Novo',active:'Ativo',followup:'Acompanhamento',inactive:'Inativo',unclassified:'Sem classificação'};
const channel={internal:'Interno',phone:'Telefone',email:'E-mail',whatsapp:'WhatsApp',meeting:'Reunião',oca:'OCA'};
const brl=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
const ns='http://www.w3.org/2000/svg';
function svg(tag,attrs={},children=[]){const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));for(const c of children)n.append(typeof c==='string'?document.createTextNode(c):c);return n;}
function graph(title,children,viewBox='0 0 520 180'){return svg('svg',{viewBox,role:'img','aria-label':title,class:'dash-svg'},[svg('title',{},[title]),...children]);}
const colors=['#2563eb','#0891b2','#16a34a','#d97706','#64748b','#7c3aed','#db2777','#94a3b8'];
function chartRows(rows,known){const values=new Map(rows.map(r=>[r.name,r.value]));return known?known.map(name=>({name,value:values.get(name)??0})):rows;}
function labelFor(labels,name){return Object.hasOwn(labels,name)?labels[name]:name;}
function chartBars(e,rows,labels,known){
 const data=chartRows(rows,known),max=Math.max(1,...data.map(r=>r.value)),wrap=e('div',undefined,'dash-bar-list');
 for(const [i,r] of data.entries()){
  const row=e('div',undefined,'dash-bar-row'),top=e('div',undefined,'dash-bar-label');
  top.append(e('span',labelFor(labels,r.name)),e('strong',String(r.value)));
  row.append(top,graph(labelFor(labels,r.name)+': '+r.value,[svg('rect',{x:0,y:0,width:400,height:12,rx:6,fill:'#e8eef6'}),svg('rect',{x:0,y:0,width:400*r.value/max,height:12,rx:6,fill:colors[i%colors.length]})],'0 0 400 12'));wrap.append(row);
 }
 if(!data.length)wrap.append(graph('Sem registros',[0,1,2,3].map(i=>svg('line',{x1:20,y1:25+i*36,x2:500,y2:25+i*36,stroke:'#e2e8f0','stroke-dasharray':'4 5'})),'0 0 520 155'));
 if(!data.some(r=>r.value>0))wrap.append(e('p','Sem registros nesta distribuição.','dash-note'));
 return wrap;
}
function ring(e,rows,labels,known){
 const data=chartRows(rows,known),total=data.reduce((s,r)=>s+r.value,0);
 let offset=0;const circumference=2*Math.PI*49;
 const arcs=total?data.flatMap((r,i)=>{if(!r.value)return [];const len=r.value/total*circumference;const arc=svg('circle',{cx:80,cy:70,r:49,fill:'none','stroke-width':15,stroke:colors[i%colors.length],'stroke-dasharray':len+' '+(circumference-len),'stroke-dashoffset':-offset,transform:'rotate(-90 80 70)'},[svg('title',{},[labelFor(labels,r.name)+': '+r.value])]);offset+=len;return [arc];}):[];
 const wrap=e('div',undefined,'dash-ring');wrap.append(graph('Distribuição: '+total+' registros',[svg('circle',{cx:80,cy:70,r:49,fill:'none','stroke-width':15,stroke:'#e8eef6'}),...arcs,svg('text',{x:80,y:68,'text-anchor':'middle',class:'dash-total'},[String(total)]),svg('text',{x:80,y:83,'text-anchor':'middle',class:'dash-axis'},['Total'])],'0 0 160 140'));
 const legend=e('div',undefined,'dash-legend');
 data.forEach((r,i)=>{const row=e('div',undefined,'dash-legend-row');row.append(graph('Cor de '+labelFor(labels,r.name),[svg('circle',{cx:5,cy:5,r:4,fill:colors[i%colors.length]})],'0 0 10 10'),e('span',labelFor(labels,r.name)),e('strong',r.value+' · '+(total?Math.round(r.value/total*100):0)+'%'));legend.append(row);});
 if(!total)legend.append(e('p','Sem registros.','dash-note'));wrap.append(legend);return wrap;
}
function cashGraph(e,rows,start,end){
 const wrap=e('div',undefined,'dash-cash-graph');
 const d=new Date(start+'T12:00:00Z'),last=new Date(end+'T12:00:00Z'),days=Math.round((last-d)/86400000)+1,step=Math.ceil(days/7);
 const buckets=[];for(let i=0;i<days;i+=step){const day=new Date(+d+i*86400000).toISOString().slice(0,10),until=new Date(+d+Math.min(days-1,i+step-1)*86400000).toISOString().slice(0,10);const list=rows.filter(r=>r.day>=day&&r.day<=until);buckets.push({day,received:list.reduce((s,r)=>s+Number(r.received),0),reversed:list.reduce((s,r)=>s+Number(r.reversed),0)});}
 const max=Math.max(1,...buckets.flatMap(b=>[b.received,b.reversed])),x=i=>48+i*450/Math.max(1,buckets.length-1),y=n=>152-125*n/max;
 const series=k=>buckets.map((b,i)=>(i?'L':'M')+x(i)+' '+y(b[k])).join(' ');
 const area=series('received')+' L'+x(buckets.length-1)+' 152 L48 152 Z';
 wrap.append(graph('Evolução dos recebimentos e estornos em dinheiro',[
  svg('defs',{},[svg('linearGradient',{id:'lkzCashArea',x1:'0',y1:'0',x2:'0',y2:'1'},[svg('stop',{offset:'0%','stop-color':'#2563eb','stop-opacity':'.28'}),svg('stop',{offset:'100%','stop-color':'#2563eb','stop-opacity':'.02'})])]),
  ...[0,1,2,3,4].map(i=>svg('line',{x1:48,y1:27+i*31.25,x2:498,y2:27+i*31.25,stroke:'#e2e8f0','stroke-dasharray':'3 4'})),
  svg('path',{d:area,fill:'url(#lkzCashArea)'}),
  svg('path',{d:series('received'),fill:'none',stroke:'#2563eb','stroke-width':2.5,'stroke-linejoin':'round'}),
  svg('path',{d:series('reversed'),fill:'none',stroke:'#d97706','stroke-width':2,'stroke-dasharray':'5 3'}),
  ...buckets.flatMap((b,i)=>[svg('circle',{cx:x(i),cy:y(b.received),r:3,fill:'#2563eb'},[svg('title',{},[b.day+' · Recebido '+brl(b.received)+' · Estornado '+brl(b.reversed)])]),svg('text',{x:x(i),y:175,'text-anchor':'middle',class:'dash-axis'},[b.day.slice(8)+'/'+b.day.slice(5,7)])])
 ],'0 0 530 190'));
 const legend=e('div',undefined,'dash-cash-legend');legend.append(e('span','● Recebimentos','dash-receipts'),e('span','● Estornos','dash-reversed'));wrap.append(legend);
 if(!rows.length)wrap.append(e('p','Nenhum lançamento no período. Valores zerados.','dash-note'));
 return wrap;
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
  if(data.cash!==null)add('cash',brl(receipts-reversed),'Recebimentos '+brl(receipts)+' · estornos '+brl(reversed)+' · '+data.start_date+' a '+data.end_date+'. Apenas dinheiro registrado.',cashGraph(e,data.cash,data.start_date,data.end_date),'cash');
  add('clients',String(total(data.clients)),'Posição atual da carteira'+(data.restricted?' · classificação restrita.':'.'),ring(e,data.clients,segment,data.restricted?['unclassified']:Object.keys(segment)),'clients');
  add('stages',String(total(data.stages)),'Posição atual das oportunidades (todos os períodos).',chartBars(e,data.stages,stage,Object.keys(stage)),'opportunities');
  add('contacts',String(total(data.contacts)),'Atendimentos registrados no período'+(data.restricted?' (histórico CRM restrito).':'.'),ring(e,data.contacts,channel,Object.keys(channel)),'interactions');
  add('products',String(data.totals.drafts),'Até 8 produtos com assinaturas em rascunho. Não representa contratos ativos.',chartBars(e,data.products,{}),'subscription_drafts');
  add('recent',String(data.recent.length),'Últimos 6 registros da ficha de relacionamento no período.',table,'clients');
 }
 period.onchange=()=>{preferences.period=period.value;refresh().catch(err=>{if(isCurrent())message(err.message,true);});};
 await refresh();return root;
}
