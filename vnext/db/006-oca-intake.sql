begin;
alter table lkz_vnext.interactions add column oca_event_id uuid;
alter table lkz_vnext.interactions add column oca_event_digest text;
alter table lkz_vnext.interactions add constraint interaction_oca_envelope check (
  (oca_event_id is null and oca_event_digest is null)
  or (oca_event_id is not null and oca_event_digest is not null and oca_event_digest ~ '^[0-9a-f]{64}$' and channel = 'oca')
);
alter table lkz_vnext.interactions add unique (tenant_id, oca_event_id);
grant insert (oca_event_id, oca_event_digest) on lkz_vnext.interactions to authenticated;
commit;
