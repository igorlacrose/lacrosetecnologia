/* LKZ ISP Intelligence - motor analítico seguro.
 * REGRA: somente contagens e categorias CANÔNICAS saem deste módulo.
 * Nunca retornar linhas brutas, nomes, IDs, mensagens ou credenciais.
 */
export const MAX_BYTES = 15 * 1024 * 1024;
export const MAX_ROWS = 50000;
export const MAX_CELL_CHARS = 500;

const plain = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const contains = (s, x) => plain(s).includes(x);

export const REQUIRED = ['Status', 'Assunto', 'Abertura'];
export const SAFE_COLUMNS = ['Status','Assunto','Setor','Cidade','Abertura','Fechamento','Prioridade'];
export const COLUMN_ALIASES = {
  Status:['STATUS','SITUACAO','SITUACAO ATENDIMENTO'],
  Assunto:['ASSUNTO','TIPO ATENDIMENTO','MOTIVO','CATEGORIA'],
  Setor:['SETOR','DEPARTAMENTO','EQUIPE'],
  Cidade:['CIDADE','MUNICIPIO'],
  Abertura:['ABERTURA','DATA ABERTURA','DATA DE ABERTURA','CRIADO EM'],
  Fechamento:['FECHAMENTO','DATA FECHAMENTO','DATA DE FECHAMENTO','ENCERRAMENTO'],
  Prioridade:['PRIORIDADE','URGENCIA']
};
export function detectMapping(headers) {
  return Object.fromEntries(SAFE_COLUMNS.map(c => [c, headers.findIndex(h=>COLUMN_ALIASES[c].includes(plain(h))) ]));
}
export function cleanStatus(value) {
  const s=plain(value); return ({'FINALIZADA':'Finalizada','FECHADA':'Finalizada','CONCLUIDA':'Finalizada','ENCERRADA':'Finalizada','ABERTA':'Aberta','ENCAMINHADA':'Encaminhada','EXECUCAO':'Execução','EM EXECUCAO':'Execução','ASSUMIDA':'Assumida'})[s] || 'Outros';
}
export function cleanSubject(value) {
  const s=plain(value);
  // Classificação em rótulos fixos; texto original nunca é mantido.
  if(s.includes('ENTREGA DE BOLETO')) return s.includes('NSON')?'Entrega boletos · NSON':'Entrega de boletos';
  if(s.includes('DB ALTO')) return 'DB alto';
  if(s.includes('INSTALACAO')) return 'Instalação';
  if(s.includes('SEM CONEXAO')) return 'Sem conexão';
  if(s.includes('LENTIDAO')) return 'Lentidão';
  if(s.includes('ORGANIZACAO CAIXA')) return 'Organização de caixa';
  if(s.includes('RETIRADA DE EQUIPAMENTO')) return 'Retirada de equipamento';
  if(s.includes('MUDANCA DE ENDERECO')) return 'Mudança de endereço';
  if(s.includes('COMPARECIMENTO')||s.includes('IMPRODUTIVO')) return 'Comparecimento improdutivo';
  if(s.includes('MANUTENCAO PREVENTIVA')) return 'Manutenção preventiva';
  if(s.includes('SUPORTE AO TECNICO')) return 'Suporte ao técnico';
  if(s.includes('SEM ACESSO')) return 'Sem acesso';
  if(s.includes('SOLICITACAO DE BOLETO')) return 'Solicitação de boleto';
  if(s.includes('INFORMATIVO')) return 'Informativo';
  if(s.includes('LOGISTICA')) return 'Logística';
  if(s.includes('ESTORNO')) return 'Estorno de pagamento';
  if(s.includes('REATIVACAO')) return 'Reativação';
  return 'Outros assuntos';
}
export function cleanSector(value) {
  const s=plain(value);
  if(s.includes('ENTREGADOR')&&s.includes('BOLETO')) return 'Entrega de boletos';
  if(s.includes('TECNIC')&&s.includes('JEQUIE')) return 'Técnicos Jequié';
  if(s.includes('TECNIC')&&s.includes('JITAUNA')) return 'Técnicos Jitaúna';
  if(s.includes('TECNIC')&&s.includes('IPIAU')) return 'Técnicos Ipiaú';
  if(s.includes('TECNIC')&&s.includes('ITAGIBA')) return 'Técnicos Itagibá';
  if(s==='FINANCEIRO'||s==='ADMINISTRATIVO'||s==='ATENDIMENTO') return s[0]+s.slice(1).toLowerCase();
  if(s.includes('CALL CENTER')) return 'Call center';
  if(s.includes('NETWORK OPERATION')||s==='NOC') return 'NOC';
  if(s.includes('SUPORTE N2')) return 'Suporte N2';
  return 'Outros setores';
}
export function cleanCity(value) {
  const s=plain(value);
  return ({'JEQUIE':'Jequié','IPIAU':'Ipiaú','JITAUNA':'Jitaúna','ITAGIBA':'Itagibá','ITAGI':'Itagi','AIQUARA':'Aiquara','PONTO NOVO':'Ponto Novo','ITAJURU':'Itajuru','PORTO SEGURO':'Porto Seguro'})[s] || 'Outras / não informada';
}
export function cleanPriority(value){ const s=plain(value);return ({'NORMAL':'Normal','CRITICA':'Crítica','ALTA':'Alta','BAIXA':'Baixa'})[s]||'Não informada'; }
export function parseDate(value){
  if(typeof value==='number'&& Number.isFinite(value) && value>=42000 && value<52000) return (value-25569)*86400000;
  if(typeof value==='string') {
    const s=value.trim();
    let m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    if(m){const t=Date.UTC(+m[3],+m[2]-1,+m[1],+(m[4]||0),+(m[5]||0));return Number.isNaN(t)?null:t;}
    if(/^20\d\d-\d\d-\d\d/.test(s)){const t=Date.parse(s);return Number.isNaN(t)?null:t;}
    const n=Number(s); if(Number.isFinite(n)&&n>=42000&&n<52000) return (n-25569)*86400000;
  }
  return null;
}
const day = ms => ms===null ? null : new Date(ms).toISOString().slice(0,10);
const increment = (map,k,v=1)=>{map[k]=(map[k]||0)+v;};
function group(){return {total:0,pending:0,finalized:0,over24:0,age7:0};}
function bump(map,cat,status,over24){const t=map[cat]||(map[cat]=group());t.total++;if(status==='Finalizada')t.finalized++;else t.pending++;if(over24)t.over24++;}

export function buildSnapshot(rows, mapping, metadata={}){
 const missing=REQUIRED.filter(c=>mapping[c]===undefined||mapping[c]<0);
 if(missing.length)throw new Error('Colunas essenciais ausentes: '+missing.join(', '));
 const take=(row,k)=>{const i=mapping[k];return i===undefined||i<0?null:row[i]};
 const snapshot={schema:1,source:metadata.source||'Importação XLSX/CSV', importedAt:new Date().toISOString(), total:0,
 statuses:{},subjects:{},sectors:{},cities:{},daily:{},priorities:{},
 finalized:0,pending:0,closedOver24:0,closedWithDates:0,pendingOlder7d:0,invalidDates:0,
 earliest:null,latest:null, referenceDate:null,
 availableFields:SAFE_COLUMNS.filter(k=>Number.isInteger(mapping[k]) && mapping[k]>=0),
 notes:['SLA do IXC não interpretado nesta versão.','Colaborador individual somente após pseudonimização segura no backend.']};
 let min=Infinity,max=-Infinity;const pendingOpen=[];
 for(const row of rows){
  if(snapshot.total>=MAX_ROWS)throw new Error('Limite de '+MAX_ROWS+' linhas excedido.');
  if(!Array.isArray(row) || row.every(x=>x==null||x===''))continue;
  const opening=parseDate(take(row,'Abertura'));
  const closing=parseDate(take(row,'Fechamento'));
  const status=cleanStatus(take(row,'Status'));
  const subject=cleanSubject(take(row,'Assunto'));
  const sector=cleanSector(take(row,'Setor'));
  const city=cleanCity(take(row,'Cidade'));
  const priority=cleanPriority(take(row,'Prioridade'));
  const isClosed=status==='Finalizada';
  const over24=!!(isClosed && closing!==null && opening!==null && closing-opening>86400000);
  snapshot.total++;
  if(opening!==null){min=Math.min(min,opening);max=Math.max(max,opening)}else snapshot.invalidDates++;
  if(isClosed){snapshot.finalized++;if(closing!==null&&opening!==null){snapshot.closedWithDates++;if(over24)snapshot.closedOver24++;}}
  else {snapshot.pending++;if(opening!==null)pendingOpen.push(opening)}
  increment(snapshot.statuses,status);increment(snapshot.priorities,priority);
  bump(snapshot.subjects,subject,status,over24);bump(snapshot.sectors,sector,status,over24);bump(snapshot.cities,city,status,over24);
  if(opening!==null)bump(snapshot.daily,day(opening),status,over24);
 }
 if(snapshot.total===0)throw new Error('O arquivo não contém atendimentos válidos.');
 if(Number.isFinite(max)){
  snapshot.referenceDate=day(max);snapshot.earliest=day(min);snapshot.latest=day(max);
  snapshot.pendingOlder7d=pendingOpen.filter(t=>max-t>7*86400000).length;
 }
 // Apenas agregados são retornados/persistidos: nenhuma linha, nome, login, mensagem, identificador ou horário exato.
 return snapshot;
}
export function subjectGroups(snapshot) {
 const out={}; for(const [name,g] of Object.entries(snapshot.subjects||{})){
   const groupName=name.startsWith('Entrega boleto')||name==='Entrega de boletos'?'Entrega de boletos':name;
   const cur=out[groupName]||(out[groupName]=group());for(const k of Object.keys(cur))cur[k]+=(g[k]||0);
 }return out;
}
export function radarItems(snapshot){
 if(!snapshot)return [];
 const signals=[];
 for(const [name,g] of Object.entries(snapshot.subjects)){
  const p=g.total?g.pending/g.total:0;
  if(g.pending>=10 && (p>=.3 || g.pending>=100))signals.push({category:'Assunto',name,amount:g.pending,rate:p,priority:g.pending>=100?'Alta':p>.65&&g.pending>=25?'Alta':'Média',evidence:`${g.pending} pendentes em ${g.total} registros (${Math.round(p*100)}%)`,action:'Verificar procedimento, responsáveis e razões para os registros permanecerem abertos.'});
 }
 for(const [name,g] of Object.entries(snapshot.cities)){
  const p=g.total?g.pending/g.total:0;
  if(g.total>=40 && p>=.33)signals.push({category:'Cidade',name,amount:g.pending,rate:p,priority:'Média',evidence:`${g.pending} de ${g.total} registros pendentes (${Math.round(p*100)}%)`,action:'Comparar composição dos chamados e capacidade da equipe antes de concluir a causa.'});
 }
 signals.sort((a,b)=>(a.priority===b.priority?b.amount-a.amount:a.priority==='Alta'?-1:1));
 return signals.slice(0,15);
}
export function moneyBRL(n){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n)}
export function safeNumber(value){const n=Number(String(value).replace(',','.'));return Number.isFinite(n)&&n>=0?Math.min(n,1e9):0}
export const sampleCost={hours:'1.5',hourCost:'32',travel:'18',materials:'12',overhead:'0'};
export function calculateCost(c){return safeNumber(c.hours)*safeNumber(c.hourCost)+safeNumber(c.travel)+safeNumber(c.materials)+safeNumber(c.overhead)}
