import {writeFileSync} from 'node:fs';
import {configFromEnv,publicConfig} from './config.mjs';
import {inspectReadOnly} from './schema.mjs';

const failures={
 ECONNREFUSED:'Conexão recusada: verifique firewall, VPN e lista de IPs.',
 ETIMEDOUT:'Tempo esgotado: verifique rota e firewall.',
 ENOTFOUND:'Endereço do servidor não resolvido.',
 ER_ACCESS_DENIED_ERROR:'Usuário não autorizado; contate o administrador.',
 HANDSHAKE_SSL_ERROR:'TLS recusado: confira CA e nome do certificado.'
};
let connection;
try{
 const cfg=configFromEnv();
 const {default:mysql}=await import('mysql2/promise');
 connection=await mysql.createConnection(cfg.connection);
 const report=await inspectReadOnly(connection,cfg.connection.database);
 console.log(JSON.stringify({connection:publicConfig(cfg),tables:report.tableCount,
  columns:report.columnCount,candidates:report.candidates},null,2));
 if(cfg.output){
  // Não sobrescrever relatórios antigos. Acesso privado a metadados de infraestrutura.
  writeFileSync(cfg.output,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  console.log('Metadados salvos apenas no arquivo local escolhido. Não publique no GitHub.');
 }
}catch(e){
 const m=failures[e?.code]||(
  /^(Configuração ausente|Host inválido|Porta inválida|Campo inválido|Nome TLS inválido|Arquivo CA|Certificado CA|TLS não confirmado|Esquema supera|Metadados)/.test(e?.message||'')
   ?e.message:'Falha na inspeção. Consulte conexão, TLS e privilégios sem compartilhar credenciais.'
 );
 console.error('Conector IXC (leitura): '+m);
 process.exitCode=1;
}finally{
 if(connection)try{await connection.end();}catch{}
}
