import {readFileSync} from 'node:fs';
const NAME=/^[a-zA-Z0-9_$-]{1,100}$/;
const HOST=/^[a-zA-Z0-9.-]{1,253}$/;

// Sem valores padrão de login; SSL obrigatório, sem TLS inseguro.
export function configFromEnv(env=process.env,readFile=readFileSync){
 for(const key of ['IXC_DB_HOST','IXC_DB_USER','IXC_DB_PASSWORD','IXC_DB_NAME','IXC_DB_TLS_CA_FILE'])
  if(!String(env[key]||'').trim())throw Error('Configuração ausente: '+key);
 const host=String(env.IXC_DB_HOST).trim(),port=Number(env.IXC_DB_PORT||3306);
 if(!HOST.test(host)||host.startsWith('.')||host.includes('..'))throw Error('Host inválido.');
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Porta inválida.');
 for(const key of ['IXC_DB_USER','IXC_DB_NAME'])if(!NAME.test(env[key]))throw Error('Campo inválido: '+key);
 const servername=String(env.IXC_DB_TLS_SERVERNAME||'').trim();
 if(servername&&!HOST.test(servername))throw Error('Nome TLS inválido.');
 let ca;
 try{ca=readFile(String(env.IXC_DB_TLS_CA_FILE));}
 catch{throw Error('Arquivo CA do banco não disponível.');}
 if(!String(ca).includes('-----BEGIN CERTIFICATE-----'))throw Error('Certificado CA inválido.');
 return {
  connection:{
   host,port,user:env.IXC_DB_USER,password:env.IXC_DB_PASSWORD,database:env.IXC_DB_NAME,
   connectTimeout:7000,charset:'utf8mb4',multipleStatements:false,
   ssl:{ca,rejectUnauthorized:true,minVersion:'TLSv1.2',...(servername?{servername}:{})}
  },
  output:env.IXC_SCHEMA_OUTPUT?String(env.IXC_SCHEMA_OUTPUT):null
 };
}
export function publicConfig(cfg){
 return {encrypted:true,readOnly:true,schema:cfg.connection.database,port:cfg.connection.port};
}
