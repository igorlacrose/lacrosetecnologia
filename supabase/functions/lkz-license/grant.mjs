// Ed25519 grant encoding must match the Go struct field order exactly.
const encoder=new TextEncoder();
const PREFIX=new Uint8Array([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
function base64url(bytes){
 let s='';for(const b of bytes)s+=String.fromCharCode(b);
 return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function importSigningSeed(seed64,cryptoApi=crypto){
 if(typeof seed64!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(seed64))
   throw Error('invalid_seed');
 const seed=Uint8Array.from(atob(seed64),c=>c.charCodeAt(0));
 if(seed.length!==32)throw Error('invalid_seed_length');
 const pkcs8=new Uint8Array(PREFIX.length+seed.length);
 pkcs8.set(PREFIX);pkcs8.set(seed,PREFIX.length);
 try{return await cryptoApi.subtle.importKey('pkcs8',pkcs8,{name:'Ed25519'},true,['sign'])}
 finally{seed.fill(0);pkcs8.fill(0)}
}
export async function publicKeyB64(key,cryptoApi=crypto){
 const jwk=await cryptoApi.subtle.exportKey('jwk',key);
 if(jwk.crv!=='Ed25519'||typeof jwk.x!=='string'||jwk.x.length!==43)
   throw Error('public_key_invalid');
 return jwk.x;
}
export function buildGrant(req,license,now=Math.floor(Date.now()/1000)){
 const status=(license.status==='active'||license.status==='grace')&&
  Number(license.paidUntil)>now+60?license.status:
  license.status==='cancelled'?'cancelled':'suspended';
 const allowed=status==='active'||status==='grace';
 const seconds=allowed?Math.floor(Number(license.offlineSeconds)):300;
 if(!Number.isInteger(seconds)||seconds<60||seconds>604800)throw Error('invalid_ttl');
 const validUntil=allowed?Math.min(Number(license.paidUntil),now+604800):now+300;
 if(!Number.isInteger(validUntil)||validUntil<=now)throw Error('invalid_valid_until');
 return {
  version:1,
  licenseId:String(license.licenseId),
  installationId:req.installationId,
  cnpj:req.cnpj,
  status,
  issuedAt:now,
  validUntil,
  offlineUntil:Math.min(validUntil,now+seconds)
 };
}
export async function signGrant(key,grant,cryptoApi=crypto){
 const signature=new Uint8Array(await cryptoApi.subtle.sign('Ed25519',key,encoder.encode(JSON.stringify(grant))));
 if(signature.length!==64)throw Error('invalid_signature');
 return {grant,signature:base64url(signature)};
}
