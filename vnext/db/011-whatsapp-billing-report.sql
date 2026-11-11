begin;

-- An admin may REPORT that their Meta payment method was configured.
-- Reporting is NOT verification and never unlocks paid messaging.
create function lkz_vnext.report_whatsapp_billing(target_tenant uuid,target_connection uuid)
returns text language plpgsql security definer set search_path=''
as $body$
declare v_actor uuid := auth.uid(); v_state text;
begin
  -- SECURITY DEFINER bypasses RLS: check actor membership explicitly.
  if v_actor is null
     or not exists (
       select 1 from lkz_vnext.memberships
       where tenant_id=target_tenant and user_id=v_actor and active=true and role='admin'
     )
     or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'Administrator with MFA is required' using errcode='42501';
  end if;
  update lkz_vnext.whatsapp_connections
     set billing_state='customer_reported',updated_at=now()
    where tenant_id=target_tenant and id=target_connection
      and connection_state='awaiting_billing' and billing_state='unverified'
    returning billing_state into v_state;
  if v_state is null then
    raise exception 'Connection unavailable or already reported' using errcode='P0002';
  end if;
  insert into lkz_vnext.audit(tenant_id,actor_id,entity,record_id,operation)
    values(target_tenant,v_actor,'whatsapp_connections',target_connection,'BILLING_REPORTED');
  return v_state;
end;
$body$;

revoke all on function lkz_vnext.report_whatsapp_billing(uuid,uuid)
from public,anon,authenticated;
grant execute on function lkz_vnext.report_whatsapp_billing(uuid,uuid) to authenticated;

-- Only a dedicated Meta backend role can audit a server-validated connection.
grant insert (tenant_id,actor_id,entity,record_id,operation)
  on lkz_vnext.audit to lkz_vnext_meta_bridge;
create policy whatsapp_bridge_audit on lkz_vnext.audit for insert to lkz_vnext_meta_bridge
  with check (entity='whatsapp_connections' and operation in ('META_CONNECTED','META_RECONNECTED'));

commit;
