import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,webcrypto,createPublicKey,verify} from 'node:crypto';
import {importSigningSeed,publicKeyB64,buildGrant,signGrant}
 from '../supabase/functions/lkz-license/grant.mjs';

test('Ed25519 interoperavel com o JSON canonico do Go',async()=>{
 const seed=randomBytes(32).toString('base64');
 const signingKey=await importSigningSeed(seed,webcrypto);
 const publicB64=await publicKeyB64(signingKey,webcrypto);
 assert.equal(Buffer.from(publicB64,'base64url').length,32);
 const req={installationId:'a'.repeat(64),cnpj:'00000000000000'};
 const source={licenseId:'00000000-0000-4000-8000-000000000001',
   status:'active',paidUntil:1799000000,offlineSeconds:604800};
 const token=await signGrant(signingKey,buildGrant(req,source,1798000000),webcrypto);
 const expected=['version','licenseId','installationId','cnpj',
   'status','issuedAt','validUntil','offlineUntil'];
 assert.deepEqual(Object.keys(token.grant),expected);
 assert.equal(token.grant.offlineUntil-token.grant.issuedAt,604800);
 const spki=Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),
   Buffer.from(publicB64,'base64url')]);
 const publicKey=createPublicKey({key:spki,type:'spki',format:'der'});
 assert.equal(verify(null,Buffer.from(JSON.stringify(token.grant)),publicKey,
   Buffer.from(token.signature,'base64url')),true);
 token.grant.cnpj='11111111000199';
 assert.equal(verify(null,Buffer.from(JSON.stringify(token.grant)),publicKey,
   Buffer.from(token.signature,'base64url')),false);
});

test('Licenca suspensa ou vencida nunca autoriza operacoes',()=>{
 const req={installationId:'b'.repeat(64),cnpj:'00000000000000'};
 const item={licenseId:'licenca-test',status:'active',
   paidUntil:1790000000,offlineSeconds:604800};
 assert.equal(buildGrant(req,item,1798000000).status,'suspended');
 assert.equal(buildGrant(req,{...item,status:'cancelled'},1798000000).status,'cancelled');
 assert.ok(buildGrant(req,item,1798000000).offlineUntil <= 1798000300);
});

test('Segredos nao estao no frontend ou no codigo da API',async()=>{
 const {readFileSync}=await import('node:fs');
 const sql=readFileSync('supabase/migrations/20261114183000_lkz_license_core.sql','utf8');
 const edge=readFileSync('supabase/functions/lkz-license/index.ts','utf8');
 assert.match(sql,/vault\.create_secret\(/);
 assert.match(sql,/extensions\.gen_random_bytes\(32\)/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/lkz_adm_private\.is_master\(\)/);
 assert.match(edge,/SUPABASE_SERVICE_ROLE_KEY/);
 assert.doesNotMatch(edge,/secret[_-]?key\s*[:=]\s*['"][A-Za-z0-9]/i);
 assert.doesNotMatch(edge,/localStorage|sessionStorage/);
 assert.match(edge,/2048/);
});
