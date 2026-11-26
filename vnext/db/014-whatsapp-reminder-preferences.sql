begin;

-- Tenants can preconfigure reminders without gaining permission to dispatch.
-- Enabling billable messages requires a separately reviewed server-side gate.
create function lkz_vnext.save_reminder_preferences(
  target_tenant uuid, requested_offsets integer[], requested_monthly_cap integer)
returns table(enabled boolean,offsets_minutes integer[],monthly_message_limit integer)
language plpgsql security definer set search_path=''
as $body$
declare actor uuid := auth.uid();
begin
  if actor is null or (auth.jwt()->>'aal') is distinct from 'aal2'
    or not exists(
      select 1 from lkz_vnext.memberships
      where tenant_id=target_tenant and user_id=actor and active=true and role='admin'
    ) then
    raise exception 'Administrator MFA required' using errcode='42501';
  end if;
  if requested_offsets is null or (
      requested_offsets <> array[1440,120] and requested_offsets <> array[120,1440]
      and requested_offsets <> array[1440] and requested_offsets <> array[120]
    ) or requested_monthly_cap is null or requested_monthly_cap < 0
      or requested_monthly_cap > 10000 then
    raise exception 'Invalid reminder preferences' using errcode='22023';
  end if;

  insert into lkz_vnext.whatsapp_reminder_policies(
    tenant_id,enabled,offsets_minutes,monthly_message_limit,updated_at
  ) values(target_tenant,false,requested_offsets,requested_monthly_cap,now())
  on conflict(tenant_id) do update set
    enabled=false,offsets_minutes=excluded.offsets_minutes,
    monthly_message_limit=excluded.monthly_message_limit,updated_at=now();

  insert into lkz_vnext.audit(tenant_id,actor_id,entity,record_id,operation)
  values(target_tenant,actor,'whatsapp_reminder_policies',target_tenant,'PREFERENCES_UPDATED');

  return query
    select p.enabled,p.offsets_minutes,p.monthly_message_limit
    from lkz_vnext.whatsapp_reminder_policies p where p.tenant_id=target_tenant;
end;
$body$;

revoke all on function lkz_vnext.save_reminder_preferences(uuid,integer[],integer)
from public,anon,authenticated;
grant execute on function lkz_vnext.save_reminder_preferences(uuid,integer[],integer)
to authenticated;

commit;
