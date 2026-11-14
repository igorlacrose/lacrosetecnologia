// O signatário privado de updates opera SOMENTE em laboratório (Darkstar/Osiris).
// O serviço de distribuição valida a assinatura mas jamais possui a chave privada.
const textDecoder=new TextDecoder('utf-8',{fatal:true});
function fromB64url(input,minLength,maxLength){
 if(typeof input!=='string'||input.length<minLength||input.length>maxLength||
    !/^[A-Za-z0-9_-]+$/.test(input))throw new Error('invalid_base64url');
 const padded=input.replace(/-/g,'+').replace(/_/g,'/');
 const raw=atob(padded+'='.repeat((4-padded.length%4)%4));
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
export function compareVersions(a,b){
 const pat=/^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/;
 if(!pat.test(String(a))||!pat.test(String(b)))throw new Error('invalid_version');
 const aa=a.split('.').map(Number),bb=b.split('.').map(Number);
 for(let i=0;i<3;i++)if(aa[i]!==bb[i])return aa[i]<bb[i]?-1:1;
 return 0;
}
export function isSafeArtifactPath(product,version,path){
 if(typeof path!=='string'||path.length>256||path.includes('..'))return false;
 const match=/^[a-z0-9-]+\/[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}\/[A-Za-z0-9._-]{1,128}\.zip$/.test(path);
 return match&&path.startsWith(product+'/'+version+'/');
}
export async function verifyReleaseCandidate(candidate,currentVersion,cryptoApi=crypto){
 if(!candidate||typeof candidate!=='object')throw new Error('invalid_release');
 const fields=['schema','releaseId','product','version','platform','channel',
   'objectPath','sha256','sizeBytes'];
 const {manifest,signature,publicKey}=candidate;
 const bytes=fromB64url(manifest,64,4096);
 const sig=fromB64url(signature,86,86);
 const key=fromB64url(publicKey,43,43);
 if(sig.length!==64||key.length!==32)throw new Error('invalid_key_or_signature');
 const imported=await cryptoApi.subtle.importKey('raw',key,{name:'Ed25519'},false,['verify']);
 if(!await cryptoApi.subtle.verify('Ed25519',imported,sig,bytes))throw new Error('bad_signature');
 const obj=JSON.parse(textDecoder.decode(bytes));
 if(!obj||typeof obj!=='object'||Array.isArray(obj)||
    fields.length!==Object.keys(obj).length||
    fields.some(x=>!Object.prototype.hasOwnProperty.call(obj,x)))
   throw new Error('invalid_manifest');
 if(obj.schema!==1||typeof obj.releaseId!=='string'||obj.releaseId!==candidate.releaseId||
    !['lkz-erp','libertyos','barbaros'].includes(obj.product)||
    obj.product!==candidate.product||obj.version!==candidate.version||
    obj.platform!=='windows-amd64'||obj.platform!==candidate.platform||
    obj.channel!==candidate.channel||!['pilot','stable'].includes(obj.channel)||
    !isSafeArtifactPath(obj.product,obj.version,obj.objectPath)||
    obj.objectPath!==candidate.objectPath||
    !/^[a-f0-9]{64}$/.test(obj.sha256)||obj.sha256!==candidate.sha256||
    !Number.isSafeInteger(obj.sizeBytes)||obj.sizeBytes<1||obj.sizeBytes>1000000000||
    obj.sizeBytes!==candidate.sizeBytes||compareVersions(obj.version,currentVersion)<=0)
    throw new Error('invalid_manifest_content');
 return obj;
}
