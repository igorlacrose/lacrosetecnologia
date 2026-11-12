#!/usr/bin/env bash
# Exclusividade concorrente REAL em PostgreSQL 17 descartável.
# Exige fixture SQL concluída e PGPASSWORD do serviço efêmero da CI.
set -euo pipefail
quote="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3"
contact="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

set +e
psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d lkz_contract_test -c "BEGIN;
 INSERT INTO lkz_adm_private.contract_text_previews(quote_id,contact_id)
 VALUES ('$quote','$contact');
 SELECT pg_sleep(1);
 COMMIT;" > /tmp/lkz-text-race.log 2>&1 &
text_pid=$!

psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d lkz_contract_test -c "BEGIN;
 INSERT INTO lkz_adm_private.signature_dossiers
  (quote_id,contact_id,request_id,terms_version,document_ref,document_sha256)
 VALUES ('$quote','$contact','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3',
  'v1','DOC-TEST-0003',repeat('a',64));
 COMMIT;" > /tmp/lkz-dossier-race.log 2>&1 &
dossier_pid=$!

wait "$text_pid"; text_status=$?
wait "$dossier_pid"; dossier_status=$?
set -e

if (( (text_status == 0) == (dossier_status == 0) )); then
  echo "FAIL: esperava exatamente uma transação aceita na disputa" >&2
  cat /tmp/lkz-text-race.log /tmp/lkz-dossier-race.log >&2
  exit 1
fi

counts=$(psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d lkz_contract_test -At -F '|' -c "
 SELECT
  (SELECT count(*) FROM lkz_adm_private.contract_text_previews WHERE quote_id='$quote')+
  (SELECT count(*) FROM lkz_adm_private.signature_dossiers WHERE quote_id='$quote'),
  (SELECT count(*) FROM lkz_adm_private.contract_document_claims WHERE quote_id='$quote');
")
if [[ "$counts" != "1|1" ]]; then
  echo "FAIL: esperado um único documento com uma reserva; encontrado $counts" >&2
  exit 1
fi
echo "PASS: duas transações concorrentes => exatamente uma gravação, uma reserva"
