import {buildGrant,importSigningSeed,publicKeyB64,signGrant} from './grant.mjs';

const SUPABASE_URL=Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MAX_BYTES=2048;
const HEADERS={
 'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff',
 'Content-Security-Policy':"default-src 'none'"
};
function response(status:number,body:unknown){
 return new Response(JSON.stringify(body),{status,headers:HEADERS});
}
async function safeBody(req:Request){
 const reader=req.body?.getReader();
 if(!reader)return '';
 const chunks:Uint8Array[]=[];let total=0;
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   total+=value?.length||0;
   if(total>MAX_BYTES)throw Error('too_large');
   if(value)chunks.push(value);
  }
 }finally{reader.releaseLock()}
 const data=new Uint8Array(total);let pos=0;
 for(const chunk of chunks){data.set(chunk,pos);pos+=chunk.length}
 return new TextDecoder('utf-8',{fatal:true}).decode(data);
}
async function rpc(name:string,args:Record<string,unknown>){
 if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY)throw Error('not_configured');
 const url=new URL('/rest/v1/rpc/'+name,SUPABASE_URL);
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),4000);
 try{
  const result=await fetch(url,{
   method:'POST',
   headers:{
    'Content-Type':'application/json',
    apikey:SUPABASE_SERVICE_ROLE_KEY,
    Authorization:'Bearer '+SUPABASE_SERVICE_ROLE_KEY
   },
   body:JSON.stringify(args),
   signal:abort.signal,
   redirect:'error'
  });
  if(!result.ok)throw Error('database_unavailable');
  return await result.json();
 }finally{clearTimeout(timer)}
}
async function signingKey(){
 const seed=await rpc('lkz_license_signing_seed_v1',{});
 return importSigningSeed(seed);
}
Deno.serve(async(req:Request)=>{
 const path=new URL(req.url).pathname;
 try{
  if(req.method==='GET'&&path.endsWith('/public-key')){
   const key=await signingKey();
   return response(200,{algorithm:'Ed25519',version:1,publicKey:await publicKeyB64(key)});
  }
  if(req.method!=='POST'||!path.endsWith('/entitlement'))
   return response(404,{error:'not_found'});
  if((req.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!=='application/json')
   return response(415,{error:'unsupported_media_type'});
  if(Number(req.headers.get('content-length')||0)>MAX_BYTES)
   return response(413,{error:'payload_too_large'});
  let payload:Record<string,unknown>;
  try{payload=JSON.parse(await safeBody(req))}
  catch(e){return response(e instanceof Error&&e.message==='too_large'?413:400,{error:'invalid_body'})}
  if(!payload||Array.isArray(payload)||typeof payload!=='object')
   return response(400,{error:'invalid_request'});
  const {installationId,cnpj,product}=payload;
  if(typeof installationId!=='string'||!/^[a-f0-9]{64}$/.test(installationId)||
     typeof cnpj!=='string'||!/^[0-9]{14}$/.test(cnpj)||product!=='lkz-erp')
   return response(400,{error:'invalid_request'});
  const license=await rpc('lkz_license_lookup_v1',{
   p_product:product,p_installation:installationId,p_cnpj:cnpj
  });
  if(!license)return response(404,{error:'license_not_found'});
  if(license.rate_limited===true)return response(429,{error:'rate_limited'});
  const grant=buildGrant({installationId,cnpj},license);
  const signed=await signGrant(await signingKey(),grant);
  return response(200,signed);
 }catch{
  // No customer data, SQL detail, keys, or tokens in public responses or logs.
  return response(503,{error:'license_service_unavailable'});
 }
});
