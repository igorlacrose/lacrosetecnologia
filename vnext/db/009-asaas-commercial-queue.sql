begin;

alter table lkz_vnext_billing.asaas_sandbox_events
  add column commercial_attempts integer not null default 0,
  add column commercial_next_attempt_at timestamptz not null default now(),
  add column commercial_finished_at timestamptz,
  add column commercial_result text check (commercial_result in ('applied','needs_review','retry'));

create index commercial_pending_events on lkz_vnext_billing.asaas_sandbox_events (commercial_next_attempt_at,event_id)
where commercial_finished_at is null;

grant update (commercial_attempts,commercial_next_attempt_at,commercial_finished_at,commercial_result)
  on lkz_vnext_billing.asaas_sandbox_events to lkz_vnext_asaas_reconcile;

grant usage on schema lkz_vnext_billing to authenticated;
grant select (tenant_id,subscription_id,state) on lkz_vnext_billing.payment_bindings to authenticated;
create index payment_bindings_draft on lkz_vnext_billing.payment_bindings (tenant_id,subscription_id);
create policy sandbox_admin_state on lkz_vnext_billing.payment_bindings for select to authenticated
using (lkz_vnext.has_access(tenant_id, array['admin']));

commit;
