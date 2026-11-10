// Supabase Edge Function OCA Converse v2 — código apenas em branch, NÃO DEPLOYADO.
// Endpoint público SOMENTE para triagem, sem ações financeiras ou provisionamento.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
import { createSession, applyTurn } from "../_shared/oca-qualification.mjs";

const ALLOWED_ORIGINS = new Set([
  "https://lacrosetecnologia.com.br",
  "https://www.lacrosetecnologia.com.br"
]);
const MAX_BYTES = 4096;
const TABLE = "oca_sessions_v2";

function headers(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type,apikey,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  };
}
function json(origin: string, status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: headers(origin) });
}
function toHex(array: Uint8Array) {
  return [...array].map(v=>v.toString(16).padStart(2,'0')).join('');
}
async function sha256(input: string) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))));
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let result = "";
  for (const b of bytes) result += String.fromCharCode(b);
  return btoa(result).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function safeIp(req: Request) {
  // Cabeçalhos de encaminhamento não constituem identidade confiável.
  // A implantação deve confirmar o cabeçalho realmente definido pelo proxy.
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
  return ip.slice(0,100);
}

Deno.serve(async(req: Request)=>{
  const origin = req.headers.get("origin")||"";
  if(!ALLOWED_ORIGINS.has(origin)) {
    return new Response('origin_not_allowed',{status:403,headers:{"Cache-Control":"no-store"}});
  }
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:headers(origin)});
  if(req.method!=="POST")return json(origin,405,{ok:false,error:"method_not_allowed"});
  if(!(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))
    return json(origin,415,{ok:false,error:"unsupported_content_type"});
  const length=Number(req.headers.get("content-length")||0);
  if(length>MAX_BYTES)return json(origin,413,{ok:false,error:"payload_too_large"});
  let body: Record<string,unknown>;
  try {
    const raw=await req.text();
    if(new TextEncoder().encode(raw).byteLength>MAX_BYTES)return json(origin,413,{ok:false,error:"payload_too_large"});
    const parsed=JSON.parse(raw);
    if(!parsed||Array.isArray(parsed)||typeof parsed!=="object")throw Error("body");
    body=parsed as Record<string,unknown>;
  }catch {return json(origin,400,{ok:false,error:"invalid_json"});}
  const url=Deno.env.get("SUPABASE_URL");
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!serviceKey)return json(origin,503,{ok:false,error:"service_unavailable"});
  const db=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const limitKey=await sha256("oca-v2|"+origin+"|"+safeIp(req));
  const limited=await db.rpc("check_agent_rate_limit",{
    p_key_hash:limitKey,p_limit:20,p_window_seconds:60
  });
  if(limited.error||typeof limited.data!=="boolean")return json(origin,503,{ok:false,error:"rate_limit_unavailable"});
  if(limited.data===false)return json(origin,429,{ok:false,error:"rate_limited"});

  if(body.action==="start") {
    if(Object.keys(body).some(k=>k!=="action"))return json(origin,400,{ok:false,error:"unexpected_fields"});
    const sessionToken=randomToken(),tokenHash=await sha256(sessionToken);
    const state=createSession();
    const result=await db.from(TABLE).insert({
      session_token_hash:tokenHash,conversation_state:state,revision:0
    }).select("expires_at").single();
    if(result.error)return json(origin,503,{ok:false,error:"session_create_failed"});
    return json(origin,201,{ok:true,sessionToken,expiresAt:result.data.expires_at,
      reply:"Olá! Sou o assistente da Lacrose Tecnologia. Qual desafio você quer resolver?"});
  }
  if(body.action!=="message")return json(origin,400,{ok:false,error:"invalid_action"});
  if(Object.keys(body).some(k=>!["action","sessionToken","requestId","message"].includes(k)))
    return json(origin,400,{ok:false,error:"unexpected_fields"});
  if(typeof body.sessionToken!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(body.sessionToken))
    return json(origin,400,{ok:false,error:"invalid_session_token"});
  if(typeof body.requestId!=="string"||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId))
    return json(origin,400,{ok:false,error:"invalid_request_id"});
  if(typeof body.message!=="string"||body.message.length>1800||!body.message.trim())
    return json(origin,400,{ok:false,error:"invalid_message"});

  const tokenHash=await sha256(body.sessionToken);
  const {data:session,error:loadErr}=await db.from(TABLE).select(
    "id,revision,conversation_state,last_request_id,last_reply,expires_at"
  ).eq("session_token_hash",tokenHash).maybeSingle();
  if(loadErr)return json(origin,503,{ok:false,error:"lookup_failed"});
  if(!session)return json(origin,404,{ok:false,error:"session_not_found"});
  if(Date.parse(session.expires_at)<=Date.now())return json(origin,410,{ok:false,error:"session_expired"});
  if(session.last_request_id===body.requestId)
    return json(origin,200,{ok:true,reply:session.last_reply,
      readyForHumanReview:session.conversation_state?.stage==="ready_for_review",replay:true});
  let outcome;
  try {outcome=applyTurn(session.conversation_state,body.message);}
  catch{return json(origin,422,{ok:false,error:"invalid_state_or_message"});}
  const revision=session.revision+1;
  const update=await db.from(TABLE).update({
    conversation_state:outcome.state,revision,last_request_id:body.requestId,
    last_reply:outcome.reply,updated_at:new Date().toISOString()
  }).eq("id",session.id).eq("revision",session.revision).select("id");
  if(update.error)return json(origin,503,{ok:false,error:"write_failed"});
  if(!update.data?.length)return json(origin,409,{ok:false,error:"concurrent_request_retry"});
  return json(origin,200,{ok:true,reply:outcome.reply,
    readyForHumanReview:outcome.readyForHumanReview,revision});
});
