import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CloudAccess,normalizeTotpQrImage} from '../src/cloud-auth.js';

const user='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const factor='11111111-2222-4333-8444-555555555555';
const token=aal=>['head',Buffer.from(JSON.stringify({sub:user,aal})).toString('base64url'),'sig'].join('.');
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const qr='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
const source=(file)=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('QR Supabase aceita somente imagem SVG local, sem serviço remoto',()=>{
 assert.equal(normalizeTotpQrImage(qr),qr);
 assert.equal(normalizeTotpQrImage('data:image/svg+xml;utf8,<svg></svg>'),'data:image/svg+xml;utf8,<svg></svg>');
 assert.match(normalizeTotpQrImage('<svg><rect width="2"/></svg>'),/^data:image\/svg\+xml;charset=utf-8,/);
 for(const bad of ['https://qr.example.invalid/secret','javascript:alert(1)','data:text/html,<script></script>','','data:image/png;base64,AAAA']){
  assert.equal(normalizeTotpQrImage(bad),null);
 }
});

test('usuário sem fator recebe QR e chave do próprio Supabase; MFA continua AAL1',async()=>{
 const calls=[];
 const client=new CloudAccess(async(url,opts)=>{
  calls.push({url,method:opts.method});
  if(url.includes('grant_type=password'))return response({access_token:token('aal1'),refresh_token:'temporary',expires_in:3600,user:{id:user,email:'new@example.invalid'}});
  if(url.endsWith('/auth/v1/user'))return response({id:user,email:'new@example.invalid',factors:[]});
  if(url.endsWith('/auth/v1/factors')&&opts.method==='POST')return response({id:factor,totp:{secret:'TEST-SECRET',qr_code:qr}});
  throw Error('Endpoint inesperado '+url);
 });
 await client.signIn('new@example.invalid','test-password');
 const enrollment=await client.enrollTotp();
 assert.equal(enrollment.id,factor);
 assert.equal(enrollment.qr,qr);
 assert.equal(enrollment.secret,'TEST-SECRET');
 assert.equal(client.aal,'aal1');
 assert.equal(calls.filter(x=>x.method==='POST'&&x.url.endsWith('/auth/v1/factors')).length,1);
});

test('cadastro TOTP pendente pode ser reiniciado sem tocar em fator verificado',async()=>{
 let pending=true;
 const calls=[];
 const client=new CloudAccess(async(url,opts)=>{
  calls.push({url,method:opts.method});
  if(url.includes('grant_type=password'))return response({access_token:token('aal1'),refresh_token:'temporary',expires_in:3600,user:{id:user,email:'new@example.invalid'}});
  if(url.endsWith('/auth/v1/user'))return response({id:user,factors:pending?[{id:factor,factor_type:'totp',status:'unverified'}]:[]});
  if(url.endsWith('/auth/v1/factors/'+factor)&&opts.method==='DELETE'){pending=false;return response({id:factor});}
  if(url.endsWith('/auth/v1/factors')&&opts.method==='POST')return response({id:factor,totp:{secret:'NEW-SECRET',qr_code:qr}});
  throw Error('Endpoint inesperado '+url);
 });
 await client.signIn('new@example.invalid','test-password');
 assert.equal((await client.enrollTotp()).qr,qr);
 assert.equal(calls.filter(x=>x.method==='DELETE').length,1);
});

test('fator verificado nunca é removido ou recriado pelo novo cadastro QR',async()=>{
 const calls=[];
 const client=new CloudAccess(async(url,opts)=>{
  calls.push({url,method:opts.method});
  if(url.includes('grant_type=password'))return response({access_token:token('aal1'),refresh_token:'temporary',expires_in:3600,user:{id:user,email:'existing@example.invalid'}});
  if(url.endsWith('/auth/v1/user'))return response({id:user,factors:[{id:factor,factor_type:'totp',status:'verified'}]});
  throw Error('Endpoint inesperado '+url);
 });
 await client.signIn('existing@example.invalid','test-password');
 await assert.rejects(client.enrollTotp(),/já está ativo/);
 assert.equal(calls.filter(x=>x.method==='DELETE'||x.method==='POST'&&x.url.endsWith('/auth/v1/factors')).length,0);
});

test('primeiro acesso inicia QR, UI mantém chave manual e apaga segredo na verificação',()=>{
 const app=source('src/app.js'),html=source('index.html'),sw=source('sw.js');
 assert.match(app,/const enrollment=await cloud\.enrollTotp\(\)/);
 assert.match(app,/class="mfa-qr"/);
 assert.match(app,/esc\(cloudUi\.qr\)/);
 assert.match(app,/cloudUi\.secret='';cloudUi\.qr='';cloudUi\.factorId='';cloudUi\.factors=\[\]/);
 assert.match(app,/cloud\.verifyTotp\(code/);
 assert.match(app,/Usar chave manual/);
 assert.match(html,/src\/app\.js\?v=134/);
 assert.match(sw,/lkz-isp-static-v134/);
 assert.doesNotMatch(app,/qrserver|chart\.googleapis|api\.qrserver/i);
});
