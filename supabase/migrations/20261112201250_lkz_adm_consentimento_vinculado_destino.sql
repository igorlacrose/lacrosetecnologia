-- Bloqueio de segurança: autorização atrelada ao destino (telefone/e-mail) vigente.
-- Correção aditiva, não altera autorizações existentes (0 no momento da aplicação).
alter table lkz_adm_private.contact_consent_events add column recipient_snapshot text;
alter table lkz_adm_private.contact_consent_events
 add constraint grant_requires_destination check(
   (action='grant' and recipient_snapshot is not null and length(recipient_snapshot) between 5 and 254)
   or (action='revoke' and recipient_snapshot is null)
 );

CREATE OR REPLACE FUNCTION lkz_adm_private.crm_list_message_previews(p_lead uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not lkz_adm_private.is_operator() or auth.uid() is null then
  raise exception 'Acesso administrativo com MFA exigido.' using errcode='42501';
 end if;
 if p_lead is null or not exists(select 1 from public.leads where id=p_lead) then
  raise exception 'Oportunidade não encontrada.' using errcode='22023';
 end if;
 return coalesce((
   select jsonb_agg(jsonb_build_object(
    'id',p.id,'lead_id',p.lead_id,'channel',p.channel,
    'recipient',p.recipient_snapshot,'body',p.body_snapshot,
    'draft_version',p.draft_version,'status',p.status,
    'requested_at',p.requested_at,'reviewed_at',p.reviewed_at,'review_note',p.review_note,
    'consent_ready',coalesce((select e.action='grant' and e.recipient_snapshot is not distinct from
      (case when p.channel='email' then lower(btrim(coalesce(c.email,'')))
        else regexp_replace(coalesce(c.phone,''),'[^0-9]','','g') end)
      from lkz_adm_private.contact_consent_events e
      where e.contact_id=p.contact_id and e.channel=p.channel
      order by e.id desc limit 1),false),
    'recipient_current', case p.channel
      when 'email' then lower(btrim(coalesce(c.email,'')))=p.recipient_snapshot
      else regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')=p.recipient_snapshot end,
    'draft_current',d.version=p.draft_version and d.body=p.body_snapshot,
    'delivery_enabled',false
   ) order by p.requested_at desc,p.id desc)
   from (select * from lkz_adm_private.crm_message_previews
    where lead_id=p_lead order by requested_at desc,id desc limit 30)p
   join public.contacts c on c.id=p.contact_id
   left join lkz_adm_private.crm_reply_drafts d
    on d.lead_id=p.lead_id and d.channel=p.channel
 ),'[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION lkz_adm_private.crm_review_message_preview(p_id uuid, p_action text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 p lkz_adm_private.crm_message_previews%rowtype;
 l public.leads%rowtype; c public.contacts%rowtype;
 d lkz_adm_private.crm_reply_drafts%rowtype;
 v_note text:=nullif(btrim(coalesce(p_note,'')),'');
 v_target text;v_current text;v_consent text;v_consent_recipient text;
begin
 if not lkz_adm_private.is_operator() or auth.uid() is null then
  raise exception 'Acesso administrativo com MFA exigido.' using errcode='42501';
 end if;
 if p_id is null or p_action not in ('approve','reject','cancel')
   or char_length(coalesce(v_note,''))>500 then
  raise exception 'Decisão ou justificativa inválida.' using errcode='22023';
 end if;
 if p_action in ('approve','reject') and not lkz_adm_private.is_master() then
  raise exception 'Revisão reservada ao MASTER com MFA.' using errcode='42501';
 end if;
 if p_action='reject' and (v_note is null or char_length(v_note)<5) then
  raise exception 'Informe o motivo da rejeição.' using errcode='22023';
 end if;
 select * into p from lkz_adm_private.crm_message_previews where id=p_id for update;
 if not found then raise exception 'Solicitação inexistente.' using errcode='22023';end if;
 v_target:=case p_action when 'approve' then 'approved'
             when 'reject' then 'rejected' else 'cancelled' end;
 if p.status<>'pending' then
  if p.status=v_target and p.reviewed_by=auth.uid()
   and p.review_note is not distinct from v_note then
   return jsonb_build_object('id',p.id,'status',p.status,
     'already_recorded',true,'delivery_enabled',false);
  end if;
  raise exception 'Solicitação já decidida por outro fluxo.' using errcode='40001';
 end if;
 if p_action='cancel' and p.requested_by<>auth.uid() and not lkz_adm_private.is_master() then
  raise exception 'Cancelamento sem permissão.' using errcode='42501';
 end if;
 if p_action='approve' then
  select * into l from public.leads where id=p.lead_id for share;
  if not found or l.contact_id is distinct from p.contact_id or l.status in ('lost','archived') then
   raise exception 'Oportunidade ou vínculo do cliente alterado.' using errcode='40001';
  end if;
  select * into c from public.contacts where id=p.contact_id for share;
  if not found then raise exception 'Cadastro do destinatário não encontrado.' using errcode='40001';end if;
  v_current:=case when p.channel='email'
    then lower(btrim(coalesce(c.email,'')))
    else regexp_replace(coalesce(c.phone,''),'[^0-9]','','g') end;
  select action,recipient_snapshot into v_consent,v_consent_recipient
   from lkz_adm_private.contact_consent_events
   where contact_id=p.contact_id and channel=p.channel order by id desc limit 1;
  if v_consent is distinct from 'grant' or v_consent_recipient is distinct from v_current then
   raise exception 'Autorização inexistente, revogada ou vinculada a outro destino.'
     using errcode='42501';
  end if;
  if v_current is distinct from p.recipient_snapshot then
   raise exception 'Destino mudou depois da solicitação.' using errcode='40001';
  end if;
  select * into d from lkz_adm_private.crm_reply_drafts
   where lead_id=p.lead_id and channel=p.channel for share;
  if not found or d.version is distinct from p.draft_version
   or d.body is distinct from p.body_snapshot then
   raise exception 'Rascunho alterado depois da solicitação.' using errcode='40001';
  end if;
 end if;
 update lkz_adm_private.crm_message_previews set
  status=v_target,reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),review_note=v_note
  where id=p_id;
 insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
 values(auth.uid(),p.lead_id,'crm.preview.'||p_action,
  jsonb_build_object('preview_id',p_id,'channel',p.channel,'status',v_target));
 return jsonb_build_object('id',p_id,'status',v_target,
  'already_recorded',false,'delivery_enabled',false);
end $function$;

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

CREATE OR REPLACE FUNCTION lkz_adm_private.list_contact_consents(p_contact uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not lkz_adm_private.is_operator() or auth.uid() is null then
  raise exception 'Sessão administrativa com MFA obrigatória.' using errcode='42501';
 end if;
 if p_contact is null or not exists(select 1 from public.contacts where id=p_contact) then
  raise exception 'Contato inexistente.' using errcode='22023';
 end if;
 return jsonb_build_object('contact_id',p_contact,
  'current',coalesce((
    select jsonb_object_agg(e.channel,jsonb_build_object(
      'status',case
        when e.action='grant' and e.recipient_snapshot is distinct from
           (case when e.channel='email' then lower(btrim(coalesce(c.email,'')))
             else regexp_replace(coalesce(c.phone,''),'[^0-9]','','g') end)
        then 'stale' else e.action end,
      'recipient_current',e.action='grant' and e.recipient_snapshot is not distinct from
         (case when e.channel='email' then lower(btrim(coalesce(c.email,'')))
          else regexp_replace(coalesce(c.phone,''),'[^0-9]','','g') end),
      'recorded_at',e.recorded_at,'observed_at',e.observed_at,
      'method',e.proof_method,'proof_ref',e.proof_ref))
    from (select distinct on (channel) * from lkz_adm_private.contact_consent_events
      where contact_id=p_contact order by channel,id desc)e
    join public.contacts c on c.id=e.contact_id
  ),'{}'::jsonb),
  'history',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',e.id,'channel',e.channel,'action',e.action,
      'recorded_at',e.recorded_at,'observed_at',e.observed_at,
      'method',e.proof_method,'proof_ref',e.proof_ref,'reason',e.reason)
      order by e.id desc)
    from (select * from lkz_adm_private.contact_consent_events
      where contact_id=p_contact order by id desc limit 25)e
  ),'[]'::jsonb),
  'delivery_enabled',false);
end $function$;

