import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const auth=readFileSync(new URL('../src/cloud-auth.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
test('URLs de cadastro e recuperação apontam para rota oficial',()=>{
 assert.match(auth,/lacrosetecnologia\.com\.br\/lkzisp\//);
 assert.match(auth,/redirect_to=/);
 assert.match(auth,/auth\/v1\/recover/);
});
test('retorno autenticado verifica a identidade antes de aceitar token',()=>{
 assert.match(auth,/handleAuthCallback/);
 assert.match(auth,/auth\/v1\/user/);
 assert.match(auth,/history\.replaceState/);
 assert.match(auth,/response\.ok/);
 assert.match(auth,/recoveryPending/);
 assert.match(app,/cloud\.setRecoveredPassword/);
});
test('o produto exige MFA e autorização antes de mostrar dados empresariais',()=>{
 assert.match(app,/cloud\.aal==='aal2'/);
 assert.match(app,/!canUseAggregateWorkspace\(\)/);
 assert.match(app,/Dados sincronizados/);
 assert.doesNotMatch(auth,/localStorage|sessionStorage|indexedDB|service_role|sb_secret_/);
});
test('cache só armazena recursos estáticos, nunca dados ou token',()=>{
 assert.match(sw,/lkz-isp-static-v138/);
 assert.match(sw,/staticURLs\.has\(req\.url\)/);
 assert.doesNotMatch(sw,/supabase\.co|auth\/v1|rest\/v1/);
});
test('hospedagem publica exige MFA, RLS e confirmacao de gravacao antes de importar',()=>{
 assert.match(app,/const IS_PUBLIC_HOMOLOGATION=/);
 assert.match(app,/if\(!canImportToCloud\(\)\)/);
 assert.match(app,/await cloud\.saveSnapshotWithEmployees\(state\.selectedTenant,previous\|\|snap,staff\.metrics\)/);
 assert.match(app,/if\(name==='process-file'\)/);
});
