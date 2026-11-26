import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInspection} from '../src/session.mjs';
import {inspectReadOnly,TABLES_SQL} from '../src/schema.mjs';
import {configFromEnv} from '../src/config.mjs';

const env={IXC_DB_HOST:'mysql.internal',IXC_DB_USER:'fixture',IXC_DB_PASSWORD:'synthetic',
 IXC_DB_NAME:'fixture',IXC_DB_TLS_CA_FILE:'unused'};
const config=()=>configFromEnv(env,()=> '-----BEGIN CERTIFICATE-----\nfixture');
const never=()=>new Promise(()=>{});
function fixture({connect=async()=>{},query,execute,end=async()=>{}}={}){
 const calls=[];let destroyed=0;
 const raw={destroy:()=>{destroyed++;},promise:()=>({connect,end,
  query:async sql=>{
   calls.push(sql);
   if(query)return query(sql);
   return sql.startsWith('SHOW')?[[{Value:'fixture-cipher'}]]:[[]];
  },execute:execute|| (async()=>[[]])
 })};
 return {raw,calls,get destroyed(){return destroyed;}};
}

test('configuração exige hostname DNS e rejeita nome TLS alternativo ignorado pelo driver',()=>{
 for(const host of ['127.0.0.1','10.0.0.1','123','a..b','-mysql.internal','a.'.repeat(130)])
  assert.throws(()=>configFromEnv({...env,IXC_DB_HOST:host}),/Host inválido/);
 assert.throws(()=>configFromEnv({...env,IXC_DB_TLS_SERVERNAME:'other.internal'}),/Nome TLS inválido/);
 assert.equal(config().connection.ssl.verifyIdentity,true);
});
test('prazos são limitados e não podem ser desativados',()=>{
 for(const value of ['0','-1','NaN','30001',''])
  assert.throws(()=>configFromEnv({...env,IXC_QUERY_TIMEOUT_MS:value},()=> '-----BEGIN CERTIFICATE-----'),/Prazo inválido/);
});
test('sessão válida termina e encerra o transporte',async()=>{
 const f=fixture();const report=await runInspection(()=>f.raw,config());
 assert.equal(report.tableCount,0);
 assert.ok(f.calls.includes('ROLLBACK'));assert.ok(f.destroyed);
});
test('conexão pendente é destruída dentro do prazo',async()=>{
 const f=fixture({connect:never});
 const cfg=config();cfg.connection.connectTimeout=25;
 await assert.rejects(runInspection(()=>f.raw,cfg),{code:'IXC_TIMEOUT'});
 assert.ok(f.destroyed);assert.equal(f.calls.length,0);
});
test('consulta de metadados pendente encerra sessão sem enfileirar rollback em conexão destruída',async()=>{
 const f=fixture({execute:never});const cfg={...config(),queryTimeoutMs:25};
 await assert.rejects(runInspection(()=>f.raw,cfg),{code:'IXC_TIMEOUT'});
 assert.ok(f.destroyed);assert.ok(!f.calls.includes('ROLLBACK'));
});
test('prazo total interrompe sequência de operações e não produz relatório',async()=>{
 const f=fixture({execute:async()=>{await new Promise(r=>setTimeout(r,30));return [[]];}});
 const cfg={...config(),totalTimeoutMs:20,queryTimeoutMs:100};
 await assert.rejects(runInspection(()=>f.raw,cfg),{code:'IXC_TIMEOUT'});
 assert.ok(f.destroyed);assert.ok(!f.calls.includes('ROLLBACK'));
});
test('falha normal em consulta mantém rollback',async()=>{
 const calls=[];
 await assert.rejects(inspectReadOnly({query:async sql=>{
  calls.push(sql);return sql.startsWith('SHOW')?[[{Value:'fixture'}]]:[[]];
 },execute:async sql=>{assert.equal(sql,TABLES_SQL);throw Error('synthetic');}},'fixture'),/synthetic/);
 assert.equal(calls.at(-1),'ROLLBACK');
});
test('rollback pendente não mantém execução aberta',async()=>{
 const f=fixture({query:async sql=>sql==='ROLLBACK'?never():
  sql.startsWith('SHOW')?[[{Value:'fixture'}]]:[[]]});
 await assert.rejects(runInspection(()=>f.raw,{...config(),queryTimeoutMs:25}),{code:'IXC_TIMEOUT'});
 assert.ok(f.destroyed);
});
test('encerramento pendente também tem prazo e destrói transporte',async()=>{
 const f=fixture({end:never});
 await assert.rejects(runInspection(()=>f.raw,{...config(),queryTimeoutMs:25}),{code:'IXC_TIMEOUT'});
 assert.ok(f.destroyed);
});
