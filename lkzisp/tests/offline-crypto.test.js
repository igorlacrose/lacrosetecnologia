import test from 'node:test';import assert from 'node:assert/strict';
import {sealForOffline,openOffline} from '../src/offline-crypto.js';
const identity={tenantId:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222'};
test('AES-GCM/PBKDF2 sela conteúdo sem chave persistida e detecta adulteração',async()=>{
 const secret='uma frase local independente longa!';
 const sealed=await sealForOffline({total:123,sector:'Financeiro'},secret,identity);
 assert.equal(JSON.stringify(sealed).includes('Financeiro'),false);
 assert.deepEqual(await openOffline(sealed,secret,identity),{total:123,sector:'Financeiro'});
 await assert.rejects(()=>openOffline(sealed,'frase totalmente incorreta',identity));
 const tampered={...sealed,ciphertext:sealed.ciphertext.slice(0,-4)+'AAAA'};
 await assert.rejects(()=>openOffline(tampered,secret,identity));
 await assert.rejects(()=>openOffline(sealed,secret,{...identity,userId:'33333333-3333-4333-8333-333333333333'}));
});
test('recusa frase curta e contexto sem identidade autorizada',async()=>{
 await assert.rejects(()=>sealForOffline({ok:true},'curta',identity));
 await assert.rejects(()=>sealForOffline({ok:true},'frase comprida de teste',{tenantId:'x',userId:'x'}));
});
