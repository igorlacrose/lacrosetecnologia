import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  compareVersions,isSafeArtifactPath,verifyReleaseCandidate
} from '../supabase/functions/lkz-updates/manifest.mjs';

const encoder=new TextEncoder();
const encode=value=>Buffer.from(value).toString('base64url');
async function signedRelease(options={}){
 const pair=await webcrypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
 const publicKey=encode(await webcrypto.subtle.exportKey('raw',pair.publicKey));
 const base={
  schema:1,
  releaseId:randomUUID(),
  product:'lkz-erp',
  version:'1.3.4',
  platform:'windows-amd64',
  channel:'pilot',
  objectPath:'lkz-erp/1.3.4/LKZ-ERP-1.3.4-windows-amd64.zip',
  sha256:'b'.repeat(64),
  sizeBytes:10563891,
  ...options
 };
 const source=encoder.encode(JSON.stringify(base));
 const signature=encode(await webcrypto.subtle.sign('Ed25519',pair.privateKey,source));
 const candidate={
  releaseId:base.releaseId,product:base.product,version:base.version,
  platform:base.platform,channel:base.channel,objectPath:base.objectPath,
  sha256:base.sha256,sizeBytes:base.sizeBytes,
  manifest:encode(source),signature,publicKey,keyId:'offline-signing-v1'
 };
 return {candidate,base,pair};
}
test('manifesto legitimo: piloto, hash e verificacao Ed25519',async()=>{
 const {candidate,base}=await signedRelease();
 const decoded=await verifyReleaseCandidate(candidate,'1.3.3',webcrypto);
 assert.deepEqual(decoded,base);
});
test('nao permite instalar versoes iguais, anteriores ou caminho arbitrario',async()=>{
 const {candidate}=await signedRelease();
 await assert.rejects(verifyReleaseCandidate(candidate,'1.3.4',webcrypto));
 await assert.rejects(verifyReleaseCandidate(candidate,'1.3.5',webcrypto));
 assert.ok(compareVersions('1.3.10','1.3.9')>0);
 assert.ok(!isSafeArtifactPath('lkz-erp','1.3.4','../malware.exe'));
 assert.ok(!isSafeArtifactPath('lkz-erp','1.3.4','lkz-erp/1.3.4/../malware.zip'));
 assert.ok(!isSafeArtifactPath('lkz-erp','1.3.4','https://evil.invalid/a.zip'));
});
test('assina bytes originais: adulteracoes no DB e assinatura falham',async()=>{
 const {candidate}=await signedRelease();
 for(const changes of [
  {sha256:'c'.repeat(64)}, {product:'barbaros'}, {version:'1.3.5'},
  {objectPath:'lkz-erp/1.3.4/changed.zip'},
  {sizeBytes:5}, {channel:'stable'},
  {signature:encode(new Uint8Array(64))}
 ]){
  await assert.rejects(
   verifyReleaseCandidate({...candidate,...changes},'1.3.3',webcrypto)
  );
 }
});
test('chave rotacionada ou manifesto malformado falham fechado',async()=>{
 const {candidate}=await signedRelease();
 const other=await signedRelease();
 await assert.rejects(verifyReleaseCandidate({...candidate,publicKey:other.candidate.publicKey},'1.3.3',webcrypto));
 await assert.rejects(verifyReleaseCandidate({...candidate,manifest:encode('not-json')},'1.3.3',webcrypto));
 const plus=await signedRelease({unapprovedField:'untrusted'});
 await assert.rejects(verifyReleaseCandidate(plus.candidate,'1.3.3',webcrypto));
});
test('integração não concede CRUD aos clientes nem contém chave privada',()=>{
 const sql=readFileSync('supabase/migrations/20261114224500_lkz_updates_signed_registry.sql','utf8');
 const edge=readFileSync('supabase/functions/lkz-updates/index.ts','utf8');
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/g);
 assert.match(sql,/REVOKE ALL ON ALL TABLES IN SCHEMA lkz_licensing/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.lkz_updates_candidate_v1/);
 assert.match(sql,/WHERE l\.cnpj=p_cnpj AND l\.product=p_product/);
 assert.match(sql,/i\.installation_id=p_installation AND i\.enabled/);
 assert.match(sql,/update_pilot_targets/);
 assert.match(sql,/r\.status='published'/);
 assert.match(edge,/lkz_license_lookup_v1/);
 assert.match(edge,/verifyReleaseCandidate/);
 assert.match(edge,/storage\/v1\/object\/sign\/lkz-update-packages/);
 assert.match(edge,/expiresIn:900/);
 assert.doesNotMatch(edge,/eval\s*\(|new Function|exec\s*\(|localStorage|innerHTML/);
 assert.doesNotMatch(edge,/PRIVATE_KEY|SIGNING_SEED|LICENSE_SIGNING_SECRET/);
});
