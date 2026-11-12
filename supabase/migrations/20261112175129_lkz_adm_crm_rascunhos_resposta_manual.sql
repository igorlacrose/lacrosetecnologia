-- LKZ ADM: rascunhos internos de resposta e registro de contato manual. Não envia mensagens.
create table if not exists lkz_adm_private.crm_reply_drafts (
 lead_id uuid not null references public.leads(id) on delete cascade,
 channel text not null check(channel in ('whatsapp','email','phone','other')),
 body text not null check(char_length(btrim(body)) between 1 and 2500),
 version integer not null default 1 check(version > 0),
 updated_at timestamptz not null default now(),
 updated_by uuid not null,
 primary key(lead_id,channel)
);
alter table lkz_adm_private.crm_reply_drafts enable row level security;
revoke all on table lkz_adm_private.crm_reply_drafts from public,anon,authenticated;

CREATE OR REPLACE FUNCTION lkz_adm_private.crm_delete_reply_draft(p_lead uuid, p_channel text, p_expected_version integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Acesso administrativo com MFA exigido.' using errcode='42501';
  end if;
  if p_lead is null or p_channel not in ('whatsapp','email','phone','other')
    or p_expected_version is null or p_expected_version<=0 then
    raise exception 'Seleção inválida.' using errcode='22023';
  end if;
  delete from lkz_adm_private.crm_reply_drafts
  where lead_id=p_lead and channel=p_channel and version=p_expected_version;
  if not found then
    raise exception 'O rascunho foi alterado ou removido em outra sessão.' using errcode='40001';
  end if;
  insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
  values(auth.uid(),p_lead,'crm.reply_draft.delete',jsonb_build_object('channel',p_channel));
  return true;
end $function$;

CREATE OR REPLACE FUNCTION lkz_adm_private.crm_list_reply_drafts(p_lead uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Acesso administrativo com MFA exigido.' using errcode='42501';
  end if;
  if p_lead is null or not exists(select 1 from public.leads where id=p_lead) then
    raise exception 'Oportunidade inválida.' using errcode='22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'lead_id',d.lead_id,'channel',d.channel,'body',d.body,'version',d.version,
      'updated_at',d.updated_at) order by d.channel)
    from lkz_adm_private.crm_reply_drafts d where d.lead_id=p_lead),'[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION lkz_adm_private.crm_log_manual_contact(p_lead uuid, p_channel text, p_summary text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_summary text:=btrim(coalesce(p_summary,''));v_id bigint;
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Acesso administrativo com MFA exigido.' using errcode='42501';
  end if;
  if p_lead is null or p_channel not in ('whatsapp','email','phone','other')
     or char_length(v_summary) not between 5 and 1500
     or not exists(select 1 from public.leads where id=p_lead) then
    raise exception 'Contato manual inválido.' using errcode='22023';
  end if;
  insert into public.lead_events(lead_id,event_type,actor_type,actor_id,note,after_data)
  values(p_lead,'admin.manual_contact.'||p_channel,'admin',auth.uid(),
    v_summary,jsonb_build_object('channel',p_channel,'automatic_delivery',false))
  returning id into v_id;
  insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
  values(auth.uid(),p_lead,'crm.manual_contact',
    jsonb_build_object('channel',p_channel,'event_id',v_id));
  return jsonb_build_object('event_id',v_id,'lead_id',p_lead,'channel',p_channel,
    'registered',true,'sent_by_system',false);
end $function$;

CREATE OR REPLACE FUNCTION lkz_adm_private.crm_save_reply_draft(p_lead uuid, p_channel text, p_body text, p_expected_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_body text:=btrim(coalesce(p_body,''));d lkz_adm_private.crm_reply_drafts%rowtype;
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Acesso administrativo com MFA exigido.' using errcode='42501';
  end if;
  if p_lead is null or p_channel not in ('whatsapp','email','phone','other')
     or p_expected_version is null or p_expected_version<0
     or char_length(v_body) not between 1 and 2500
     or not exists(select 1 from public.leads where id=p_lead) then
    raise exception 'Rascunho ou oportunidade inválidos.' using errcode='22023';
  end if;
  if p_expected_version=0 then
    insert into lkz_adm_private.crm_reply_drafts(lead_id,channel,body,updated_by)
    values(p_lead,p_channel,v_body,auth.uid())
    on conflict do nothing returning * into d;
  else
    update lkz_adm_private.crm_reply_drafts set body=v_body,
      version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
    where lead_id=p_lead and channel=p_channel and version=p_expected_version
    returning * into d;
  end if;
  if not found then
    raise exception 'O rascunho foi alterado em outra sessão. Recarregue.' using errcode='40001';
  end if;
  insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
  values(auth.uid(),p_lead,'crm.reply_draft.save',
    jsonb_build_object('channel',p_channel,'version',d.version,'length',char_length(v_body)));
  return jsonb_build_object('lead_id',d.lead_id,'channel',d.channel,'body',d.body,
    'version',d.version,'updated_at',d.updated_at);
end $function$;

CREATE OR REPLACE FUNCTION public.lkz_adm_crm_delete_reply_draft(p_lead uuid, p_channel text, p_expected_version integer)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select lkz_adm_private.crm_delete_reply_draft(p_lead,p_channel,p_expected_version);
$function$;

CREATE OR REPLACE FUNCTION public.lkz_adm_crm_list_reply_drafts(p_lead uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select lkz_adm_private.crm_list_reply_drafts(p_lead);
$function$;

CREATE OR REPLACE FUNCTION public.lkz_adm_crm_log_manual_contact(p_lead uuid, p_channel text, p_summary text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select lkz_adm_private.crm_log_manual_contact(p_lead,p_channel,p_summary);
$function$;

CREATE OR REPLACE FUNCTION public.lkz_adm_crm_save_reply_draft(p_lead uuid, p_channel text, p_body text, p_expected_version integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select lkz_adm_private.crm_save_reply_draft(p_lead,p_channel,p_body,p_expected_version);
$function$;

revoke all on function
 lkz_adm_private.crm_list_reply_drafts(uuid),
 lkz_adm_private.crm_save_reply_draft(uuid,text,text,integer),
 lkz_adm_private.crm_delete_reply_draft(uuid,text,integer),
 lkz_adm_private.crm_log_manual_contact(uuid,text,text),
 public.lkz_adm_crm_list_reply_drafts(uuid),
 public.lkz_adm_crm_save_reply_draft(uuid,text,text,integer),
 public.lkz_adm_crm_delete_reply_draft(uuid,text,integer),
 public.lkz_adm_crm_log_manual_contact(uuid,text,text) from public,anon,authenticated;
grant execute on function
 lkz_adm_private.crm_list_reply_drafts(uuid),
 lkz_adm_private.crm_save_reply_draft(uuid,text,text,integer),
 lkz_adm_private.crm_delete_reply_draft(uuid,text,integer),
 lkz_adm_private.crm_log_manual_contact(uuid,text,text),
 public.lkz_adm_crm_list_reply_drafts(uuid),
 public.lkz_adm_crm_save_reply_draft(uuid,text,text,integer),
 public.lkz_adm_crm_delete_reply_draft(uuid,text,integer),
 public.lkz_adm_crm_log_manual_contact(uuid,text,text) to authenticated;
