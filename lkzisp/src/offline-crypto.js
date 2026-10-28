/**
 * Criptografia de payloads previamente saneados, reservada para cache offline futuro.
 * Não salva chave/senha nem faz persistência por conta própria.
 * Gate: conectar somente depois de autenticação e autorização server-side reais.
 */
const te=new TextEncoder(),td=new TextDecoder();
const MIN_PASSPHRASE_LENGTH=16;
const ITERATIONS=600000;
const b64=u=>{let s='';for(const v of u)s+=String.fromCharCode(v);return btoa(s)};
const un64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const ns=({tenantId,userId})=>{
 if(!/^[a-f0-9-]{36}$/i.test(tenantId||'')||!/^[a-f0-9-]{36}$/i.test(userId||''))throw new Error('Contexto de segurança inválido.');
 return `lkz-isp|v1|${tenantId}|${userId}`;
};
async function derive(passphrase,salt){
 const source=await crypto.subtle.importKey('raw',te.encode(passphrase),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},source,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function sealForOffline(payload,passphrase,identity){
 if(typeof passphrase!=='string'||passphrase.length<MIN_PASSPHRASE_LENGTH)throw new Error('Utilize uma frase de desbloqueio independente, com pelo menos 16 caracteres.');
 const context=ns(identity);
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('Payload inválido.');
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await derive(passphrase,salt);
 const encoded=te.encode(JSON.stringify(payload));
 if(encoded.byteLength>2_000_000)throw new Error('Resumo excede o limite de cache protegido.');
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:te.encode(context)},key,encoded);
 return {version:1,algorithm:'AES-256-GCM/PBKDF2-SHA256',salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(ciphertext))};
}
export async function openOffline(sealed,passphrase,identity){
 const context=ns(identity);
 if(!sealed||sealed.version!==1||sealed.algorithm!=='AES-256-GCM/PBKDF2-SHA256')throw new Error('Formato de cache criptográfico não suportado.');
 try{
  const salt=un64(sealed.salt),iv=un64(sealed.iv),data=un64(sealed.ciphertext);
  if(salt.length!==16||iv.length!==12||data.length>2_000_016)throw new Error('Envelope inválido.');
  const key=await derive(passphrase,salt);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:te.encode(context)},key,data);
  return JSON.parse(td.decode(plain));
 }catch {throw new Error('Não foi possível desbloquear o cache. Credencial, vínculo ou integridade inválidos.');}
}
