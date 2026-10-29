import {readFileSync} from 'node:fs';
import {isIP} from 'node:net';
const NAME=/^[a-zA-Z0-9_$-]{1,100}$/;
const HOST=/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function duration(env,key,fallback,max){
 const value=env[key]===undefined?fallback:Number(env[key]);
 if(!Number.isInteger(value)||value<1||value>max)throw Error('Prazo inválido: '+key);
 return value;
}

// Sem valores padrão de login; SSL obrigatório, sem TLS inseguro.
export function configFromEnv(env=process.env,readFile=readFileSync){
 for(const key of ['IXC_DB_HOST','IXC_DB_USER','IXC_DB_PASSWORD','IXC_DB_NAME','IXC_DB_TLS_CA_FILE'])
  if(!String(env[key]||'').trim())throw Error('Configuração ausente: '+key);
 const host=String(env.IXC_DB_HOST).trim(),port=Number(env.IXC_DB_PORT||3306);
 // MySQL2 deriva a identidade TLS de host; não aceita ssl.servername alternativo.
 if(!HOST.test(host)||isIP(host)||/^[0-9.]+$/.test(host))
  throw Error('Host inválido. Use o nome DNS presente no certificado, não um IP.');
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Porta inválida.');
 for(const key of ['IXC_DB_USER','IXC_DB_NAME'])if(!NAME.test(env[key]))throw Error('Campo inválido: '+key);
 const servername=String(env.IXC_DB_TLS_SERVERNAME||'').trim();
 if(servername&&servername.toLowerCase()!==host.toLowerCase())
  throw Error('Nome TLS inválido. IXC_DB_TLS_SERVERNAME deve ser igual a IXC_DB_HOST.');
 let ca;
 try{ca=readFile(String(env.IXC_DB_TLS_CA_FILE));}
 catch{throw Error('Arquivo CA do banco não disponível.');}
 if(!String(ca).includes('-----BEGIN CERTIFICATE-----'))throw Error('Certificado CA inválido.');
 return {
  connection:{
   host,port,user:env.IXC_DB_USER,password:env.IXC_DB_PASSWORD,database:env.IXC_DB_NAME,
   connectTimeout:7000,charset:'utf8mb4',multipleStatements:false,
   ssl:{ca,rejectUnauthorized:true,verifyIdentity:true,minVersion:'TLSv1.2'}
  },
  queryTimeoutMs:duration(env,'IXC_QUERY_TIMEOUT_MS',10000,30000),
  totalTimeoutMs:duration(env,'IXC_TOTAL_TIMEOUT_MS',90000,120000),
  output:env.IXC_SCHEMA_OUTPUT?String(env.IXC_SCHEMA_OUTPUT):null
 };
}
export function publicConfig(cfg){
 return {encrypted:true,readOnly:true,schema:cfg.connection.database,port:cfg.connection.port};
}
