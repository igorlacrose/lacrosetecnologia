import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const cloud=readFileSync(new URL('../src/cloud-auth.js',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
test('v0.6 inicia na conta protegida e bloqueia analise sem MFA',()=>{
 assert.match(app,/const state=\{view:'cloud'/);
 assert.match(app,/!canUseAggregateWorkspace\(\)/);
 assert.match(app,/cloud\.aal==='aal2'/);
 assert.match(app,/canAdministerLocalWorkspace/);
 assert.match(app,/if\(!canAdministerLocalWorkspace\(\)\)\{toast\('Acesso e MFA/);
});
test('MASTER nao e concedido por comparacao local',()=>{
 assert.match(cloud,/\/functions\/v1\/lkzisp-owner-bootstrap/);
 assert.match(cloud,/action:'activate_master'/);
 assert.doesNotMatch(cloud,/service_role|sb_secret_/);
 assert.doesNotMatch(cloud,/localStorage|sessionStorage|indexedDB/);
});
test('dados nao sao guardados offline sem chave de usuario',()=>{
 assert.doesNotMatch(sw,/supabase\.co|auth\/v1|rest\/v1/);
 assert.match(sw,/staticURLs\.has\(req\.url\)/);
});
