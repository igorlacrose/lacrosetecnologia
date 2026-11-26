begin;

-- Signed appointment events from BarbarOS/LibertyOS, stored per tenant.
-- NO Meta API request or dispatch is authorized by this migration.
do $block$
begin
  if not exists (select 1 from pg_roles where rolname='lkz_vnext_reminder_bridge') then
    create role lkz_vnext_reminder_bridge nologin noinherit;
  end if;
end $block$;
grant usage on schema lkz_vnext to lkz_vnext_reminder_bridge;

-- HMAC-sha256 of the normalized E.164 number with a backend-only pepper.
-- Never store plaintext phone numbers, patient names or clinical details.
create table lkz_vnext.whatsapp_opt_outs (
  tenant_id uuid not null references lkz_vnext.tenants(id),
  recipient_hash text not null check (recipient_hash ~ '^[a-f0-9]{64}$'),
  source text not null check (source in ('booking_platform','whatsapp_reply','staff_recorded')),
  created_at timestamptz not null default now(),
  primary key (tenant_id,recipient_hash)
);

create table lkz_vnext.whatsapp_appointments (
  tenant_id uuid not null references lkz_vnext.tenants(id),
  product text not null check (product in ('barbaros','libertyos')),
  appointment_key text not null check (appointment_key ~ '^[A-Za-z0-9_-]{1,80}$'),
  revision integer not null check (revision between 1 and 2147483647),
  starts_at timestamptz,
  timezone text check (length(timezone) between 3 and 64),
  state text not null check (state in ('scheduled','cancelled')),
  consent_given boolean not null default false,
  consent_at timestamptz,
  consent_source text check (consent_source in ('online_booking','staff_recorded')),
  recipient_hash text check (recipient_hash ~ '^[a-f0-9]{64}$'),
  recipient_ciphertext bytea,
  recipient_nonce bytea check (recipient_nonce is null or length(recipient_nonce)=12),
  last_event_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id,product,appointment_key),
  check (state='cancelled' or (starts_at is not null and timezone is not null)),
  check (
    (consent_given and consent_at is not null and consent_source is not null
      and recipient_hash is not null and recipient_ciphertext is not null
      and recipient_nonce is not null)
    or (not consent_given and recipient_ciphertext is null and recipient_nonce is null)
  )
);

create table lkz_vnext.whatsapp_appointment_events (
  tenant_id uuid not null references lkz_vnext.tenants(id),
  product text not null check (product in ('barbaros','libertyos')),
  event_id uuid not null,
  event_digest text not null check (event_digest ~ '^[a-f0-9]{64}$'),
  event_type text not null check (event_type in ('booked','rescheduled','cancelled','opted_out')),
  received_at timestamptz not null default now(),
  primary key (tenant_id,product,event_id)
);

create table lkz_vnext.whatsapp_reminder_jobs (
  tenant_id uuid not null,
  product text not null,
  appointment_key text not null,
  appointment_revision integer not null check (appointment_revision>0),
  kind text not null check (kind in ('confirmation','reminder_24h','reminder_2h')),
  scheduled_for timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending','cancelled','expired','simulated','sent','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,product,appointment_key,appointment_revision,kind),
  foreign key (tenant_id,product,appointment_key)
    references lkz_vnext.whatsapp_appointments(tenant_id,product,appointment_key)
);
create index whatsapp_jobs_pending_due on lkz_vnext.whatsapp_reminder_jobs
  (scheduled_for,tenant_id) where status='pending';
create index whatsapp_appointments_recipient on lkz_vnext.whatsapp_appointments
  (tenant_id,recipient_hash) where recipient_hash is not null;

do $block$
declare tbl text;
begin
  foreach tbl in array array[
    'whatsapp_opt_outs','whatsapp_appointments','whatsapp_appointment_events',
    'whatsapp_reminder_jobs'
  ] loop
    execute format('alter table lkz_vnext.%I enable row level security',tbl);
    execute format('revoke all on lkz_vnext.%I from public,anon,authenticated',tbl);
    execute format(
      'create policy reminder_bridge_only on lkz_vnext.%I for all to lkz_vnext_reminder_bridge using(true) with check(true)',tbl);
    execute format(
      'grant select,insert,update on lkz_vnext.%I to lkz_vnext_reminder_bridge',tbl);
  end loop;
end $block$;

-- No direct access to WABA secrets or the Meta credit line.
grant select (tenant_id,connection_state,billing_owner,billing_state)
  on lkz_vnext.whatsapp_connections to lkz_vnext_reminder_bridge;
create policy reminder_bridge_connection_read on lkz_vnext.whatsapp_connections
  for select to lkz_vnext_reminder_bridge using(true);
grant select (tenant_id,enabled,offsets_minutes,monthly_message_limit)
  on lkz_vnext.whatsapp_reminder_policies to lkz_vnext_reminder_bridge;
create policy reminder_bridge_policy_read on lkz_vnext.whatsapp_reminder_policies
  for select to lkz_vnext_reminder_bridge using(true);

-- Aggregated administrative metrics. Explicit session + MFA + membership
-- check is mandatory because SECURITY DEFINER does not rely on caller RLS.
create function lkz_vnext.whatsapp_reminder_summary(p_tenant uuid)
returns table(appointments bigint,pending bigint,cancelled bigint)
language plpgsql security definer set search_path to ''
as $body$
begin
  if auth.uid() is null or (auth.jwt()->>'aal') is distinct from 'aal2'
     or not exists (
       select 1 from lkz_vnext.memberships
       where tenant_id=p_tenant and user_id=auth.uid()
         and active=true and role in ('admin','operator','viewer')
     ) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  return query
  select
    (select count(*) from lkz_vnext.whatsapp_appointments a
      where a.tenant_id=p_tenant and a.state='scheduled'),
    (select count(*) from lkz_vnext.whatsapp_reminder_jobs j
      where j.tenant_id=p_tenant and j.status='pending'),
    (select count(*) from lkz_vnext.whatsapp_reminder_jobs j
      where j.tenant_id=p_tenant and j.status='cancelled');
end;
$body$;
revoke all on function lkz_vnext.whatsapp_reminder_summary(uuid)
  from public,anon,authenticated;
grant execute on function lkz_vnext.whatsapp_reminder_summary(uuid)
  to authenticated;

commit;
