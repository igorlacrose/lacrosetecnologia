const stage={qualification:'Qualificação',proposal:'Proposta',negotiation:'Negociação',won:'Ganha',lost:'Perdida'};
const segment={new:'Novo',active:'Ativo',followup:'Acompanhamento',inactive:'Inativo',unclassified:'Sem classificação'};
const channel={internal:'Interno',phone:'Telefone',email:'E-mail',whatsapp:'WhatsApp',meeting:'Reunião',oca:'OCA'};
const brl=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
const ns='http://www.w3.org/2000/svg';
function svg(tag,attrs={},children=[]){const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));for(const c of children)n.append(typeof c==='string'?document.createTextNode(c):c);return n;}
function graph(title,children,viewBox='0 0 520 180'){return svg('svg',{viewBox,role:'img','aria-label':title,class:'dash-svg'},[svg('title',{},[title]),...children]);}
const colors=['#0b6d86','#429fb0','#8bbac5','#8597ae','#c6a05c','#8d789f','#638d72','#b9c6d0'];
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
 const max=Math.max(1,...buckets.flatMap(b=>[b.received,b.reversed])),width=460/buckets.length;
 return graph('Recebimentos e estornos em dinheiro',buckets.flatMap((b,i)=>{const x=30+i*width;return ['received','reversed'].map((k,j)=>{const h=110*b[k]/max;return svg('rect',{x:x+j*19,y:135-h,width:16,height:h,rx:3,fill:j?'#8597ae':'#0b6d86'},[svg('title',{},[b.day+' '+brl(b[k])])]);}).concat(svg('text',{x:x+18,y:158,'text-anchor':'middle',class:'dash-axis'},[b.day.slice(8)+'/'+b.day.slice(5,7)]));}));
}
const preferences={period:'month',hidden:new Set()};
export async function buildDashboard({api,element:e,card,navigate,isCurrent,message}){
 const root=e('div'),controls=e('div',undefined,'dash-controls'),grid=e('div',undefined,'dash-grid');
 const period=e('select');period.setAttribute('aria-label','Período dos indicadores de movimento');
 for(const [key,label] of [['week','Últimos 7 dias'],['month','Últimos 30 dias'],['quarter','Últimos 90 dias']])period.add(new Option(label,key));period.value=preferences.period;
 const choices=e('details');choices.append(e('summary','Personalizar gráficos'));
 const labels={cash:'Movimento de caixa',stages:'Funil comercial',clients:'Carteira de clientes',contacts:'Atendimentos',products:'Assinaturas por produto'};
 for(const [key,label] of Object.entries(labels)){const l=e('label',label),check=e('input');check.type='checkbox';check.checked=!preferences.hidden.has(key);check.onchange=()=>{if(check.checked)preferences.hidden.delete(key);else preferences.hidden.add(key);for(const c of grid.children)c.hidden=preferences.hidden.has(c.dataset.chart);};l.prepend(check);choices.append(l);}
 controls.append(period,choices);root.append(controls,grid);
 let version=0;async function refresh(){
  const v=++version;const data=await api('dashboard',undefined,{period:period.value});if(!isCurrent()||v!==version)return;grid.replaceChildren();
  function add(key,value,desc,chart,route){const panel=e('div',undefined,'dash-panel'),heading=e('div',undefined,'dash-head'),h=e('div');h.append(e('h2',labels[key]),e('strong',value,'dash-value'));const b=e('button','Ver detalhes');b.type='button';b.onclick=()=>navigate(route);heading.append(h,b);panel.append(heading,chart,e('p',desc,'dash-note'));panel.dataset.chart=key;panel.hidden=preferences.hidden.has(key);grid.append(panel);}
  const total=rows=>String(rows.reduce((s,r)=>s+r.value,0));
  if(data.cash!==null){const receipts=data.cash.reduce((s,r)=>s+Number(r.received),0),reversed=data.cash.reduce((s,r)=>s+Number(r.reversed),0);add('cash',brl(receipts-reversed),'Dinheiro registrado · recebimentos '+brl(receipts)+' · estornos '+brl(reversed)+' · '+data.start_date+' a '+data.end_date+'. Não inclui faturamento de outros meios.',cashGraph(e,data.cash,data.start_date,data.end_date),'cash');}
  add('stages',total(data.stages),'Posição atual das oportunidades (todos os períodos).',chartBars(e,data.stages,stage),'opportunities');
  add('clients',total(data.clients),'Carteira não arquivada · posição atual'+(data.restricted?' (classificação restrita).':'.'),ring(e,data.clients,segment),'clients');
  add('contacts',total(data.contacts),'Atendimentos registrados no período'+(data.restricted?' (histórico CRM restrito).':'.'),ring(e,data.contacts,channel),'interactions');
  add('products',total(data.products),'Até 8 produtos com assinaturas em rascunho. Não representa contratos ativos ou receita.',chartBars(e,data.products,{}),'subscription_drafts');
 }
 period.onchange=()=>{preferences.period=period.value;refresh().catch(err=>{if(isCurrent())message(err.message,true);});};
 await refresh();return root;
}
