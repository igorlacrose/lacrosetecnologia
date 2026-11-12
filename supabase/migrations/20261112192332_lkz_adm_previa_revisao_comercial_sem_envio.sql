-- Revisão supervisionada de prévias comerciais: NÃO ENVIA mensagens.
-- Este módulo não possui worker nem endpoint de transporte.
create table if not exists lkz_adm_private.crm_message_previews (
  id uuid primary key,
  lead_id uuid not null references public.leads(id),
  contact_id uuid not null references public.contacts(id),
  channel text not null check (channel in ('whatsapp','email')),
  recipient_snapshot text not null check (char_length(recipient_snapshot) between 5 and 254),
  body_snapshot text not null check (char_length(btrim(body_snapshot)) between 1 and 2500),
  draft_version integer not null check (draft_version>0),
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  constraint crm_message_preview_review_consistency check (
    (status='pending' and reviewed_by is null and reviewed_at is null)
    or (status<>'pending' and reviewed_by is not null and reviewed_at is not null)
  )
);
create unique index if not exists crm_message_previews_one_pending
 on lkz_adm_private.crm_message_previews(lead_id,channel) where status='pending';
create index if not exists crm_message_previews_lead_date
 on lkz_adm_private.crm_message_previews(lead_id,requested_at desc);
alter table lkz_adm_private.crm_message_previews enable row level security;
revoke all on table lkz_adm_private.crm_message_previews from public,anon,authenticated;

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
     'consent_ready',coalesce(c.consent_contact,false) and c.consent_at is not null,
     'recipient_current', case p.channel
       when 'email' then lower(btrim(coalesce(c.email,'')))=p.recipient_snapshot
       else regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')=p.recipient_snapshot end,
     'draft_current',d.version=p.draft_version and d.body=p.body_snapshot,
     'delivery_enabled',false
   ) order by p.requested_at desc,p.id desc)
   from (
      select * from lkz_adm_private.crm_message_previews
      where lead_id=p_lead order by requested_at desc,id desc limit 30
   ) p
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
 l public.leads%rowtype;
 c public.contacts%rowtype;
 d lkz_adm_private.crm_reply_drafts%rowtype;
 v_note text:=nullif(btrim(coalesce(p_note,'')),'');
 v_target text;
 v_current text;
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
 if p.status<> 'pending' then
   if p.status=v_target and p.reviewed_by=auth.uid() and
      p.review_note is not distinct from v_note then
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
   if not found or not c.consent_contact or c.consent_at is null then
      raise exception 'Sem consentimento de contato registrado com data.' using errcode='42501';
   end if;
   v_current:=case when p.channel='email'
       then lower(btrim(coalesce(c.email,'')))
       else regexp_replace(coalesce(c.phone,''),'[^0-9]','','g') end;
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

CREATE OR REPLACE FUNCTION lkz_adm_private.crm_submit_message_preview(p_id uuid, p_lead uuid, p_channel text, p_draft_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_lead public.leads%rowtype;
  v_contact public.contacts%rowtype;
  v_draft lkz_adm_private.crm_reply_drafts%rowtype;
  v_preview lkz_adm_private.crm_message_previews%rowtype;
  v_recipient text;
begin
 if not lkz_adm_private.is_operator() or auth.uid() is null then
    raise exception 'Acesso administrativo com MFA exigido.' using errcode='42501';
 end if;
 if p_id is null or p_id='00000000-0000-0000-0000-000000000000'::uuid
    or p_lead is null or p_channel not in ('whatsapp','email')
    or p_draft_version is null or p_draft_version<1 then
    raise exception 'Dados de revisão inválidos.' using errcode='22023';
 end if;
 select * into v_lead from public.leads where id=p_lead for share;
 if not found or v_lead.contact_id is null or v_lead.status in ('archived','lost') then
    raise exception 'Oportunidade sem contato ou encerrada.' using errcode='22023';
 end if;
 select * into v_contact from public.contacts where id=v_lead.contact_id for share;
 if not found then raise exception 'Cadastro não encontrado.' using errcode='22023';end if;
 v_recipient:=case when p_channel='email'
   then lower(btrim(coalesce(v_contact.email,'')))
   else regexp_replace(coalesce(v_contact.phone,''),'[^0-9]','','g') end;
 if (p_channel='email' and (char_length(v_recipient)>254 or
       v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
   or (p_channel='whatsapp' and v_recipient !~ '^[0-9]{10,13}$') then
     raise exception 'Destino de contato inválido ou ausente.' using errcode='22023';
 end if;
 select * into v_draft from lkz_adm_private.crm_reply_drafts
   where lead_id=p_lead and channel=p_channel for share;
 if not found or v_draft.version<>p_draft_version then
   raise exception 'Rascunho alterado. Recarregue antes de solicitar aprovação.' using errcode='40001';
 end if;
 insert into lkz_adm_private.crm_message_previews(
   id,lead_id,contact_id,channel,recipient_snapshot,body_snapshot,draft_version,requested_by)
 values(p_id,p_lead,v_contact.id,p_channel,v_recipient,v_draft.body,v_draft.version,auth.uid())
 on conflict do nothing returning * into v_preview;
 if not found then
   select * into v_preview from lkz_adm_private.crm_message_previews where id=p_id;
   if not found or v_preview.lead_id is distinct from p_lead
      or v_preview.channel is distinct from p_channel
      or v_preview.draft_version is distinct from p_draft_version
      or v_preview.recipient_snapshot is distinct from v_recipient
      or v_preview.body_snapshot is distinct from v_draft.body
      or v_preview.requested_by is distinct from auth.uid() then
     raise exception 'Já existe aprovação pendente ou identificador utilizado.' using errcode='40001';
   end if;
   return jsonb_build_object('id',v_preview.id,'status',v_preview.status,
     'already_recorded',true,'delivery_enabled',false);
 end if;
 insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
 values(auth.uid(),p_lead,'crm.preview.submit',jsonb_build_object(
   'preview_id',p_id,'channel',p_channel,'draft_version',p_draft_version));
 return jsonb_build_object('id',p_id,'status','pending',
    'already_recorded',false,'delivery_enabled',false);
end $function$;

CREATE OR REPLACE FUNCTION public.lkz_adm_crm_list_message_previews(p_lead uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select lkz_adm_private.crm_list_message_previews(p_lead);
$function$;

CREATE OR REPLACE FUNCTION public.lkz_adm_crm_review_message_preview(p_id uuid, p_action text, p_note text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select lkz_adm_private.crm_review_message_preview(p_id,p_action,p_note);
$function$;

CREATE OR REPLACE FUNCTION public.lkz_adm_crm_submit_message_preview(p_id uuid, p_lead uuid, p_channel text, p_draft_version integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select lkz_adm_private.crm_submit_message_preview(p_id,p_lead,p_channel,p_draft_version);
$function$;

revoke all on function
 lkz_adm_private.crm_list_message_previews(uuid),
 lkz_adm_private.crm_submit_message_preview(uuid,uuid,text,integer),
 lkz_adm_private.crm_review_message_preview(uuid,text,text),
 public.lkz_adm_crm_list_message_previews(uuid),
 public.lkz_adm_crm_submit_message_preview(uuid,uuid,text,integer),
 public.lkz_adm_crm_review_message_preview(uuid,text,text) from public,anon,authenticated;
grant execute on function
 lkz_adm_private.crm_list_message_previews(uuid),
 lkz_adm_private.crm_submit_message_preview(uuid,uuid,text,integer),
 lkz_adm_private.crm_review_message_preview(uuid,text,text),
 public.lkz_adm_crm_list_message_previews(uuid),
 public.lkz_adm_crm_submit_message_preview(uuid,uuid,text,integer),
 public.lkz_adm_crm_review_message_preview(uuid,text,text) to authenticated;
