#!/usr/bin/env bash
# Teste de integridade real PostgreSQL 17: somente fixture descartável em CI.
set -Eeuo pipefail
umask 077
command -v psql >/dev/null || { echo 'psql ausente' >&2; exit 1; }
source_sql='supabase/migrations/20261114195500_lkz_license_installation_limit.sql'
[[ -r "$source_sql" ]] || { echo 'Migração de licenças ausente' >&2; exit 1; }
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

cat > "$tmp" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA lkz_licensing;
CREATE TABLE lkz_licensing.licenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 max_installations smallint NOT NULL DEFAULT 1
 CHECK(max_installations BETWEEN 1 AND 10)
);
CREATE TABLE lkz_licensing.installations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 license_id uuid NOT NULL REFERENCES lkz_licensing.licenses(id),
 installation_id char(64) NOT NULL UNIQUE,
 enabled boolean NOT NULL DEFAULT true
);
SQL

awk '
/^CREATE FUNCTION lkz_licensing.claim_installation_v1\(/ { inside=1; found=1 }
inside { print }
/^\$body\$;/ && inside { done=1; exit }
END { if(!found || !done)exit 2 }
' "$source_sql" >> "$tmp" || {
 echo 'Função de limite não localizada integralmente na migração' >&2
 exit 1
}

cat >> "$tmp" <<'SQL'
DO $test$
DECLARE a uuid; b uuid; n integer;
BEGIN
 INSERT INTO lkz_licensing.licenses DEFAULT VALUES RETURNING id INTO a;
 INSERT INTO lkz_licensing.licenses DEFAULT VALUES RETURNING id INTO b;
 PERFORM lkz_licensing.claim_installation_v1(a,repeat('a',64));
 PERFORM lkz_licensing.claim_installation_v1(a,repeat('a',64));
 SELECT count(*) INTO n FROM lkz_licensing.installations WHERE license_id=a AND enabled;
 IF n<>1 THEN RAISE EXCEPTION 'Falha idempotencia'; END IF;
 BEGIN
  PERFORM lkz_licensing.claim_installation_v1(a,repeat('b',64));
  RAISE EXCEPTION 'Limite ultrapassado sem rejeicao';
 EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE lkz_licensing.installations SET enabled=false
 WHERE license_id=a AND installation_id=repeat('a',64);
 PERFORM lkz_licensing.claim_installation_v1(a,repeat('b',64));
 BEGIN
  PERFORM lkz_licensing.claim_installation_v1(a,repeat('a',64));
  RAISE EXCEPTION 'Reativacao burlou limite';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM lkz_licensing.claim_installation_v1(b,repeat('a',64));
  RAISE EXCEPTION 'Instalacao vinculada a outra licenca';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 UPDATE lkz_licensing.licenses SET max_installations=2 WHERE id=a;
 PERFORM lkz_licensing.claim_installation_v1(a,repeat('a',64));
 SELECT count(*) INTO n FROM lkz_licensing.installations WHERE license_id=a AND enabled;
 IF n<>2 THEN RAISE EXCEPTION 'Limite configuravel nao respeitado'; END IF;
 BEGIN
  PERFORM lkz_licensing.claim_installation_v1(a,repeat('c',64));
  RAISE EXCEPTION 'Limite 2 ultrapassado';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $test$;
ROLLBACK;
SQL

psql -X -v ON_ERROR_STOP=1 -f "$tmp"
echo 'PASS: licença limitada, sem duplicação, reativação indevida ou troca de proprietário (PostgreSQL 17).'
