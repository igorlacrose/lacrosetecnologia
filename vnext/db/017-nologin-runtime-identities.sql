begin;

-- These are inert PostgreSQL role identities, NOT login accounts.
-- Enabling LOGIN, assigning credentials, network access or external providers
-- is a distinct, reviewed operation. Never give a runtime role BYPASSRLS.
--
-- Each dedicated role can SET ROLE to exactly one existing privilege role.
-- INHERIT FALSE prevents data access before SET ROLE inside a transaction.
-- The "authenticated" permission is not a substitute for signed JWT/AAL2;
-- callers must still set verified claims per request on the server.
create role lkz_vnext_runtime
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role lkz_vnext_asaas_ingest_runtime
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role lkz_vnext_asaas_issue_runtime
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role lkz_vnext_asaas_reconcile_runtime
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role lkz_vnext_meta_runtime
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role lkz_vnext_reminder_runtime
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;

grant authenticated to lkz_vnext_runtime with inherit false, set true;
grant lkz_vnext_asaas_ingest to lkz_vnext_asaas_ingest_runtime
  with inherit false, set true;
grant lkz_vnext_asaas_issue to lkz_vnext_asaas_issue_runtime
  with inherit false, set true;
grant lkz_vnext_asaas_reconcile to lkz_vnext_asaas_reconcile_runtime
  with inherit false, set true;
grant lkz_vnext_meta_bridge to lkz_vnext_meta_runtime
  with inherit false, set true;
grant lkz_vnext_reminder_bridge to lkz_vnext_reminder_runtime
  with inherit false, set true;

commit;
