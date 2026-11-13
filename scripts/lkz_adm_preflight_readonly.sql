-- LKZ ADM: inventário estritamente read-only do banco antes de backup/DDL.
-- Não consulta informações de clientes: somente catálogos, contagens e flags.
-- Este arquivo serve também para a fixture descartável PostgreSQL 17 do CI.
-- Uso local (com libpq/SSL já configurados): psql -X -v ON_ERROR_STOP=1 -f scripts/lkz_adm_preflight_readonly.sql
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;

SELECT
  current_database() AS db_name,
  current_setting('server_version_num')::integer AS postgres_version_num,
  current_setting('transaction_read_only') = 'on' AS read_only_enforced;

SELECT
  (SELECT count(*) FROM pg_catalog.pg_namespace
   WHERE nspname <> 'information_schema' AND nspname NOT LIKE 'pg_%') AS schemas,
  (SELECT count(*) FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p')
     AND n.nspname NOT IN ('pg_catalog','information_schema')) AS tables,
  (SELECT count(*) FROM pg_catalog.pg_extension) AS extensions,
  (SELECT count(*) FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE p.prosecdef AND n.nspname IN ('public','lkz_adm_private')) AS relevant_security_definer_functions,
  (SELECT count(*) FROM pg_catalog.pg_roles
   WHERE rolname IN ('postgres','anon','authenticated','service_role','supabase_auth_admin','supabase_storage_admin')) AS expected_platform_roles_present,
  to_regclass('storage.objects') IS NOT NULL AS storage_objects_table_present,
  to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS migration_history_table_present;

SELECT
  (SELECT count(*) FROM lkz_adm_private.client_quotes) AS proposals,
  (SELECT count(*) FROM lkz_adm_private.signature_dossiers) AS dossiers,
  (SELECT count(*) FROM lkz_adm_private.contract_text_previews) AS text_previews,
  (SELECT count(*) FROM lkz_adm_private.signature_dossiers d
    JOIN lkz_adm_private.contract_text_previews t USING (quote_id)) AS cross_type_document_conflicts,
  to_regclass('lkz_adm_private.contract_document_claims') IS NOT NULL AS exclusivity_claims_table_present,
  (SELECT count(*) FROM pg_catalog.pg_trigger
   WHERE NOT tgisinternal
     AND tgname IN ('contract_text_exclusive_claim','signature_dossier_exclusive_claim')) AS exclusivity_trigger_count;

COMMIT;
