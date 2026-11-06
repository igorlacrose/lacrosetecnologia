create table lkz_adm_private.operator_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  target_id uuid not null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  changed_at timestamptz not null default now()
);
alter table lkz_adm_private.operator_audit enable row level security;
revoke all on lkz_adm_private.operator_audit from public, anon, authenticated;

create function lkz_adm_private.register_client(p_id uuid, p_company text, p_name text, p_email text, p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item public.contacts%rowtype;
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Acesso administrativo com MFA obrigatório.' using errcode = '42501';
  end if;
  p_company := nullif(btrim(p_company), '');
  p_name := nullif(btrim(p_name), '');
  p_email := nullif(lower(btrim(p_email)), '');
  p_phone := nullif(btrim(p_phone), '');
  if p_id is null or coalesce(length(p_company), length(p_name), 0) < 2
    or length(p_company) not between 2 and 120 or length(p_name) not between 2 and 120
    or length(p_email) > 254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(p_phone) > 32 or p_phone !~ '^[+0-9(). -]+$'
    or concat(p_company,p_name,p_email,p_phone) ~ '[[:cntrl:]]' then
    raise exception 'Confira os dados do cliente.' using errcode = '22023';
  end if;
  insert into public.contacts (id,company_name,person_name,email,phone)
    values (p_id,p_company,p_name,p_email,p_phone) on conflict (id) do nothing returning * into item;
  if found then
    insert into lkz_adm_private.operator_audit (actor_id,target_id,action)
      values (auth.uid(),p_id,'client.register');
  else
    select * into item from public.contacts where id = p_id;
    if not exists (select 1 from lkz_adm_private.operator_audit where target_id=p_id and actor_id=auth.uid() and action='client.register')
      or (item.company_name,item.person_name,item.email,item.phone) is distinct from (p_company,p_name,p_email,p_phone) then
      raise exception 'Cadastro já registrado.' using errcode = '23505';
    end if;
  end if;
  return jsonb_build_object('id',item.id,'company_name',item.company_name,'person_name',item.person_name,'email',item.email,'phone',item.phone);
end;
$$;

create function lkz_adm_private.purge_messages(p_conversation uuid, p_ids bigint[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  requested integer := cardinality(p_ids);
  removed integer;
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Acesso administrativo com MFA obrigatório.' using errcode = '42501';
  end if;
  if p_conversation is null or requested is null or requested not between 1 and 50
    or requested <> (select count(distinct value) from unnest(p_ids) as entry(value)) then
    raise exception 'Seleção inválida.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('lkz_adm_message:' || p_conversation::text, 0));
  with deleted as (
    delete from public.messages m using lkz_adm_private.message_folders f
    where m.id=f.message_id and f.folder='deleted' and m.conversation_id=p_conversation and m.id=any(p_ids)
    returning m.id
  )
  insert into lkz_adm_private.message_folder_audit (message_id,actor_id,previous_folder,next_folder)
    select id,auth.uid(),'deleted','purged' from deleted;
  get diagnostics removed = row_count;
  if removed <> requested then
    raise exception 'A seleção mudou. Atualize a conversa.' using errcode = '40001';
  end if;
  return removed;
end;
$$;

create function lkz_adm_private.is_master() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt()->>'aal' = 'aal2', false)
    and exists (select 1 from public.profiles where id=auth.uid() and active and role='master');
$$;

create function lkz_adm_private.list_users()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not lkz_adm_private.is_master() then
    raise exception 'Acesso exclusivo do MASTER com MFA.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(u) order by u.full_name nulls last,u.id)
    from (select id,full_name,role,active,updated_at from public.profiles) u
  ), '[]'::jsonb);
end;
$$;

create function lkz_adm_private.manage_user(p_id uuid, p_version timestamptz, p_action text, p_name text, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  item public.profiles%rowtype;
begin
  if not lkz_adm_private.is_master() then
    raise exception 'Acesso exclusivo do MASTER com MFA.' using errcode = '42501';
  end if;
  select * into item from public.profiles where id=p_id for update;
  if not found or item.updated_at is distinct from p_version then
    raise exception 'O cadastro mudou. Atualize a lista.' using errcode = '40001';
  end if;
  if item.role='master' then
    raise exception 'Contas MASTER são protegidas.' using errcode = '42501';
  end if;
  if p_action='edit' then
    p_name := nullif(btrim(p_name),'');
    if length(p_name)>120 or p_name~'[[:cntrl:]]' or p_role is null or p_role not in ('admin','commercial','viewer') then
      raise exception 'Confira o nome e o grupo de acesso.' using errcode = '22023';
    end if;
    update public.profiles set full_name=p_name,role=p_role,updated_at=now() where id=p_id;
  elsif p_action in ('activate','deactivate') then
    update public.profiles set active=(p_action='activate'),updated_at=now() where id=p_id;
  elsif p_action='remove' then
    delete from public.profiles where id=p_id;
  else
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;
  insert into lkz_adm_private.operator_audit (actor_id,target_id,action,details)
    values (auth.uid(),p_id,'user.'||p_action,
      jsonb_build_object('previous_role',item.role,'previous_active',item.active,'new_role',case when p_action='edit' then p_role end));
end;
$$;

create function public.lkz_adm_decide_approval(p_id uuid, p_status text)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  item public.approvals%rowtype;
  event_name text;
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Acesso administrativo com MFA obrigatório.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('approved','rejected') then
    raise exception 'Decisão inválida.' using errcode = '22023';
  end if;
  update public.approvals set status=p_status,decided_by=auth.uid(),decided_at=now()
    where id=p_id and status='pending' and action_type in ('contact','proposal') and lead_id is not null
    returning * into item;
  if not found then
    raise exception 'A decisão já foi registrada ou não está disponível.' using errcode = '40001';
  end if;
  if p_status='approved' then
    event_name := case when item.action_type='proposal' then 'proposal.approved' else 'approval.contact.granted' end;
    update public.leads set
      status=case when item.action_type='proposal' then 'proposal' else 'qualified' end,
      proposal_at=case when item.action_type='proposal' then now() else proposal_at end,
      needs_human_review=false,updated_at=now()
      where id=item.lead_id and
      (status in ('new','diagnosing','human_review','qualified')
       or (item.action_type='proposal' and status in ('contacted','proposal')));
    if not found then
      raise exception 'A oportunidade mudou. Atualize a lista.' using errcode = '40001';
    end if;
  else
    event_name := case when item.action_type='proposal' then 'proposal.rejected' else 'approval.contact.rejected' end;
  end if;
  insert into public.lead_events (lead_id,event_type,actor_type,actor_id,note)
    values (item.lead_id,event_name,'admin',auth.uid(),'Decisão registrada pelo LKZ ADM.');
end;
$$;

create function public.lkz_adm_register_client(p_id uuid, p_company text, p_name text, p_email text, p_phone text)
returns jsonb language sql security invoker set search_path = '' as $$
  select lkz_adm_private.register_client(p_id,p_company,p_name,p_email,p_phone);
$$;
create function public.lkz_adm_purge_messages(p_conversation uuid, p_ids bigint[])
returns integer language sql security invoker set search_path = '' as $$
  select lkz_adm_private.purge_messages(p_conversation,p_ids);
$$;
create function public.lkz_adm_list_users()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select lkz_adm_private.list_users();
$$;
create function public.lkz_adm_manage_user(p_id uuid, p_version timestamptz, p_action text, p_name text, p_role text)
returns void language sql security invoker set search_path = '' as $$
  select lkz_adm_private.manage_user(p_id,p_version,p_action,p_name,p_role);
$$;

revoke all on function lkz_adm_private.is_master(),
  lkz_adm_private.register_client(uuid,text,text,text,text), lkz_adm_private.purge_messages(uuid,bigint[]),
  lkz_adm_private.list_users(), lkz_adm_private.manage_user(uuid,timestamptz,text,text,text),
  public.lkz_adm_register_client(uuid,text,text,text,text), public.lkz_adm_purge_messages(uuid,bigint[]),
  public.lkz_adm_list_users(), public.lkz_adm_manage_user(uuid,timestamptz,text,text,text),
  public.lkz_adm_decide_approval(uuid,text) from public, anon, authenticated;
grant execute on function lkz_adm_private.register_client(uuid,text,text,text,text), lkz_adm_private.purge_messages(uuid,bigint[]),
  lkz_adm_private.list_users(), lkz_adm_private.manage_user(uuid,timestamptz,text,text,text),
  public.lkz_adm_register_client(uuid,text,text,text,text), public.lkz_adm_purge_messages(uuid,bigint[]),
  public.lkz_adm_list_users(), public.lkz_adm_manage_user(uuid,timestamptz,text,text,text),
  public.lkz_adm_decide_approval(uuid,text) to authenticated;
