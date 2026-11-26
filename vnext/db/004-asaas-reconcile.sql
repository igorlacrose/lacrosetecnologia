begin;

alter table lkz_vnext_billing.asaas_sandbox_events
  add column attempts integer not null default 0,
  add column next_attempt_at timestamptz not null default now(),
  add column lease_token uuid,
  add column lease_until timestamptz,
  add column processed_at timestamptz,
  add column failed_at timestamptz,
  add column observed_status text;

create index asaas_events_pending
on lkz_vnext_billing.asaas_sandbox_events (next_attempt_at, event_id)
where processed_at is null and failed_at is null;

create role lkz_vnext_asaas_reconcile nologin;
grant usage on schema lkz_vnext_billing to lkz_vnext_asaas_reconcile;
grant select, update on lkz_vnext_billing.asaas_sandbox_events to lkz_vnext_asaas_reconcile;
create policy reconcile_read on lkz_vnext_billing.asaas_sandbox_events
for select to lkz_vnext_asaas_reconcile using (true);
create policy reconcile_update on lkz_vnext_billing.asaas_sandbox_events
for update to lkz_vnext_asaas_reconcile using (true) with check (true);

-- Prevent ingestion from supplying queue-control fields.
revoke insert on lkz_vnext_billing.asaas_sandbox_events from lkz_vnext_asaas_ingest;
grant insert (event_id, event_type, payment_id) on lkz_vnext_billing.asaas_sandbox_events to lkz_vnext_asaas_ingest;
revoke update on lkz_vnext_billing.asaas_sandbox_events from lkz_vnext_asaas_reconcile;
grant update (attempts, next_attempt_at, lease_token, lease_until, processed_at, failed_at, observed_status)
on lkz_vnext_billing.asaas_sandbox_events to lkz_vnext_asaas_reconcile;

commit;
