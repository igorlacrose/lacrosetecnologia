/* Dados de COLABORADORES: nomes permitidos apenas para gestao interna.
 * Nunca lê nem mantém Cliente, CPF, contato, login ou senha do IXC.
 * Fonte: somente coluna Colaborador (mapeada explicitamente) + operacionais aprovadas.
 */
import {MAX_ROWS,cleanStatus,cleanSector,parseDate} from './engine.js';

const namePattern=/^[\p{L}\p{N} .'-()]{2,80}$/u;
export function cleanEmployeeName(value){
  if(typeof value!=='string')return null;
  const s=value.normalize('NFC').replace(/\s+/g,' ').trim();
  // Evita email, telefone, documento, enderecos, texto livre e identificadores externos.
  if(s.length<2||s.length>80||!namePattern.test(s)||!/[\p{L}]{2}/u.test(s)||/\d{5,}|@|https?:/i.test(s))return null;
  return s;
}
export function buildEmployeeMetrics(rows,mapping,referenceDate=null){
  if(!Number.isInteger(mapping?.Colaborador)||mapping.Colaborador<0)
    return {metrics:[],assigned:0,unassigned:rows.length,missingColumn:true};
  const get=(row,key)=>Number.isInteger(mapping[key])&&mapping[key]>=0?row[mapping[key]]:null;
  const raw=Array.isArray(rows)?rows:[];
  if(raw.length>MAX_ROWS)throw Error('Limite excedido.');
  const reference=referenceDate?Date.parse(referenceDate+'T00:00:00Z'):NaN;
  const groups=new Map();
  let assigned=0,unassigned=0;
  for(const row of raw){
    if(!Array.isArray(row)||row.every(v=>v===null||v===undefined||v===''))continue;
    const name=cleanEmployeeName(get(row,'Colaborador'));
    if(!name){unassigned++;continue;}
    assigned++;
    const sector=cleanSector(get(row,'Setor'));
    const key=name.toLocaleLowerCase('pt-BR')+'\u0000'+sector;
    if(!groups.has(key))groups.set(key,{name,sector,total:0,finalized:0,pending:0,closedWithDates:0,closedOver24:0,pendingOlder7d:0});
    const e=groups.get(key);
    const status=cleanStatus(get(row,'Status'));
    const start=parseDate(get(row,'Abertura')),end=parseDate(get(row,'Fechamento'));
    const closed=status==='Finalizada';
    e.total++;
    if(closed){
      e.finalized++;
      if(start!==null&&end!==null){
        e.closedWithDates++;
        if(end-start>86400000)e.closedOver24++;
      }
    }else{
      e.pending++;
      if(start!==null&&Number.isFinite(reference)&&reference-start>7*86400000)e.pendingOlder7d++;
    }
  }
  const metrics=[...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')||a.sector.localeCompare(b.sector,'pt-BR'));
  return {metrics,assigned,unassigned,missingColumn:false};
}
