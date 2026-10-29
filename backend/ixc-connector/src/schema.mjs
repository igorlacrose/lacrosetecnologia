// Exclusivamente metadados do INFORMATION_SCHEMA: não ler linhas operacionais do IXC.
export const LIMITS=Object.freeze({tables:1200,columns:15000});
export const TABLES_SQL='SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME ASC LIMIT ?';
export const COLUMNS_SQL='SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_KEY, IS_NULLABLE, ORDINAL_POSITION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME ASC, ORDINAL_POSITION ASC LIMIT ?';

const PATTERNS=[
 [/chamad|atend|ticket|suporte|assunto|ocorrenc/,'atendimentos'],
 [/oss|ordem.*serv|servic|tecnic|agenda/,'ordens_servico'],
 [/cidade|municip|setor|bairro|filial|equipe|funcion|colabor/,'dimensoes'],
 [/contrat|assinant|cliente|ativac|cancel|fideliz/,'contratos'],
 [/financeir|areceber|receber|pagar|inadimp|cobranc|fatura|boleto/,'financeiro']
];
export function candidateAreas(name){
 return PATTERNS.filter(([p])=>p.test(String(name||'').toLowerCase())).map(([,x])=>x);
}
export function buildDiscovery(tables,columns,database){
 if(!Array.isArray(tables)||!Array.isArray(columns))throw Error('Metadados inválidos.');
 if(tables.length>=LIMITS.tables||columns.length>=LIMITS.columns)
  throw Error('Esquema supera limite seguro, não retornar dados incompletos.');
 const indexed=new Map();
 for(const row of tables){
  const name=String(row.TABLE_NAME||'');
  if(!name||indexed.has(name))throw Error('Tabela inválida ou duplicada.');
  indexed.set(name,{name,type:String(row.TABLE_TYPE||'UNKNOWN'),areas:candidateAreas(name),columns:[]});
 }
 for(const row of columns){
  const table=indexed.get(String(row.TABLE_NAME||''));
  if(!table)throw Error('Coluna sem tabela correspondente.');
  const name=String(row.COLUMN_NAME||''),type=String(row.DATA_TYPE||'');
  if(!name||name.length>160||!type||type.length>80)throw Error('Metadados de coluna inválidos.');
  table.columns.push({name,type,primary:row.COLUMN_KEY==='PRI',nullable:row.IS_NULLABLE==='YES'});
 }
 const candidates=Object.fromEntries(PATTERNS.map(([,v])=>[v,[]]));
 for(const row of indexed.values())for(const area of row.areas)candidates[area].push(row.name);
 for(const v of Object.values(candidates))v.sort();
 return {
  format:'lkz-ixc-schema-discovery/v1',database,generatedAt:new Date().toISOString(),
  tableCount:tables.length,columnCount:columns.length,candidates,
  // Relatório só com NOMES de metadados, jamais registros pessoais ou financeiros.
  structure:[...indexed.values()].filter(x=>x.areas.length).sort((a,b)=>a.name.localeCompare(b.name))
 };
}
export async function inspectReadOnly(conn,database){
 if(typeof database!=='string'||!database)throw Error('Banco ausente.');
 await conn.query('START TRANSACTION READ ONLY');
 try{
  const [tls]=await conn.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
  if(!Array.isArray(tls)||!tls[0]?.Value)throw Error('TLS não confirmado. Inspeção interrompida.');
  const [tables]=await conn.execute(TABLES_SQL,[database,LIMITS.tables]);
  const [columns]=await conn.execute(COLUMNS_SQL,[database,LIMITS.columns]);
  return buildDiscovery(tables,columns,database);
 }finally{await conn.query('ROLLBACK');}
}
