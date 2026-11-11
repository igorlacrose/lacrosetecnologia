begin;

alter table lkz_vnext.leads add column oca_reference uuid;
alter table lkz_vnext.leads add unique (tenant_id, oca_reference);
grant insert (oca_reference) on lkz_vnext.leads to authenticated;

create table lkz_vnext.opportunities (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  lead_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 160),
  stage text not null default 'qualification'
    check (stage in ('qualification','proposal','negotiation','won','lost')),
  primary key (tenant_id,id),
  foreign key (tenant_id,lead_id) references lkz_vnext.leads (tenant_id,id)
);

create table lkz_vnext.interactions (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  lead_id uuid not null,
  channel text not null check (channel in ('oca','email','phone','internal')),
  note text not null check (length(btrim(note)) between 1 and 2000),
  created_at timestamptz not null default now(),
  primary key (tenant_id,id),
  foreign key (tenant_id,lead_id) references lkz_vnext.leads (tenant_id,id)
);

create table lkz_vnext.subscription_drafts (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  client_id uuid not null,
  plan_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id,id),
  unique (tenant_id,client_id,plan_id),
  foreign key (tenant_id,client_id) references lkz_vnext.clients (tenant_id,id),
  foreign key (tenant_id,plan_id) references lkz_vnext.plans (tenant_id,id)
);

do $$
declare
  resource text;
  writers text[];
begin
  foreach resource in array array['opportunities','interactions','subscription_drafts'] loop
    writers := case when resource = 'subscription_drafts'
      then array['admin'] else array['admin','operator'] end;
    execute format('alter table lkz_vnext.%I enable row level security', resource);
    execute format('revoke all on lkz_vnext.%I from public, anon, authenticated', resource);
    execute format('grant select on lkz_vnext.%I to authenticated', resource);
    execute format(
      'create policy tenant_read on lkz_vnext.%I for select to authenticated
       using (lkz_vnext.has_access(tenant_id, array[''admin'',''operator'',''viewer'']))', resource);
    execute format(
      'create policy tenant_insert on lkz_vnext.%I for insert to authenticated
       with check (lkz_vnext.has_access(tenant_id, %L::text[]))', resource, writers);
    execute format(
      'create trigger record_change after insert or update on lkz_vnext.%I
       for each row execute function lkz_vnext.audit_crm_change()', resource);
  end loop;
end;
$$;

grant insert (tenant_id, lead_id, title) on lkz_vnext.opportunities to authenticated;
grant update (stage) on lkz_vnext.opportunities to authenticated;
grant insert (tenant_id, lead_id, channel, note) on lkz_vnext.interactions to authenticated;
grant insert (tenant_id, client_id, plan_id) on lkz_vnext.subscription_drafts to authenticated;

create policy change_stage on lkz_vnext.opportunities for update to authenticated
using (lkz_vnext.has_access(tenant_id, array['admin','operator']))
with check (lkz_vnext.has_access(tenant_id, array['admin','operator']));

commit;
