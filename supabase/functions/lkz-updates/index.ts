import {verifyReleaseCandidate} from './manifest.mjs';

// Read-only update discovery. Neither this service nor its callers can publish
// a release, run arbitrary commands or bypass package signature validation.
const ROOT=Deno.env.get('SUPABASE_URL')||'';
const SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const MAX_REQUEST=2048;
const HEADERS={
 'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff',
 'Content-Security-Policy':"default-src 'none'"
};
const error=(status:number,code:string)=>new Response(
 JSON.stringify({error:code}),{status,headers:HEADERS}
);
async function readJSON(req:Request){
 if((req.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!=='application/json')
  throw new Error('bad_content_type');
 if(Number(req.headers.get('content-length')||0)>MAX_REQUEST)throw new Error('too_large');
 const reader=req.body?.getReader();
 if(!reader)throw new Error('bad_body');
 let chunks:Uint8Array[]=[],total=0;
 try{
  while(true){
   const r=await reader.read();if(r.done)break;
   total+=r.value?.byteLength||0;
   if(total>MAX_REQUEST)throw new Error('too_large');
   if(r.value)chunks.push(r.value);
  }
 }finally{reader.releaseLock()}
 const all=new Uint8Array(total),decoder=new TextDecoder('utf-8',{fatal:true});
 let offset=0;for(const ch of chunks){all.set(ch,offset);offset+=ch.length}
 const parsed=JSON.parse(decoder.decode(all));
 if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error('bad_body');
 return parsed;
}
async function serverPost(path:string,payload:unknown){
 if(!ROOT.startsWith('https://')||!SERVICE_KEY)throw new Error('configuration_missing');
 const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),5000);
 try{
  const res=await fetch(new URL(path,ROOT),{
   method:'POST',redirect:'error',signal:abort.signal,
   headers:{'Content-Type':'application/json',apikey:SERVICE_KEY,
    Authorization:'Bearer '+SERVICE_KEY},
   body:JSON.stringify(payload)
  });
  if(!res.ok)throw new Error('backend_unavailable');
  const body=await res.text();
  if(body.length>8192)throw new Error('response_too_large');
  return JSON.parse(body);
 }finally{clearTimeout(timeout)}
}
async function releaseURL(objectPath:string){
 const safePath=objectPath.split('/').map(encodeURIComponent).join('/');
 const signed=await serverPost('/storage/v1/object/sign/lkz-update-packages/'+safePath,
   {expiresIn:900});
 if(!signed||typeof signed.signedURL!=='string'||
    !signed.signedURL.startsWith('/object/sign/lkz-update-packages/'))
  throw new Error('bad_storage_url');
 const url=new URL('/storage/v1'+signed.signedURL,ROOT);
 if(url.protocol!=='https:'||url.origin!==new URL(ROOT).origin||
    !url.pathname.startsWith('/storage/v1/object/sign/lkz-update-packages/')||
    !url.searchParams.has('token'))throw new Error('bad_storage_url');
 return url.toString();
}
Deno.serve(async req=>{
 if(req.method!=='POST'||new URL(req.url).pathname.split('/').at(-1)!=='check')
  return error(404,'not_found');
 let params;
 try{params=await readJSON(req)}
 catch(e){return error(e instanceof Error&&e.message==='too_large'?413:400,'invalid_body')}
 const {installationId,cnpj,product,currentVersion,platform}=params;
 if(typeof installationId!=='string'||!/^[a-f0-9]{64}$/.test(installationId)||
    typeof cnpj!=='string'||!/^[0-9]{14}$/.test(cnpj)||
    product!=='lkz-erp'||platform!=='windows-amd64'||
    typeof currentVersion!=='string'||
    !/^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/.test(currentVersion))
   return error(400,'invalid_request');
 try{
  const license=await serverPost('/rest/v1/rpc/lkz_license_lookup_v1',{
    p_product:product,p_cnpj:cnpj,p_installation:installationId
  });
  if(!license)return error(404,'installation_not_registered');
  if(license.rate_limited===true)return error(429,'rate_limited');
  // Keep patch delivery available even for a suspended installation.
  // A signed update never changes the license entitlement or enables sales.
  const candidate=await serverPost('/rest/v1/rpc/lkz_updates_candidate_v1',{
    p_product:product,p_cnpj:cnpj,p_installation:installationId,
    p_current_version:currentVersion
  });
  if(!candidate)return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
  const manifest=await verifyReleaseCandidate(candidate,currentVersion);
  const url=await releaseURL(manifest.objectPath);
  return new Response(JSON.stringify({
    manifest:candidate.manifest,
    signature:candidate.signature,
    keyId:candidate.keyId,
    downloadUrl:url,
    expiresIn:900
  }),{status:200,headers:HEADERS});
 }catch{
  // No private signing material, tenant IDs or SQL errors in public responses.
  return error(503,'update_service_unavailable');
 }
});
