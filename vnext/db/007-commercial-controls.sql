begin;

create table lkz_vnext.license_requests (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  subscription_id uuid not null,
  requested_at timestamptz not null default now(),
  state text not null default 'blocked' check (state = 'blocked'),
  primary key (tenant_id,id),
  unique (tenant_id,subscription_id),
  foreign key (tenant_id,subscription_id) references lkz_vnext.subscription_drafts (tenant_id,id)
);

alter table lkz_vnext.license_requests enable row level security;
revoke all on lkz_vnext.license_requests from public, anon, authenticated;
grant select, insert (tenant_id,subscription_id) on lkz_vnext.license_requests to authenticated;
create policy read_license_request on lkz_vnext.license_requests for select to authenticated
using (lkz_vnext.has_access(tenant_id, array['admin','operator','viewer']));
create policy request_license on lkz_vnext.license_requests for insert to authenticated
with check (lkz_vnext.has_access(tenant_id, array['admin']));
create trigger license_requested after insert on lkz_vnext.license_requests
for each row execute function lkz_vnext.audit_crm_change();

create table lkz_vnext_billing.payment_bindings (
  payment_id text primary key check (payment_id ~ '^pay_[A-Za-z0-9_-]{1,120}$'),
  tenant_id uuid not null,
  subscription_id uuid not null,
  customer_id text not null check (customer_id ~ '^cus_[A-Za-z0-9_-]{1,120}$'),
  external_reference uuid not null unique,
  expected_brl_cents integer not null check (expected_brl_cents > 0),
  state text not null default 'pending' check (state in ('pending','paid','overdue','reversed','disputed')),
  foreign key (tenant_id,subscription_id) references lkz_vnext.subscription_drafts (tenant_id,id)
);

create table lkz_vnext_billing.payment_state_events (
  event_id text primary key references lkz_vnext_billing.asaas_sandbox_events,
  payment_id text not null references lkz_vnext_billing.payment_bindings,
  state text not null check (state in ('pending','paid','overdue','reversed','disputed')),
  observed_at timestamptz not null default now()
);

alter table lkz_vnext_billing.payment_bindings enable row level security;
alter table lkz_vnext_billing.payment_state_events enable row level security;
revoke all on lkz_vnext_billing.payment_bindings, lkz_vnext_billing.payment_state_events from public, anon, authenticated;
grant select, update (state) on lkz_vnext_billing.payment_bindings to lkz_vnext_asaas_reconcile;
grant select, insert on lkz_vnext_billing.payment_state_events to lkz_vnext_asaas_reconcile;

create policy binding_lookup on lkz_vnext_billing.payment_bindings for select to lkz_vnext_asaas_reconcile using (true);
create policy binding_state on lkz_vnext_billing.payment_bindings for update to lkz_vnext_asaas_reconcile using (true) with check (true);
create policy state_history_lookup on lkz_vnext_billing.payment_state_events for select to lkz_vnext_asaas_reconcile using (true);
create policy state_history_append on lkz_vnext_billing.payment_state_events for insert to lkz_vnext_asaas_reconcile with check (true);

commit;
