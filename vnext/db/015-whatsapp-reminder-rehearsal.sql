begin;

-- An isolated, non-sending rehearsal of reminder eligibility.
-- No Meta request, billing event or template submission is possible here.
create table lkz_vnext.whatsapp_reminder_rehearsals (
  tenant_id uuid not null,
  product text not null,
  appointment_key text not null,
  appointment_revision integer not null,
  kind text not null,
  decision text not null check (decision in (
    'blocked_policy','blocked_billing','blocked_opt_out',
    'blocked_consent','blocked_appointment','expired','dry_run_eligible'
  )),
  first_checked_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  check_count integer not null default 1 check (check_count between 1 and 2147483647),
  primary key (tenant_id,product,appointment_key,appointment_revision,kind),
  foreign key (tenant_id,product,appointment_key,appointment_revision,kind)
    references lkz_vnext.whatsapp_reminder_jobs
    (tenant_id,product,appointment_key,appointment_revision,kind)
);

alter table lkz_vnext.whatsapp_reminder_rehearsals enable row level security;
revoke all on lkz_vnext.whatsapp_reminder_rehearsals from public,anon,authenticated;
create policy reminder_rehearsal_bridge on lkz_vnext.whatsapp_reminder_rehearsals
  for all to lkz_vnext_reminder_bridge using (true) with check (true);
grant select,insert,update on lkz_vnext.whatsapp_reminder_rehearsals
  to lkz_vnext_reminder_bridge;

-- Admins/viewers get only aggregate, no appointment IDs, recipients or body.
-- Explicit MFA/active membership check even under SECURITY DEFINER.
create function lkz_vnext.whatsapp_reminder_rehearsal_summary(p_tenant uuid)
returns table(
  checks bigint,ready_simulated bigint,blocked bigint,expired bigint
)
language plpgsql security definer set search_path to ''
as $body$
begin
  if auth.uid() is null or (auth.jwt()->>'aal') is distinct from 'aal2'
    or not exists (
      select 1 from lkz_vnext.memberships
      where tenant_id=p_tenant and user_id=auth.uid() and active=true
        and role in ('admin','operator','viewer')
    ) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  return query
    select
      count(*),
      count(*) filter (where decision='dry_run_eligible'),
      count(*) filter (where decision like 'blocked_%'),
      count(*) filter (where decision='expired')
    from lkz_vnext.whatsapp_reminder_rehearsals
    where tenant_id=p_tenant;
end;
$body$;
revoke all on function lkz_vnext.whatsapp_reminder_rehearsal_summary(uuid)
  from public,anon,authenticated;
grant execute on function lkz_vnext.whatsapp_reminder_rehearsal_summary(uuid)
  to authenticated;

commit;
