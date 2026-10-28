import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const app=read('../src/app.js'),auth=read('../src/cloud-auth.js');
const endpoint=read('../supabase/functions/lkzisp-user-invitations/index.ts');
const db=read('../supabase/migrations/20261028_resend_sender.sql');
const doc=read('../docs/CONVITES_EMAIL_RESEND.md');
const sender='convites@lacrosetecnologia.com.br';

test('Resend é o único remetente autorizado, sem alterações no MASTER',()=>{
 assert.match(app,/Remetente: convites@lacrosetecnologia.com.br/);
 assert.match(endpoint,/reserved\?\.sender!=="convites@lacrosetecnologia.com.br"/);
 assert.match(endpoint,/RESEND_SMTP_NOT_CONFIGURED/);
 assert.match(auth,/data\?\.error==='resend_smtp_not_configured'/);
 assert.match(db,/sender_email='convites@lacrosetecnologia.com.br'/);
 assert.match(db,/enabled=false,configured_at=NULL/);
 assert.doesNotMatch(endpoint,/lacrose\.igor@gmail\.com|gmail_smtp_not_configured|SMTP_GOOGLE_NOT_CONFIGURED/);
 // O e-mail MASTER permanece igual; somente o remetente de convites muda.
 assert.match(auth,/this\.email\?\.toLowerCase\(\)!=='lacrose\.igor@gmail\.com'/);
 assert.match(app,/cloud\.email\?\.toLowerCase\(\)==='lacrose\.igor@gmail\.com'/);
});
test('sem SMTP homologado, o servidor bloqueia o convite e não contém chaves',()=>{
 assert.match(db,/CHECK \(sender_email='convites@lacrosetecnologia.com.br'\)/);
 assert.match(endpoint,/lkz_isp_internal_claim_invite_delivery/);
 assert.match(endpoint,/verifiedClaims\.aal!=="aal2"/);
 assert.match(endpoint,/shouldCreateUser:false/);
 assert.match(doc,/enabled=false/);
 assert.match(doc,/smtp\.resend\.com/);
 assert.match(doc,/https:\/\/supabase\.com\/partners\/catalog\/resend/);
 assert.doesNotMatch(endpoint,/re_[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9]+|sk_live_[A-Za-z0-9]+/);
});
