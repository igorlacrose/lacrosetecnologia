/* Sessão de dispositivo confiável, opt-in.
 * Salva APENAS refresh token criptografado em IndexedDB, não senha ou código TOTP.
 * Chave WebCrypto AES-GCM não extraível (limitação: JS do mesmo origin pode invocar decrypt).
 * Expiração por 6h de inatividade; tokens válidos continuam sujeitos a Auth/RLS/MFA.
 */
export const IDLE_LIMIT_MS = 6*60*60*1000;
export function isSessionWithinIdleLimit(lastActivity,now=Date.now()){
 return Number.isFinite(lastActivity) && Number.isFinite(now) && lastActivity<=now+120000
  && now-lastActivity>=0 && now-lastActivity<IDLE_LIMIT_MS;
}
const STORE='trusted-session';
const DATABASE='lkzisp-secure-device-v1';
function supported(){return typeof indexedDB!=='undefined' && !!globalThis.crypto?.subtle && globalThis.isSecureContext!==false;}
function openDb(){
 if(!supported())return Promise.reject(Error('Este navegador não permite guardar sessão protegida.'));
 return new Promise((resolve,reject)=>{
  const r=indexedDB.open(DATABASE,1);
  r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE)};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||Error('Banco protegido indisponível'));
 });
}
async function access(mode,callback){
 const db=await openDb();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,mode),obj=tx.objectStore(STORE);
  let value;
  tx.oncomplete=()=>resolve(value);
  tx.onerror=()=>reject(tx.error||Error('Falha na sessão local'));
  tx.onabort=()=>reject(tx.error||Error('Operação local cancelada'));
  callback(obj,(v)=>{value=v},reject);
 })}finally{db.close()}
}
export async function clearTrustedSession(){
 if(!supported())return;
 try{await access('readwrite',(obj)=>obj.delete('session'))}catch{}
}
export async function saveTrustedSession(refreshToken, lastActivity=Date.now()){
 if(typeof refreshToken!=='string'||!refreshToken||refreshToken.length>4096
   ||!Number.isFinite(lastActivity)||lastActivity>Date.now()+120000)
  throw Error('Estado da sessão inválido.');
 const previous=await access('readonly',(obj,done,reject)=>{
  const r=obj.get('key');r.onsuccess=()=>done(r.result||null);r.onerror=()=>reject(r.error);
 });
 const key=previous||await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(refreshToken));
 await access('readwrite',(obj)=>{
  obj.put(key,'key');
  obj.put({iv:Array.from(iv),cipher:Array.from(new Uint8Array(encrypted)),lastActivity},'session');
 });
}
export async function loadTrustedSession(now=Date.now()){
 if(!supported())return null;
 try{
  const state=await access('readonly',(obj,done,reject)=>{
   const r=obj.get('session');r.onsuccess=()=>done(r.result||null);r.onerror=()=>reject(r.error);
  });
  if(!state)return null;
  if(!isSessionWithinIdleLimit(state.lastActivity,now)){
    await clearTrustedSession();return null;
  }
  const key=await access('readonly',(obj,done,reject)=>{
   const r=obj.get('key');r.onsuccess=()=>done(r.result||null);r.onerror=()=>reject(r.error);
  });
  if(!key)return null;
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(state.iv)},key,new Uint8Array(state.cipher));
  const refreshToken=new TextDecoder().decode(plain);
  if(!refreshToken||refreshToken.length>4096)throw Error('Sessão local inválida.');
  return {refreshToken,lastActivity:state.lastActivity};
 }catch{await clearTrustedSession();return null}
}
