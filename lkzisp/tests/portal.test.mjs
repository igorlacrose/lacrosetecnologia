import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../portal.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
test('login e MFA obrigatorios, sem painel de clientes publico',()=>{
 assert.match(html,/id="loginForm"/);
 assert.match(html,/id="mfaForm"/);
 assert.match(html,/noindex,nofollow/);
 assert.doesNotMatch(html,/relatorio.*IXC.*input|id="file-input"/i);
 assert.match(html,/Homologação controlada/);
 assert.match(html,/Desenvolvido por Lacrose Tecnologia/);
});
test('somente chave publica e nenhum segredo ou armazenamento de sessao',()=>{
 assert.match(js,/sb_publishable_/);
 assert.doesNotMatch(js,/sb_secret_|SUPABASE_SERVICE_ROLE|localStorage|sessionStorage|indexedDB/);
 assert.match(js,/lacrosetecnologia\.com\.br\/lkzisp/);
 assert.match(js,/lkzisp-owner-bootstrap/);
});
test('senha do MASTER definida pelo titular, e-mail reservado e segundo fator',()=>{
 assert.match(js,/lacrose\.igor@gmail\.com/);
 assert.match(js,/password\.length<12/);
 assert.match(js,/aal!=='aal2'/);
 assert.match(js,/invite|convidad/i);
});
test('dados retornados de provedores nao inserem markup arbitrario',()=>{
 assert.doesNotMatch(js,/innerHTML|document\.write|eval\(/);
 assert.match(js,/textContent/);
});
test('CSP restritiva e interface responsiva',()=>{
 assert.match(html,/default-src 'none'/);
 assert.match(html,/script-src 'self'/);
 assert.match(html,/style-src 'self'/);
 assert.match(css,/@media\(max-width:800px\)/);
});


test('MFA consulta fatores pelo usuario autenticado, nao pela rota 422',()=>{
 assert.match(js,/await api\('\/auth\/v1\/user'\)/);
 assert.doesNotMatch(js,/api\('\/auth\/v1\/factors'\)/);
 assert.match(js,/d\.factors/);
 assert.match(js,/status==='verified'/);
 assert.match(js,/autenticador já está ativo/);
});
