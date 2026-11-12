-- Reautorizar novo destino exige comprovação posterior à alteração cadastral.
CREATE OR REPLACE FUNCTION lkz_adm_private.grant_contact_consent(p_request_id uuid, p_contact uuid, p_channel text, p_method text, p_proof_ref text, p_observed_at timestamp with time zone, p_evidence_checked boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_ref text:=btrim(coalesce(p_proof_ref,''));
 v_row lkz_adm_private.contact_consent_events%rowtype;
 v_last lkz_adm_private.contact_consent_events%rowtype;
 v_contact public.contacts%rowtype;
 v_recipient text;
begin
 if not lkz_adm_private.is_master() or auth.uid() is null then
  raise exception 'Registro de autorização reservado ao MASTER com MFA.' using errcode='42501';
 end if;
 if p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid
    or p_contact is null or p_channel not in ('whatsapp','email')
    or p_method not in ('web_form','signed_document','email_confirmation',
      'whatsapp_message','call_recording')
    or p_evidence_checked is distinct from true
    or char_length(v_ref) not between 8 and 160
    or v_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    or v_ref ~* '^https?://'
    or p_observed_at is null
    or p_observed_at>clock_timestamp()+interval '5 minutes'
    or p_observed_at<clock_timestamp()-interval '10 years' then
  raise exception 'Comprovação de autorização inválida.' using errcode='22023';
 end if;
 select * into v_contact from public.contacts where id=p_contact for update;
 if not found then raise exception 'Contato inexistente.' using errcode='22023';end if;
 v_recipient:=case when p_channel='email' then lower(btrim(coalesce(v_contact.email,'')))
   else regexp_replace(coalesce(v_contact.phone,''),'[^0-9]','','g') end;
 if (p_channel='email' and (length(v_recipient)>254 or
     v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
   or (p_channel='whatsapp' and v_recipient !~ '^[0-9]{10,13}$') then
   raise exception 'Destino atual inválido para autorização.' using errcode='22023';
 end if;
 select * into v_last from lkz_adm_private.contact_consent_events
   where contact_id=p_contact and channel=p_channel order by id desc limit 1;
 if v_last.action='grant' and v_last.recipient_snapshot is distinct from v_recipient
   and p_observed_at<=v_contact.updated_at then
  raise exception 'A comprovação precisa ser posterior à mudança do destino cadastrado.'
   using errcode='42501';
 end if;
 if v_last.action='revoke' and p_observed_at<=v_last.recorded_at then
  raise exception 'Para reautorizar após revogação, use comprovação posterior ao pedido de saída.'
  using errcode='42501';
 end if;
 insert into lkz_adm_private.contact_consent_events(
  request_id,contact_id,channel,action,proof_method,proof_ref,observed_at,actor_id,recipient_snapshot)
 values(p_request_id,p_contact,p_channel,'grant',p_method,v_ref,p_observed_at,auth.uid(),v_recipient)
 on conflict (request_id) do nothing returning * into v_row;
 if not found then
   select * into v_row from lkz_adm_private.contact_consent_events
    where request_id=p_request_id;
   if not found or v_row.contact_id is distinct from p_contact
     or v_row.channel is distinct from p_channel or v_row.action<>'grant'
     or v_row.proof_method is distinct from p_method
     or v_row.proof_ref is distinct from v_ref
     or v_row.observed_at is distinct from p_observed_at
     or v_row.recipient_snapshot is distinct from v_recipient
     or v_row.actor_id is distinct from auth.uid() then
     raise exception 'Identificador reutilizado com dados diferentes.' using errcode='40001';
   end if;
   return jsonb_build_object('id',v_row.id,'status','grant','already_recorded',true,
    'delivery_enabled',false);
 end if;
 insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
 values(auth.uid(),p_contact,'contact.consent.grant',
  jsonb_build_object('channel',p_channel,'event_id',v_row.id,'method',p_method));
 return jsonb_build_object('id',v_row.id,'status','grant','already_recorded',false,
  'delivery_enabled',false);
end $function$;
