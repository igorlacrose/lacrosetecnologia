import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';
import {once} from 'node:events';
import mysql from 'mysql2';
import {configFromEnv} from '../src/config.mjs';

// Certificados e chaves fictícios são gerados no temporário; nada é versionado.
test('driver real valida CA e identidade TLS em loopback', {timeout:20000}, async t=>{
 const dir=mkdtempSync(join(tmpdir(),'lkz-ixc-tls-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const openssl=process.env.IXC_TEST_OPENSSL||'openssl';
 for(const name of ['trusted','other'])execFileSync(openssl,[
  'req','-x509','-newkey','rsa:2048','-nodes','-days','1',
  '-keyout',join(dir,name+'.key'),'-out',join(dir,name+'.crt'),
  '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'
 ],{stdio:'ignore',timeout:10000});
 const cert=readFileSync(join(dir,'trusted.crt'));
 const server=tls.createServer({key:readFileSync(join(dir,'trusted.key')),cert},()=>{});
 const sockets=new Set();
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 server.on('tlsClientError',()=>{});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));});
 const port=server.address().port;
 async function handshake(host,ca=cert){
  const cfg=configFromEnv({IXC_DB_HOST:host,IXC_DB_USER:'fixture',IXC_DB_PASSWORD:'synthetic',
   IXC_DB_NAME:'fixture',IXC_DB_TLS_CA_FILE:'unused',IXC_DB_PORT:String(port)},()=>ca);
  // Usa startTLS do driver instalado. O transporte é sempre loopback, sem DNS externo.
  const conn=mysql.createConnection({...cfg.connection,isServer:true,
   stream:()=>net.connect({host:'127.0.0.1',port})});
  conn.on('error',()=>{});
  try{
   await once(conn.stream,'connect');
   await new Promise((resolve,reject)=>conn.startTLS(err=>err?reject(err):resolve()));
  }finally{conn.destroy();}
 }
 await t.test('certificado do hostname correto é aceito',()=>handshake('localhost'));
 await t.test('mesma CA, hostname incorreto é rejeitado',async()=>{
  await assert.rejects(handshake('different.invalid'),{code:'ERR_TLS_CERT_ALTNAME_INVALID'});
 });
 await t.test('CA desconhecida é rejeitada',async()=>{
  await assert.rejects(handshake('localhost',readFileSync(join(dir,'other.crt'))));
 });
});

test('servidor MySQL sem TLS é recusado antes da autenticação', {timeout:5000}, async t=>{
 const server=mysql.createServer();
 const sockets=new Set();
 server.on('connection',conn=>{
  sockets.add(conn);conn.on('error',()=>{});
  conn.serverHandshake({protocolVersion:10,serverVersion:'fixture',connectionId:1,
   statusFlags:2,characterSet:45,capabilityFlags:512|32768|1});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{for(const c of sockets)c.destroy();await new Promise(resolve=>server.close(resolve));});
 const port=server._server.address().port;
 const cfg=configFromEnv({IXC_DB_HOST:'localhost',IXC_DB_USER:'fixture',IXC_DB_PASSWORD:'synthetic',
  IXC_DB_NAME:'fixture',IXC_DB_TLS_CA_FILE:'unused'},()=> '-----BEGIN CERTIFICATE-----\nfixture');
 const conn=mysql.createConnection({...cfg.connection,
  stream:()=>net.connect({host:'127.0.0.1',port})});
 try{await assert.rejects(conn.promise().connect(),{code:'HANDSHAKE_NO_SSL_SUPPORT'});}
 finally{conn.destroy();}
});
