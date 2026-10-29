import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configFromEnv,publicConfig} from '../src/config.mjs';
import {TABLES_SQL,COLUMNS_SQL,LIMITS,buildDiscovery,inspectReadOnly} from '../src/schema.mjs';
const env={
 IXC_DB_HOST:'mysql.internal',IXC_DB_PORT:'3306',IXC_DB_USER:'reader',
 IXC_DB_PASSWORD:'dummy-not-a-secret',IXC_DB_NAME:'fictional',
 IXC_DB_TLS_CA_FILE:'/not-an-actual-file'
};
const ca='-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----';
test('não conectar sem senha, banco ou certificado válido',()=>{
 assert.throws(()=>configFromEnv({...env,IXC_DB_PASSWORD:''},()=>ca),/IXC_DB_PASSWORD/);
 assert.throws(()=>configFromEnv({...env,IXC_DB_TLS_CA_FILE:''},()=>ca),/IXC_DB_TLS_CA_FILE/);
 assert.throws(()=>configFromEnv(env,()=>''),/CA inválido/);
});
test('TLS validado e acesso com várias instruções desabilitado',()=>{
 const c=configFromEnv(env,()=>ca);
 assert.equal(c.connection.ssl.rejectUnauthorized,true);
 assert.equal(c.connection.ssl.minVersion,'TLSv1.2');
 assert.equal(c.connection.multipleStatements,false);
 assert.equal(c.connection.charset,'utf8mb4');
 assert.doesNotMatch(JSON.stringify(publicConfig(c)),/dummy|mysql\.internal|reader/);
});
test('consultas somente na estrutura do information_schema com parâmetros',()=>{
 for(const sql of [TABLES_SQL,COLUMNS_SQL]){
  assert.match(sql,/FROM information_schema\./);
  assert.match(sql,/TABLE_SCHEMA = \?/);
  assert.match(sql,/LIMIT \?/);
  assert.doesNotMatch(sql,/INSERT|UPDATE|DELETE|TRUNCATE|DROP|JOIN/i);
 }
});
test('transação READ ONLY, confirmação TLS e rollback, sem acesso a linhas',async()=>{
 const calls=[];
 const conn={
  query:async sql=>{calls.push(sql);return sql.startsWith('SHOW')?[[{Value:'TLS_AES_256_GCM_SHA384'}]]:[[]];},
  execute:async(sql,args)=>{
   calls.push([sql,args]);
   return sql===TABLES_SQL?[[{TABLE_NAME:'su_oss_chamado',TABLE_TYPE:'BASE TABLE'}]]:
    [[{TABLE_NAME:'su_oss_chamado',COLUMN_NAME:'id',DATA_TYPE:'int',COLUMN_KEY:'PRI',IS_NULLABLE:'NO'}]];
  }
 };
 const r=await inspectReadOnly(conn,'fictional');
 assert.equal(r.tableCount,1);assert.equal(r.columnCount,1);
 assert.deepEqual(calls.filter(x=>typeof x==='string'),
 ['START TRANSACTION READ ONLY',"SHOW SESSION STATUS LIKE 'Ssl_cipher'",'ROLLBACK']);
 assert.deepEqual(calls.filter(x=>Array.isArray(x)).map(x=>x[1]),
 [['fictional',LIMITS.tables],['fictional',LIMITS.columns]]);
});
test('sem TLS, interromper antes de ler estrutura',async()=>{
 let execCount=0;
 const conn={
  query:async sql=>sql.startsWith('SHOW')?[[{Value:''}]]:[[]],
  execute:async()=>{execCount++;return [[]];}
 };
 await assert.rejects(inspectReadOnly(conn,'fictional'),/TLS não confirmado/);
 assert.equal(execCount,0);
});
test('inventário só com metadados e tamanho limitado',()=>{
 const r=buildDiscovery(
  [{TABLE_NAME:'su_oss_chamado',TABLE_TYPE:'BASE TABLE'}],
  [{TABLE_NAME:'su_oss_chamado',COLUMN_NAME:'id_cliente',DATA_TYPE:'int',COLUMN_KEY:'MUL',IS_NULLABLE:'NO'}],'fictional');
 assert.ok(r.candidates.atendimentos.includes('su_oss_chamado'));
 assert.equal(r.structure[0].columns[0].name,'id_cliente');
 assert.throws(()=>buildDiscovery(Array.from({length:LIMITS.tables},(_,i)=>({TABLE_NAME:'t'+i})),[],'fictional'),/limite/);
});
