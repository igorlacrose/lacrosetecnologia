-- OCA: preparação multiempresa isolada. Nenhum tenant/lead é criado automaticamente.
-- Pré-validação registra bloqueios, sem envio, fila executável ou provider.
create table lkz_adm_private.oca_comm_workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  display_name text not null check (char_length(btrim(display_name)) between 3 and 120),
  enabled boolean not null default false check(enabled in(true,false)),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp()
);
create table lkz_adm_private.oca_comm_memberships (
  workspace_id uuid not null references lkz_adm_private.oca_comm_workspaces(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  role text not null check(role in ('owner','admin','operator')),
  active boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  primary key(workspace_id,actor_id)
);
create table lkz_adm_private.oca_comm_lead_bindings (
  lead_id uuid primary key references public.leads(id) on delete restrict,
  workspace_id uuid not null references lkz_adm_private.oca_comm_workspaces(id) on delete restrict,
  bound_by uuid not null references auth.users(id),
  bound_at timestamptz not null default clock_timestamp()
);
create index oca_comm_leads_workspace_idx on lkz_adm_private.oca_comm_lead_bindings(workspace_id,lead_id);
create table lkz_adm_private.oca_comm_preflights (
  request_id uuid primary key,
  preview_id uuid not null references lkz_adm_private.crm_message_previews(id) on delete restrict,
  workspace_id uuid references lkz_adm_private.oca_comm_workspaces(id) on delete restrict,
  actor_id uuid not null references auth.users(id),
  checked_at timestamptz not null default clock_timestamp(),
  blockers text[] not null check(array_length(blockers,1)>0),
  status text not null default 'blocked' check(status='blocked'),
  delivery_enabled boolean not null default false check(delivery_enabled=false)
);
create index oca_comm_preflight_preview_idx on lkz_adm_private.oca_comm_preflights(preview_id,checked_at desc);
alter table lkz_adm_private.oca_comm_workspaces enable row level security;
alter table lkz_adm_private.oca_comm_memberships enable row level security;
alter table lkz_adm_private.oca_comm_lead_bindings enable row level security;
alter table lkz_adm_private.oca_comm_preflights enable row level security;
revoke all on lkz_adm_private.oca_comm_workspaces,
 lkz_adm_private.oca_comm_memberships,
 lkz_adm_private.oca_comm_lead_bindings,
 lkz_adm_private.oca_comm_preflights from public,anon,authenticated;

CREATE OR REPLACE FUNCTION lkz_adm_private.oca_comm_preflight(p_preview uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_preview lkz_adm_private.crm_message_previews%rowtype;
  v_lead public.leads%rowtype;
  v_contact public.contacts%rowtype;
  v_draft lkz_adm_private.crm_reply_drafts%rowtype;
  v_consent lkz_adm_private.contact_consent_events%rowtype;
  v_workspace uuid;
  v_workspace_enabled boolean;
  v_destination text;
  v_blockers text[]:='{}'::text[];
  v_record lkz_adm_private.oca_comm_preflights%rowtype;
  v_already boolean:=false;
begin
  if not lkz_adm_private.is_operator() or auth.uid() is null then
    raise exception 'Acesso administrativo com MFA obrigatório.' using errcode='42501';
  end if;
  if p_preview is null or p_request_id is null or
     p_request_id='00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Parâmetros de pré-despacho inválidos.' using errcode='22023';
  end if;
  select * into v_preview from lkz_adm_private.crm_message_previews
    where id=p_preview;
  if not found then
    raise exception 'Prévia não encontrada.' using errcode='22023';
  end if;

  select workspace_id into v_workspace from lkz_adm_private.oca_comm_lead_bindings
    where lead_id=v_preview.lead_id;
  if v_workspace is null then
    if not lkz_adm_private.is_master() then
      raise exception 'A oportunidade não está vinculada a uma empresa do OCA.' using errcode='42501';
    end if;
    v_blockers:=array_append(v_blockers,'workspace_unassigned');
  else
    if not exists (
      select 1 from lkz_adm_private.oca_comm_memberships m
      where m.workspace_id=v_workspace and m.actor_id=auth.uid() and m.active
    ) then
      raise exception 'Sem vínculo autorizado com a empresa.' using errcode='42501';
    end if;
    select enabled into v_workspace_enabled
      from lkz_adm_private.oca_comm_workspaces where id=v_workspace;
    if v_workspace_enabled is distinct from true then
      v_blockers:=array_append(v_blockers,'workspace_disabled');
    end if;
  end if;

  -- Revalidar autorização por empresa mesmo em uma retentativa idempotente.
  select * into v_record from lkz_adm_private.oca_comm_preflights
    where request_id=p_request_id;
  if found then
    if v_record.actor_id is distinct from auth.uid() or
       v_record.preview_id is distinct from p_preview or
       v_record.workspace_id is distinct from v_workspace then
      raise exception 'Identificador já utilizado com outros dados.' using errcode='40001';
    end if;
    return jsonb_build_object('request_id',v_record.request_id,
      'preview_id',v_record.preview_id,'workspace_id',v_record.workspace_id,
      'status','blocked','blockers',to_jsonb(v_record.blockers),
      'already_recorded',true,'delivery_enabled',false,
      'dry_run_only',true);
  end if;

  if v_preview.status<>'approved' then
    v_blockers:=array_append(v_blockers,'preview_not_approved');
  end if;
  select * into v_lead from public.leads where id=v_preview.lead_id;
  if not found or v_lead.contact_id is distinct from v_preview.contact_id or
    v_lead.status in ('won','lost','archived') then
    v_blockers:=array_append(v_blockers,'lead_closed_or_relinked');
  end if;
  select * into v_contact from public.contacts where id=v_preview.contact_id;
  if not found then
    v_blockers:=array_append(v_blockers,'recipient_missing');
  else
    v_destination:=case v_preview.channel when 'email'
      then lower(btrim(coalesce(v_contact.email,'')))
      else regexp_replace(coalesce(v_contact.phone,''),'[^0-9]','','g') end;
    if v_destination is distinct from v_preview.recipient_snapshot then
      v_blockers:=array_append(v_blockers,'recipient_changed');
    end if;
    select * into v_consent from lkz_adm_private.contact_consent_events
      where contact_id=v_preview.contact_id and channel=v_preview.channel
      order by id desc limit 1;
    if not found or v_consent.action is distinct from 'grant' or
      v_consent.recipient_snapshot is distinct from v_destination then
      v_blockers:=array_append(v_blockers,'consent_missing_or_stale');
    end if;
  end if;
  select * into v_draft from lkz_adm_private.crm_reply_drafts
    where lead_id=v_preview.lead_id and channel=v_preview.channel;
  if not found or v_draft.version is distinct from v_preview.draft_version or
    v_draft.body is distinct from v_preview.body_snapshot then
    v_blockers:=array_append(v_blockers,'draft_changed_or_missing');
  end if;

  -- BLOQUEADOR INCONDICIONAL: nenhum worker / integração pode usar esta tabela.
  v_blockers:=array_append(v_blockers,'transport_disabled');
  insert into lkz_adm_private.oca_comm_preflights(
    request_id,preview_id,workspace_id,actor_id,blockers)
  values(p_request_id,p_preview,v_workspace,auth.uid(),v_blockers)
  on conflict (request_id) do nothing returning * into v_record;
  if not found then
    select * into v_record from lkz_adm_private.oca_comm_preflights
      where request_id=p_request_id;
    if not found or v_record.actor_id is distinct from auth.uid() or
      v_record.preview_id is distinct from p_preview or
      v_record.workspace_id is distinct from v_workspace then
      raise exception 'Identificador de diagnóstico já utilizado.' using errcode='40001';
    end if;
    v_already:=true;
  else
    insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
    values(auth.uid(),p_preview,'oca.dispatch.preflight',
      jsonb_build_object('workspace_id',v_workspace,
        'blockers',to_jsonb(v_blockers),'request_id',p_request_id));
  end if;
  return jsonb_build_object('request_id',v_record.request_id,
    'preview_id',v_record.preview_id,'workspace_id',v_record.workspace_id,
    'status','blocked','blockers',to_jsonb(v_record.blockers),
    'already_recorded',v_already,'delivery_enabled',false,
    'dry_run_only',true);
end $function$;

CREATE OR REPLACE FUNCTION public.lkz_adm_oca_comm_preflight(p_preview uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select lkz_adm_private.oca_comm_preflight(p_preview,p_request_id);
$function$;

revoke all on function
 lkz_adm_private.oca_comm_preflight(uuid,uuid),
 public.lkz_adm_oca_comm_preflight(uuid,uuid)
from public,anon,authenticated;
grant execute on function
 lkz_adm_private.oca_comm_preflight(uuid,uuid),
 public.lkz_adm_oca_comm_preflight(uuid,uuid)
to authenticated;
