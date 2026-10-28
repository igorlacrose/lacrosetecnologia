import {createClient} from "npm:@supabase/supabase-js@2.117.3";

const ORIGIN="https://lacrosetecnologia.com.br";
const REDIRECT=ORIGIN+"/lkzisp/";
const cors={
  "Access-Control-Allow-Origin":ORIGIN,
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Vary":"Origin",
  "Cache-Control":"no-store",
  "Content-Type":"application/json; charset=utf-8",
  "X-Content-Type-Options":"nosniff"
};
const send=(status:number,data:Record<string,unknown>)=>
  new Response(JSON.stringify(data),{status,headers:cors});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(origin&&origin!==ORIGIN)return send(403,{error:"origin_forbidden"});
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST")return send(405,{error:"method_not_allowed"});
  const authorization=req.headers.get("Authorization")||"";
  const token=authorization.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1]||"";
  if(!token)return send(401,{error:"login_required"});
  const url=Deno.env.get("SUPABASE_URL");
  const publicKey=Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!publicKey||!serviceKey)return send(503,{error:"auth_service_not_configured"});

  let payload:Record<string,unknown>;
  try{
    const raw=await req.text();
    if(raw.length>4000)throw Error("oversized");
    payload=JSON.parse(raw);
  }catch{return send(400,{error:"invalid_request"});}
  if(!payload||typeof payload!=="object"||Array.isArray(payload))
    return send(400,{error:"invalid_request"});

  const authenticator=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await authenticator.auth.getUser(token);
  const user=userData.user;
  if(userError||!user?.id)return send(401,{error:"invalid_session"});
  // getUser checked JWT with the Auth server. Check assurance only afterwards.
  let verifiedClaims:Record<string,unknown>;
  try{
    const part=token.split(".")[1];
    const bytes=Uint8Array.from(atob(part.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
    verifiedClaims=JSON.parse(new TextDecoder().decode(bytes));
  }catch{return send(403,{error:"invalid_claims"});}
  if(verifiedClaims.sub!==user.id||verifiedClaims.aal!=="aal2")
    return send(403,{error:"mfa_required"});
  const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

  if(payload.action==="accept"&&Object.keys(payload).length===1){
    if(!user.email_confirmed_at || !user.email)
      return send(403,{error:"confirmed_email_required"});
    const {data,error}=await service.rpc("lkz_isp_internal_accept_user_invitations",{p_user:user.id});
    if(error)return send(403,{error:"invitation_acceptance_denied"});
    return send(200,{status:"accepted_checked",accepted:Number(data?.accepted||0)});
  }

  if(payload.action==="send"&&Object.keys(payload).length===2){
    const invitationId=payload.invitation_id;
    if(typeof invitationId!=="string"||!uuid.test(invitationId))
      return send(400,{error:"invalid_invitation_id"});

    // A transação no Postgres verifica MASTER/gestor/admin, perfil solicitado,
    // limite de taxa e remetente autorizado, e reserva o convite uma única vez.
    const {data:reserved,error:reserveError}=await service.rpc("lkz_isp_internal_claim_invite_delivery",
      {p_invitation:invitationId,p_actor:user.id});
    if(reserveError){
      if(reserveError.message?.includes("RESEND_SMTP_NOT_CONFIGURED"))
        return send(409,{error:"resend_smtp_not_configured"});
      if(reserveError.message?.includes("INVITE_RATE_LIMIT"))
        return send(429,{error:"invitation_limit_reached"});
      return send(403,{error:"invitation_not_allowed_or_expired"});
    }
    if(reserved?.sender!=="convites@lacrosetecnologia.com.br"||reserved?.id!==invitationId
      ||typeof reserved?.email!=="string")return send(500,{error:"invitation_reservation_invalid"});

    let requested=false;
    try{
      const {error:inviteError}=await service.auth.admin.inviteUserByEmail(reserved.email,{
        redirectTo:REDIRECT
      });
      if(inviteError){
        const msg=String(inviteError.message||"").toLowerCase();
        // Accounts which already exist receive an authenticated magic link.
        // Never automatically create accounts with this fallback.
        if(inviteError.status===422 && /already|registered|exists/.test(msg)){
          const {error:otpError}=await authenticator.auth.signInWithOtp({
            email:reserved.email,
            options:{shouldCreateUser:false,emailRedirectTo:REDIRECT}
          });
          if(otpError)throw otpError;
        }else throw inviteError;
      }
      requested=true;
    }catch{
      // Release for controlled retry; the service can still impose rate limits.
      await service.rpc("lkz_isp_internal_finalize_invite_delivery",
        {p_invitation:invitationId,p_success:false});
      return send(502,{error:"email_delivery_request_failed",saved:true});
    }
    if(requested){
      const {data:finalized,error:finalError}=await service.rpc(
        "lkz_isp_internal_finalize_invite_delivery",
        {p_invitation:invitationId,p_success:true});
      if(finalError||finalized!=="sent"){
        // Keep status 'sending' if the provider accepted the send, to avoid duplicates.
        return send(503,{error:"delivery_status_reconciliation_needed",saved:true});
      }
      return send(200,{status:"submitted_to_email_provider",saved:true});
    }
  }
  return send(400,{error:"unsupported_action"});
});
