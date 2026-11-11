begin;

-- The inbound reader must match WABA + phone, but still cannot read
-- encrypted business tokens or modify the connection.
grant select (meta_waba_id,meta_phone_number_id)
  on lkz_vnext.whatsapp_connections to lkz_vnext_reminder_bridge;

-- Meta inbound events can withdraw reminder consent, but cannot activate
-- notifications, alter billing or send a message.
create table lkz_vnext.whatsapp_meta_optout_events (
  tenant_id uuid not null references lkz_vnext.tenants(id),
  meta_message_id text not null
    check (meta_message_id ~ '^[A-Za-z0-9._:=/-]{1,255}$'),
  meta_phone_number_id text not null
    check (meta_phone_number_id ~ '^[0-9]{5,30}$'),
  recipient_hash text not null check (recipient_hash ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null default now(),
  primary key (tenant_id,meta_message_id)
);

alter table lkz_vnext.whatsapp_meta_optout_events enable row level security;
revoke all on lkz_vnext.whatsapp_meta_optout_events from public,anon,authenticated;
grant select,insert on lkz_vnext.whatsapp_meta_optout_events
  to lkz_vnext_reminder_bridge;
create policy inbound_optout_bridge on lkz_vnext.whatsapp_meta_optout_events
  for select to lkz_vnext_reminder_bridge using (true);
create policy inbound_optout_write on lkz_vnext.whatsapp_meta_optout_events
  for insert to lkz_vnext_reminder_bridge with check (true);

-- Neither the admin UI nor a WhatsApp customer can remove an opt-out.
commit;
