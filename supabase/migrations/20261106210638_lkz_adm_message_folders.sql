-- O histórico original e o fluxo do agente permanecem intactos.
create schema lkz_adm_private;
revoke all on schema lkz_adm_private from public, anon, authenticated;
grant usage on schema lkz_adm_private to authenticated;

create function lkz_adm_private.is_operator() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal' = 'aal2', false)
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and active and role in ('master', 'admin')
    );
$$;
revoke all on function lkz_adm_private.is_operator() from public, anon;
grant execute on function lkz_adm_private.is_operator() to authenticated;

create table lkz_adm_private.message_folders (
  message_id bigint primary key references public.messages (id) on delete cascade,
  folder text not null check (folder in ('active', 'archived', 'deleted'))
);
alter table lkz_adm_private.message_folders enable row level security;
revoke all on lkz_adm_private.message_folders from public, anon, authenticated;
grant select, insert (message_id, folder), update (folder)
  on lkz_adm_private.message_folders to authenticated;
create policy operator_access on lkz_adm_private.message_folders
  to authenticated using ((select lkz_adm_private.is_operator()))
  with check ((select lkz_adm_private.is_operator()));

create table lkz_adm_private.message_folder_audit (
  id bigint generated always as identity primary key,
  message_id bigint not null,
  actor_id uuid not null,
  previous_folder text not null,
  next_folder text not null,
  changed_at timestamptz not null default now()
);
alter table lkz_adm_private.message_folder_audit enable row level security;
revoke all on lkz_adm_private.message_folder_audit from public, anon, authenticated;

create function lkz_adm_private.audit_folder() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into lkz_adm_private.message_folder_audit
    (message_id, actor_id, previous_folder, next_folder)
  values (new.message_id, auth.uid(), coalesce(old.folder, 'active'), new.folder);
  return new;
end;
$$;
revoke all on function lkz_adm_private.audit_folder() from public, anon, authenticated;
create trigger audit_folder after insert or update of folder on lkz_adm_private.message_folders
  for each row execute function lkz_adm_private.audit_folder();

create function public.lkz_adm_list_messages(p_conversation uuid, p_folder text, p_before bigint)
returns table (id text, role text, content text, created_at timestamptz)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Acesso administrativo com MFA obrigatório.' using errcode = '42501';
  end if;
  if p_conversation is null or p_folder is null or p_folder not in ('active', 'archived', 'deleted') then
    raise exception 'Pasta ou conversa inválida.' using errcode = '22023';
  end if;
  return query
    select m.id::text, m.role, m.content, m.created_at
    from public.messages m
    left join lkz_adm_private.message_folders f on f.message_id = m.id
    where m.conversation_id = p_conversation
      and (p_before is null or m.id < p_before)
      and coalesce(f.folder, 'active') = p_folder
    order by m.id desc limit 51;
end;
$$;

create function public.lkz_adm_move_messages(p_conversation uuid, p_ids bigint[], p_from text, p_to text)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  selected_count integer := cardinality(p_ids);
  changed_count integer;
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Acesso administrativo com MFA obrigatório.' using errcode = '42501';
  end if;
  if p_conversation is null or selected_count is null or selected_count not between 1 and 50
    or selected_count <> (select count(distinct value) from unnest(p_ids) as entry(value))
    or p_from is null or p_to is null or not (
      (p_from = 'active' and p_to in ('archived', 'deleted'))
      or (p_from = 'archived' and p_to in ('active', 'deleted'))
      or (p_from = 'deleted' and p_to = 'active')
    ) then
    raise exception 'Seleção ou destino inválido.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('lkz_adm_message:' || p_conversation::text, 0));
  insert into lkz_adm_private.message_folders (message_id, folder)
    select m.id, p_to
    from public.messages m
    left join lkz_adm_private.message_folders f on f.message_id = m.id
    where m.conversation_id = p_conversation and m.id = any(p_ids)
      and coalesce(f.folder, 'active') = p_from
    on conflict (message_id) do update set folder = excluded.folder
    where message_folders.folder = p_from;
  get diagnostics changed_count = row_count;
  if changed_count <> selected_count then
    raise exception 'A seleção mudou. Atualize a conversa.' using errcode = '40001';
  end if;
  return changed_count;
end;
$$;
revoke all on function public.lkz_adm_list_messages(uuid, text, bigint),
  public.lkz_adm_move_messages(uuid, bigint[], text, text) from public, anon, authenticated;
grant execute on function public.lkz_adm_list_messages(uuid, text, bigint),
  public.lkz_adm_move_messages(uuid, bigint[], text, text) to authenticated;
