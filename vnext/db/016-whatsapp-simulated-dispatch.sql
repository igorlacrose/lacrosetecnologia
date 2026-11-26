begin;

-- This migration is strictly a synthetic "would dispatch" simulator.
-- No Meta credentials, outbound network calls, payments or actual messages.
-- The usage counter is NOT financial billing and cannot enable delivery.
create table lkz_vnext.whatsapp_simulated_monthly_usage (
  tenant_id uuid not null references lkz_vnext.tenants(id),
  utc_month date not null check (extract(day from utc_month)=1),
  simulated_count integer not null default 0
    check (simulated_count between 0 and 10000),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,utc_month)
);

create table lkz_vnext.whatsapp_simulated_dispatches (
  tenant_id uuid not null,
  product text not null,
  appointment_key text not null,
  appointment_revision integer not null,
  kind text not null,
  utc_month date not null,
  simulated_at timestamptz not null default now(),
  primary key (tenant_id,product,appointment_key,appointment_revision,kind),
  foreign key (tenant_id,product,appointment_key,appointment_revision,kind)
    references lkz_vnext.whatsapp_reminder_jobs
    (tenant_id,product,appointment_key,appointment_revision,kind),
  foreign key (tenant_id,utc_month)
    references lkz_vnext.whatsapp_simulated_monthly_usage(tenant_id,utc_month)
);
create index whatsapp_simulated_by_tenant_month
  on lkz_vnext.whatsapp_simulated_dispatches (tenant_id,utc_month);

alter table lkz_vnext.whatsapp_simulated_monthly_usage enable row level security;
alter table lkz_vnext.whatsapp_simulated_dispatches enable row level security;
revoke all on lkz_vnext.whatsapp_simulated_monthly_usage,
  lkz_vnext.whatsapp_simulated_dispatches from public,anon,authenticated;

create policy simulated_usage_bridge on lkz_vnext.whatsapp_simulated_monthly_usage
  for all to lkz_vnext_reminder_bridge using (true) with check (true);
create policy simulated_dispatch_bridge on lkz_vnext.whatsapp_simulated_dispatches
  for all to lkz_vnext_reminder_bridge using (true) with check (true);
grant select,insert,update on lkz_vnext.whatsapp_simulated_monthly_usage
  to lkz_vnext_reminder_bridge;
grant select,insert on lkz_vnext.whatsapp_simulated_dispatches
  to lkz_vnext_reminder_bridge;

-- Aggregate only. SECURITY DEFINER never assumes caller RLS.
create function lkz_vnext.whatsapp_simulation_summary(p_tenant uuid)
returns table(simulated_jobs bigint,simulated_this_month bigint)
language plpgsql security definer set search_path to ''
as $body$
begin
  if auth.uid() is null
    or (auth.jwt()->>'aal') is distinct from 'aal2'
    or not exists (
      select 1 from lkz_vnext.memberships
      where tenant_id=p_tenant and user_id=auth.uid()
        and active=true and role in ('admin','operator','viewer')
    ) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  return query
    select
      (select count(*) from lkz_vnext.whatsapp_simulated_dispatches d
        where d.tenant_id=p_tenant),
      (select coalesce(sum(u.simulated_count),0)::bigint
        from lkz_vnext.whatsapp_simulated_monthly_usage u
        where u.tenant_id=p_tenant
          and u.utc_month=date_trunc('month',now() at time zone 'UTC')::date);
end;
$body$;
revoke all on function lkz_vnext.whatsapp_simulation_summary(uuid)
  from public,anon,authenticated;
grant execute on function lkz_vnext.whatsapp_simulation_summary(uuid)
  to authenticated;

commit;
