import {detectMapping,buildSnapshot,radarItems,calculateCost,moneyBRL,sampleCost} from './engine.js';

const headers=['Status','Assunto','Setor','Cidade','Abertura','Fechamento','Prioridade'];
const mapping=detectMapping(headers);
const initial=Array.from({length:80},(_,i)=>[
  i%4?'Finalizada':'Aberta',
  i%3?'SEM CONEXÃO':'ENTREGA DE BOLETO',
  i%2?'Call Center':'Financeiro','Jequié',46305+(i%12),i%4?46306+(i%12):null,'Normal'
]);
let state;
const el=id=>document.getElementById(id);
function render(){
  const snapshot=buildSnapshot(state.rows,mapping,{source:'Dados fictícios'});
  el('total').textContent=String(snapshot.total);
  el('finalized').textContent=String(snapshot.finalized);
  el('pending').textContent=String(snapshot.pending);
  const list=el('subjects');
  list.replaceChildren();
  for(const [name,group] of Object.entries(snapshot.subjects)){
    const item=document.createElement('li');
    item.textContent=name+' · '+group.total+' atendimentos · '+group.pending+' pendentes';
    list.append(item);
  }
  const signals=el('signals');
  signals.replaceChildren();
  const radar=radarItems(snapshot);
  if(!radar.length){const item=document.createElement('li');item.textContent='Nenhum alerta encontrado nos dados fictícios.';signals.append(item)}
  for(const signal of radar){
    const item=document.createElement('li');
    item.textContent=signal.name+' · '+signal.evidence;
    signals.append(item);
  }
  el('cost').textContent=moneyBRL(calculateCost(state.cost));
}
function persist(){
  window.parent.postMessage({type:'lacrose-demo-save',data:JSON.stringify(state)},location.origin);
}
if(window.parent===window)location.replace('./');
window.addEventListener('message',event=>{
  if(window.parent===window||event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='lacrose-demo-init'||state)return;
  try{
    const stored=JSON.parse(event.data.data);
    if(stored&&Array.isArray(stored.rows)&&stored.rows.length<=300&&stored.rows.every(row=>Array.isArray(row)&&row.length===7)&&stored.cost&&typeof stored.cost==='object'){
      state=stored;
      buildSnapshot(state.rows,mapping);
    }
  }catch{state=null}
  if(!state)state={rows:initial,cost:{...sampleCost}};
  const form=el('costForm');
  for(const key of Object.keys(sampleCost))form.elements[key].value=state.cost[key]??sampleCost[key];
  render();
});
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{
  for(const section of document.querySelectorAll('main section'))section.hidden=section.id!==button.dataset.view;
  for(const link of document.querySelectorAll('[data-view]'))link.removeAttribute('aria-current');
  button.setAttribute('aria-current','page');
}));
el('costForm').addEventListener('submit',event=>{
  event.preventDefault();
  if(!state)return;
  const values=new FormData(event.currentTarget);
  for(const key of Object.keys(sampleCost))state.cost[key]=String(values.get(key));
  persist();
  render();
});
el('recordForm').addEventListener('submit',event=>{
  event.preventDefault();
  if(!state)return;
  if(state.rows.length>=300){el('recordStatus').textContent='Limite de atendimentos desta demonstração alcançado.';return}
  const form=new FormData(event.currentTarget);
  state.rows.push([form.get('status'),form.get('subject'),form.get('sector'),'Jequié',46306,form.get('status')==='Finalizada'?46307:null,'Normal']);
  persist();
  render();
  el('recordStatus').textContent='Atendimento fictício adicionado.';
});
