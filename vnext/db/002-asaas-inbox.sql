begin;
create schema lkz_vnext_billing;
revoke all on schema lkz_vnext_billing from public, anon, authenticated;

create table lkz_vnext_billing.asaas_sandbox_events (
  event_id text primary key check (event_id ~ '^evt_[A-Za-z0-9_&-]{1,150}$'),
  event_type text not null check (event_type ~ '^PAYMENT_[A-Z_]{1,70}$'),
  payment_id text not null check (payment_id ~ '^pay_[A-Za-z0-9_-]{1,120}$'),
  received_at timestamptz not null default now()
);
alter table lkz_vnext_billing.asaas_sandbox_events enable row level security;
revoke all on all tables in schema lkz_vnext_billing from public, anon, authenticated;

-- Provision this dedicated login separately and grant it only the ingest role.
create role lkz_vnext_asaas_ingest nologin;
grant usage on schema lkz_vnext_billing to lkz_vnext_asaas_ingest;
grant insert on lkz_vnext_billing.asaas_sandbox_events to lkz_vnext_asaas_ingest;
create policy accept_event on lkz_vnext_billing.asaas_sandbox_events
for insert to lkz_vnext_asaas_ingest with check (true);
commit;
