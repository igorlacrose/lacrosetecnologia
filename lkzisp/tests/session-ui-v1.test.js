import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {IDLE_LIMIT_MS,isSessionWithinIdleLimit,loadTrustedSession,clearTrustedSession} from '../src/trusted-session.js';
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const auth=readFileSync(new URL('../src/cloud-auth.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');

test('6h de inatividade: só restaura antes do prazo, e nunca com horario futuro',()=>{
 const now=Date.UTC(2026,9,28,12,0,0);
 assert.equal(IDLE_LIMIT_MS,21600000);
 assert.equal(isSessionWithinIdleLimit(now-1,now),true);
 assert.equal(isSessionWithinIdleLimit(now-IDLE_LIMIT_MS+1,now),true);
 assert.equal(isSessionWithinIdleLimit(now-IDLE_LIMIT_MS,now),false);
 assert.equal(isSessionWithinIdleLimit(now-IDLE_LIMIT_MS-1,now),false);
 assert.equal(isSessionWithinIdleLimit(now+1,now),false);
 assert.equal(isSessionWithinIdleLimit(NaN,now),false);
});
test('sem IndexedDB seguro nao existe sessao reaproveitavel',async()=>{
 assert.equal(await loadTrustedSession(),null);
 await clearTrustedSession();
});
test('sessao confiavel depende de MFA server-side e nao guarda senha ou TOTP',()=>{
 assert.match(auth,/this\.aal!=='aal2'/);
 assert.match(auth,/this\.#request\('\/auth\/v1\/user'\)/);
 assert.match(auth,/grant_type=refresh_token/);
 assert.match(auth,/setDeviceTrust/);
 assert.match(auth,/clearTrustedSession/);
 const local=readFileSync(new URL('../src/trusted-session.js',import.meta.url),'utf8');
 assert.match(local,/AES-GCM/);
 assert.match(local,/extractable|false,\['encrypt','decrypt'\]/);
 assert.doesNotMatch(local,/localStorage|sessionStorage/);
 assert.doesNotMatch(local,/obj\.put\([^\n]*(password|totp|user_metadata)/i);
});
test('login premium em tela inteira, campos visiveis no mobile e saida segura',()=>{
 assert.match(app,/function loginLanding\(/);
 assert.match(app,/id="cloud-login-form"/);
 assert.match(app,/id="remember-device"/);
 assert.match(app,/id="password-toggle"/);
 assert.match(app,/function verifyInactivity\(/);
 assert.match(app,/document\.addEventListener\('visibilitychange'/);
 assert.match(css,/\.auth-layout\{display:grid/);
 assert.match(css,/@media\(max-width:900px\)/);
 assert.match(html,/styles\.css\?v=110/);
 assert.doesNotMatch(html,/name="description"[^>]*Supabase/i);
});
test('area de usuarios e regras de cadastro por papel',()=>{
 assert.match(app,/function usersPage\(/);
 assert.match(app,/Usuários e Permissões/);
 assert.match(app,/id="cloud-invite-form"/);
 assert.match(app,/mayInvite\(selected\.role,r\)/);
 assert.match(app,/Convites da empresa/);
 assert.doesNotMatch(app,/Supabase/);
});
test('deduplicacao reconhecida pela UI e regra de gravacao no backend',()=>{
 assert.match(app,/const oldFingerprint=/);
 assert.match(app,/const alreadyImported=/);
 assert.match(app,/Relatório já importado/);
 assert.match(auth,/lkz_isp_save_snapshot_with_employees/);
});
