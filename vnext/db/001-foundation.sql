begin;

create schema lkz_vnext;
revoke all on schema lkz_vnext from public, anon, authenticated;
grant usage on schema lkz_vnext to authenticated;

create table lkz_vnext.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160)
);

create table lkz_vnext.memberships (
  tenant_id uuid references lkz_vnext.tenants not null,
  user_id uuid references auth.users not null,
  role text not null check (role in ('admin', 'operator', 'viewer')),
  active boolean not null default true,
  primary key (tenant_id, user_id)
);

create table lkz_vnext.clients (
  tenant_id uuid references lkz_vnext.tenants not null,
  id uuid default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  email text not null check (
    email = lower(btrim(email)) and length(email) <= 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  archived_at timestamptz,
  primary key (tenant_id, id),
  unique (tenant_id, email)
);

create table lkz_vnext.leads (
  tenant_id uuid references lkz_vnext.tenants not null,
  id uuid default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  email text not null check (
    email = lower(btrim(email)) and length(email) <= 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  client_id uuid,
  primary key (tenant_id, id),
  foreign key (tenant_id, client_id) references lkz_vnext.clients (tenant_id, id)
);

create table lkz_vnext.audit (
  id bigint generated always as identity primary key,
  tenant_id uuid references lkz_vnext.tenants not null,
  actor_id uuid not null,
  entity text not null,
  record_id uuid not null,
  operation text not null,
  occurred_at timestamptz not null default now()
);

alter table lkz_vnext.tenants enable row level security;
alter table lkz_vnext.memberships enable row level security;
alter table lkz_vnext.clients enable row level security;
alter table lkz_vnext.leads enable row level security;
alter table lkz_vnext.audit enable row level security;
revoke all on all tables in schema lkz_vnext from public, anon, authenticated;
grant select on all tables in schema lkz_vnext to authenticated;
grant insert (tenant_id, name, email), update (name, archived_at) on lkz_vnext.clients to authenticated;
grant insert (tenant_id, name, email), update (client_id) on lkz_vnext.leads to authenticated;

create policy own_active_membership on lkz_vnext.memberships for select to authenticated
using (active and user_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');

-- Runs as the caller. RLS on memberships resolves only their active MFA-backed grants.
create function lkz_vnext.has_access(target uuid, allowed_roles text[])
returns boolean language sql stable security invoker set search_path = ''
as $$
  select exists (
    select from lkz_vnext.memberships
    where tenant_id = target and role = any(allowed_roles)
  )
$$;

create policy tenant_read on lkz_vnext.tenants for select to authenticated
using (lkz_vnext.has_access(id, array['admin', 'operator', 'viewer']));
create policy client_read on lkz_vnext.clients for select to authenticated
using (lkz_vnext.has_access(tenant_id, array['admin', 'operator', 'viewer']));
create policy client_insert on lkz_vnext.clients for insert to authenticated
with check (lkz_vnext.has_access(tenant_id, array['admin', 'operator']));
create policy client_update on lkz_vnext.clients for update to authenticated
using (lkz_vnext.has_access(tenant_id, array['admin', 'operator']))
with check (lkz_vnext.has_access(tenant_id, array['admin', 'operator']));
create policy lead_read on lkz_vnext.leads for select to authenticated
using (lkz_vnext.has_access(tenant_id, array['admin', 'operator', 'viewer']));
create policy lead_insert on lkz_vnext.leads for insert to authenticated
with check (lkz_vnext.has_access(tenant_id, array['admin', 'operator']));
create policy lead_convert on lkz_vnext.leads for update to authenticated
using (client_id is null and lkz_vnext.has_access(tenant_id, array['admin', 'operator']))
with check (
  lkz_vnext.has_access(tenant_id, array['admin', 'operator'])
  and exists (
    select from lkz_vnext.clients c
    where c.tenant_id = leads.tenant_id and c.id = leads.client_id
      and c.email = leads.email and c.archived_at is null
  )
);
create policy audit_read on lkz_vnext.audit for select to authenticated
using (lkz_vnext.has_access(tenant_id, array['admin']));

create function lkz_vnext.audit_crm_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'An identified CRM actor is required' using errcode = '42501';
  end if;
  insert into lkz_vnext.audit (tenant_id, actor_id, entity, record_id, operation)
  values (new.tenant_id, auth.uid(), tg_table_name, new.id, tg_op);
  return new;
end;
$$;

create trigger client_audit after insert or update on lkz_vnext.clients
for each row execute function lkz_vnext.audit_crm_change();
create trigger lead_audit after insert or update on lkz_vnext.leads
for each row execute function lkz_vnext.audit_crm_change();

create function lkz_vnext.convert_lead(target_tenant uuid, target_lead uuid)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare
  source lkz_vnext.leads%rowtype;
  converted_id uuid;
begin
  if not lkz_vnext.has_access(target_tenant, array['admin', 'operator']) then
    raise exception 'CRM access denied' using errcode = '42501';
  end if;

  -- Lock unconverted leads. A retry after conversion returns the existing link.
  select * into source from lkz_vnext.leads
  where tenant_id = target_tenant and id = target_lead and client_id is null for update;
  if not found then
    select client_id into converted_id from lkz_vnext.leads
    where tenant_id = target_tenant and id = target_lead;
    if converted_id is null then
      raise exception 'Lead unavailable' using errcode = 'P0002';
    end if;
    return converted_id;
  end if;

  insert into lkz_vnext.clients (tenant_id, name, email)
  values (target_tenant, source.name, source.email)
  on conflict (tenant_id, email) do nothing;

  select id into converted_id from lkz_vnext.clients
  where tenant_id = target_tenant and email = source.email and archived_at is null
  for share;
  if converted_id is null then
    raise exception 'Matching client is archived' using errcode = '23514';
  end if;

  update lkz_vnext.leads set client_id = converted_id
  where tenant_id = target_tenant and id = target_lead;
  if not found then
    raise exception 'Lead changed during conversion' using errcode = '40001';
  end if;
  return converted_id;
end;
$$;

revoke all on all functions in schema lkz_vnext from public, anon, authenticated;
grant execute on function lkz_vnext.has_access(uuid, text[]),
  lkz_vnext.convert_lead(uuid, uuid) to authenticated;

commit;
