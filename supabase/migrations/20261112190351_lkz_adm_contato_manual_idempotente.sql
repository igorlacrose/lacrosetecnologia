-- Exatamente as funcoes e indice aplicados ao banco remoto em 2026-11-12.
-- Mantem a API legada para compatibilidade, sem envio por provedor.
create unique index if not exists uq_lead_events_manual_contact_request
 on public.lead_events ((after_data->>'request_id'))
 where event_type like 'admin.manual_contact.%' and after_data ? 'request_id';

CREATE OR REPLACE FUNCTION lkz_adm_private.crm_log_manual_contact_once(p_lead uuid, p_channel text, p_summary text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_summary text:=btrim(coalesce(p_summary,''));
 v_id bigint;
 v_event public.lead_events%rowtype;
 v_already boolean:=false;
begin
 if not lkz_adm_private.is_operator() or auth.uid() is null then
   raise exception 'Acesso administrativo com MFA exigido.' using errcode='42501';
 end if;
 if p_lead is null or p_request_id is null or
    p_request_id='00000000-0000-0000-0000-000000000000'::uuid or
    p_channel not in ('whatsapp','email','phone','other') or
    char_length(v_summary) not between 5 and 1500 or
    not exists (select 1 from public.leads where id=p_lead)
 then
   raise exception 'Registro de contato inválido.' using errcode='22023';
 end if;
 insert into public.lead_events(lead_id,event_type,actor_type,actor_id,note,after_data)
 values(p_lead,'admin.manual_contact.'||p_channel,'admin',auth.uid(),v_summary,
   jsonb_build_object('channel',p_channel,'automatic_delivery',false,'request_id',p_request_id))
 on conflict do nothing returning id into v_id;

 if v_id is null then
   select e.* into v_event from public.lead_events e
    where e.event_type like 'admin.manual_contact.%'
      and e.after_data->>'request_id'=p_request_id::text;
   if not found or v_event.lead_id is distinct from p_lead or
      v_event.actor_id is distinct from auth.uid() or
      v_event.event_type is distinct from 'admin.manual_contact.'||p_channel or
      v_event.note is distinct from v_summary
   then
     raise exception 'Identificador já utilizado com outro conteúdo. Atualize o histórico.'
       using errcode='40001';
   end if;
   v_id:=v_event.id;
   v_already:=true;
 else
   insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
   values(auth.uid(),p_lead,'crm.manual_contact',
     jsonb_build_object('channel',p_channel,'event_id',v_id,'idempotent',true));
 end if;

 return jsonb_build_object(
   'event_id',v_id,'lead_id',p_lead,'channel',p_channel,
   'registered',true,'sent_by_system',false,'already_recorded',v_already
 );
end $function$;

CREATE OR REPLACE FUNCTION public.lkz_adm_crm_log_manual_contact_once(p_lead uuid, p_channel text, p_summary text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select lkz_adm_private.crm_log_manual_contact_once(
   p_lead,p_channel,p_summary,p_request_id);
$function$;

revoke all on function
 lkz_adm_private.crm_log_manual_contact_once(uuid,text,text,uuid),
 public.lkz_adm_crm_log_manual_contact_once(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function
 lkz_adm_private.crm_log_manual_contact_once(uuid,text,text,uuid),
 public.lkz_adm_crm_log_manual_contact_once(uuid,text,text,uuid) to authenticated;
