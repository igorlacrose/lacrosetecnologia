import {createClient} from "npm:@supabase/supabase-js@2.117.3";

/** Backend privado do LKZ ISP. Nunca exportar ou registrar token, senha, segredo, código TOTP ou service role. */
const ORIGIN="https://lacrosetecnologia.com.br";
const LANDING=ORIGIN+"/lkzisp/";
const cors={
 "Access-Control-Allow-Origin":ORIGIN,
 "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
 "Access-Control-Allow-Methods":"POST, OPTIONS",
 "Content-Type":"application/json; charset=utf-8",
 "Cache-Control":"no-store",
 "Vary":"Origin",
 "X-Content-Type-Options":"nosniff"
};
const send=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:cors});
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const validToken=(s:string)=>/^Bearer [A-Za-z0-9_.-]{40,12000}$/.test(s);
const validCode=(s:unknown)=>typeof s==="string"&&/^\d{6}$/.test(s);
const parseJWT=(jwt:string):Record<string,unknown>|null=>{
 try{
  const segment=jwt.split(".")[1];
  if(!segment||segment.length>16000)return null;
  const normalized=segment.replace(/-/g,"+").replace(/_/g,"/");
  return JSON.parse(atob(normalized)) as Record<string,unknown>;
 }catch{return null;}
};

Deno.serve(async(req:Request)=>{
 if(req.headers.get("Origin") && req.headers.get("Origin")!==ORIGIN)
  return send(403,{error:"origin_forbidden"});
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return send(405,{error:"method_not_allowed"});
 const authorization=req.headers.get("Authorization")||"";
 if(!validToken(authorization))return send(401,{error:"login_required"});
 const accessToken=authorization.slice(7);
 const url=Deno.env.get("SUPABASE_URL");
 const anon=Deno.env.get("SUPABASE_ANON_KEY");
 const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!secret)return send(503,{error:"auth_unavailable"});
 let request:Record<string,unknown>;
 try{
  const raw=await req.text();
  if(raw.length>1400)throw Error("payload");
  request=JSON.parse(raw);
  if(!request||typeof request!=="object"||Array.isArray(request))throw Error("payload");
 }catch{return send(400,{error:"invalid_request"});}
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:identity,error:identityError}=await auth.auth.getUser(accessToken);
 const actor=identity?.user;
 const claims=parseJWT(accessToken);
 if(identityError||!actor?.id||!claims||claims.sub!==actor.id)return send(401,{error:"invalid_session"});
 if(claims.aal!=="aal2")return send(403,{error:"mfa_required"});
 const {data:master,error:masterError}=await admin.rpc("lkz_isp_master_security_check",{p_actor:actor.id});
 if(masterError||master!==true)return send(403,{error:"master_required"});
 const allowedActions=["list","password_recovery","mfa_reset"];
 if(typeof request.action!=="string"||!allowedActions.includes(request.action))
  return send(400,{error:"invalid_action"});

 if(request.action==="list"){
  if(Object.keys(request).length!==1)return send(400,{error:"invalid_request"});
  // A lista é do produto LKZ ISP; não inclui usuários de outros projetos ou de Auth sem vínculo.
  const {data:links,error:linksError}=await admin.from("lkz_isp_memberships")
   .select("tenant_id,user_id,role").order("created_at",{ascending:true}).limit(200);
  if(linksError||!links)return send(503,{error:"memberships_unavailable"});
  if(links.length===200)return send(503,{error:"user_pagination_required"});
  const unique=[...new Set(links.map(x=>x.user_id as string))];
  const users:Record<string,{email:string;email_confirmed:boolean}>={};
  for(const uid of unique){
   const {data:found,error}=await admin.auth.admin.getUserById(uid);
   if(error||!found?.user?.email)return send(503,{error:"identity_lookup_failed"});
   users[uid]={email:found.user.email,email_confirmed:!!found.user.email_confirmed_at};
  }
  return send(200,{users:links.map(m=>({
   user_id:m.user_id,tenant_id:m.tenant_id,role:m.role,
   email:users[m.user_id].email,email_confirmed:users[m.user_id].email_confirmed,
   is_self:m.user_id===actor.id
  }))});
 }

 if(Object.keys(request).sort().join(",")!=="action,code,factor_id,target_id")
  return send(400,{error:"invalid_request"});
 if(typeof request.target_id!=="string"||!uuid.test(request.target_id))
  return send(400,{error:"invalid_target"});
 if(typeof request.factor_id!=="string"||!uuid.test(request.factor_id)||!validCode(request.code))
  return send(400,{error:"second_factor_confirmation_required"});

 // Revalidação recente: exige NOVO desafio TOTP do MASTER em cada operação sensível.
 // Não confia exclusivamente em um token AAL2 antigo nem no botão da interface.
 const {data:factors,error:factorError}=await auth.auth.getUser(accessToken);
 const current=factors.user?.factors?.find(f=>f.id===request.factor_id&&f.status==="verified"&&f.factor_type==="totp");
 if(factorError||!current)return send(403,{error:"master_totp_not_found"});
 const headers={apikey:anon,Authorization:"Bearer "+accessToken,"Content-Type":"application/json"};
 let checked=false;
 try{
  const challenge=await fetch(url+"/auth/v1/factors/"+encodeURIComponent(request.factor_id)+"/challenge",{
   method:"POST",headers,body:"{}",signal:AbortSignal.timeout(8000)});
  const challengeData=await challenge.json();
  if(challenge.ok&&uuid.test(challengeData?.id||"")){
   const verified=await fetch(url+"/auth/v1/factors/"+encodeURIComponent(request.factor_id)+"/verify",{
    method:"POST",headers,body:JSON.stringify({challenge_id:challengeData.id,code:request.code}),
    signal:AbortSignal.timeout(8000)});
   if(verified.ok){
    const ver=await verified.json();
    const newClaims=parseJWT(ver?.access_token||"");
    const {data:revalidated,error:verificationError}=await auth.auth.getUser(ver?.access_token||"");
    checked=!verificationError&&revalidated.user?.id===actor.id&&newClaims?.aal==="aal2";
   }
  }
 }catch{/* Falha fechado, não registrar códigos. */}
 if(!checked)return send(403,{error:"second_factor_verification_failed"});

 const targetId=request.target_id;
 const {data:target,error:targetError}=await admin.auth.admin.getUserById(targetId);
 if(targetError||!target?.user?.email)return send(403,{error:"target_unavailable"});
 if(!target.user.email_confirmed_at)return send(403,{error:"target_email_unconfirmed"});

 const {data:requestId,error:reservationError}=await admin.rpc("lkz_isp_master_security_reserve",{
  p_actor:actor.id,p_target:targetId,p_action:request.action
 });
 if(reservationError){
  if(reservationError.message?.includes("SECURITY_ACTION_RATE_LIMIT"))return send(429,{error:"security_action_rate_limit"});
  return send(403,{error:"security_action_denied"});
 }
 let success=false,removedCount=0,details:Record<string,unknown>={};
 try{
  if(request.action==="password_recovery"){
   // O destinatário escolhe a própria senha pelo link Auth; o MASTER nunca recebe senhas ou links.
   const {error:resetError}=await admin.auth.resetPasswordForEmail(target.user.email,{redirectTo:LANDING});
   if(resetError)throw Error("email_not_accepted");
   success=true;details={status:"recovery_requested",self:targetId===actor.id};
  }else if(request.action==="mfa_reset"){
   const {data:list,error:listError}=await admin.auth.admin.mfa.listFactors({userId:targetId});
   if(listError)throw Error("factor_lookup_failed");
   const factors=((list?.factors||[]) as Array<{id:string;status:string;factor_type:string}>).filter(f=>f.factor_type==='totp');
   // Pode remover mais de um fator do MESMO usuário; qualquer falha deve ser explícita.
   if(!factors.length)throw Error("no_factor_to_reset");
   /* contagem preservada entre chamadas externas */
   for(const f of factors){
    const {error:deleteError}=await admin.auth.admin.mfa.deleteFactor({userId:targetId,id:f.id});
    if(deleteError)throw Error("factor_delete_failed");
    removedCount++;
   }
   const {data:readback,error:readbackError}=await admin.auth.admin.mfa.listFactors({userId:targetId});
   if(readbackError||(readback?.factors||[]).some(f=>f.factor_type==="totp"))throw Error("factor_readback_failed");
   success=true;details={status:"mfa_reset_completed",removed_count:removedCount,self:targetId===actor.id};
  }
 }catch{/* Falha reportada sem revelar dados de autenticação. */}
 try{
  const {error:finishError}=await admin.rpc("lkz_isp_master_security_finish",{
   p_actor:actor.id,p_request:requestId,p_success:success
  });
  if(finishError)return send(503,{error:"audit_confirmation_required"});
 }catch{return send(503,{error:"audit_confirmation_required"});}
 if(!success)return send(removedCount>0?409:502,{error:removedCount>0?"mfa_partial_reset_detected":"recovery_action_failed"});
 return send(200,details);
});
