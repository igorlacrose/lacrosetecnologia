#!/usr/bin/env bash
# Ensaiar backup criptografado + restauração em DUAS bases PG17 sintéticas.
# Não aceita host ou nome de banco de produção. Uso exclusivo em CI descartável.
set -Eeuo pipefail
set +x
umask 077

if [[ "$PGHOST" != 'postgres' || "$PGUSER" != 'postgres' ||
      "$PGDATABASE" != 'lkz_contract_test' ]]; then
  echo 'ERRO: host/usuário/banco fora da fixture PostgreSQL descartável.' >&2
  exit 2
fi
: "${PGPASSWORD:?É necessária somente a senha fictícia da CI}"

for tool in pg_dump pg_restore psql createdb gpg sha256sum mktemp base64; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "ERRO: ferramenta ausente: $tool" >&2
    exit 2
  }
done

[[ "$(pg_dump --version)" =~ [[:space:]]17\. ]] || {
  echo 'ERRO: ferramenta pg_dump diferente de PostgreSQL 17.' >&2
  exit 2
}
readonly DEST_DB='lkz_contract_restore_test'
TMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TMP_DIR"' EXIT
export GNUPGHOME="$TMP_DIR/gnupg"
mkdir -- "$GNUPGHOME"
chmod 700 -- "$GNUPGHOME"

# A senha da fixture é gerada de modo efêmero, nunca logada e nunca comitada.
gpg --gen-random 2 48 | base64 > "$TMP_DIR/passphrase"
chmod 600 -- "$TMP_DIR/passphrase"
readonly ENCRYPTED="$TMP_DIR/fixture.pgdump.gpg"

# Proprietários e permissões da fixture também precisam sobreviver.
# O role de origem é global neste cluster descartável e não possui login.
psql -v ON_ERROR_STOP=1 -d "$PGDATABASE" <<'SQL'
CREATE ROLE lkz_backup_fixture_owner NOLOGIN;
CREATE TABLE lkz_adm_private.restore_acl_fixture (
  id integer PRIMARY KEY, value text NOT NULL
);
INSERT INTO lkz_adm_private.restore_acl_fixture VALUES (1, 'backup-safe');
ALTER TABLE lkz_adm_private.restore_acl_fixture OWNER TO lkz_backup_fixture_owner;
GRANT SELECT ON lkz_adm_private.restore_acl_fixture TO authenticated;
REVOKE ALL ON lkz_adm_private.restore_acl_fixture FROM anon;
SQL

# Reproduz a sequência de produção, mas apenas sobre a base sintética.
pg_dump --format=custom |
  gpg --batch --yes --pinentry-mode loopback \
    --passphrase-file "$TMP_DIR/passphrase" \
    --symmetric --cipher-algo AES256 --compress-algo none \
    --output "$ENCRYPTED"

# Garante que nenhum arquivo literal de nome '-' foi criado no checkout.
if [[ -e ./- ]]; then
  echo "ERRO: pg_dump deixou dump plaintext com nome '-'" >&2
  exit 1
fi

[[ -s "$ENCRYPTED" ]] || {
  echo 'ERRO: exportação criptografada vazia.' >&2
  exit 1
}

sha256sum "$ENCRYPTED" > "$TMP_DIR/fixture.sha256"
sha256sum --check --status "$TMP_DIR/fixture.sha256"

# A validação de cabeçalho é complementar: restauração real é obrigatória.
gpg --batch --quiet --pinentry-mode loopback \
  --passphrase-file "$TMP_DIR/passphrase" \
  --decrypt "$ENCRYPTED" |
  { pg_restore --list >/dev/null && cat >/dev/null; }

createdb "$DEST_DB"

# Não escreve o arquivo pgdump em claro; pg_restore consome o stream.
gpg --batch --quiet --pinentry-mode loopback \
  --passphrase-file "$TMP_DIR/passphrase" \
  --decrypt "$ENCRYPTED" |
  pg_restore --exit-on-error --dbname="$DEST_DB"

# Comparar IDs e classes do conteúdo, preservando a auditoria de exclusividade.
sql="select quote_id::text || '|' || document_kind || '|' || document_id::text
  from lkz_adm_private.contract_document_claims
  order by quote_id;"
expected="$(psql -v ON_ERROR_STOP=1 -At -d "$PGDATABASE" -c "$sql")"
actual="$(psql -v ON_ERROR_STOP=1 -At -d "$DEST_DB" -c "$sql")"
[[ "$expected" == "$actual" ]] || {
  echo 'ERRO: reservas restauradas não correspondem ao banco sintético.' >&2
  exit 1
}

counts_sql="select
 (select count(*) from lkz_adm_private.contract_document_claims),
 (select count(*) from lkz_adm_private.contract_text_previews),
 (select count(*) from lkz_adm_private.signature_dossiers);"
original_counts="$(psql -v ON_ERROR_STOP=1 -At -F '|' -d "$PGDATABASE" -c "$counts_sql")"
counts="$(psql -v ON_ERROR_STOP=1 -At -F '|' -d "$DEST_DB" -c "$counts_sql")"
[[ "$counts" == "$original_counts" ]] || {
  echo "ERRO: contagens divergiram (origem=$original_counts, recuperação=$counts)." >&2
  exit 1
}
# O ensaio de concorrência, executado antes do backup, cria um terceiro documento.
[[ "$counts" == 3\|* ]] || {
  echo 'ERRO: contagens da fixture não incluem a disputa concorrente.' >&2
  exit 1
}

# Validar que a barreira continua ativa depois do restore.
protection_sql="select
  (select relrowsecurity from pg_class
    where oid='lkz_adm_private.contract_document_claims'::regclass)
  and not has_table_privilege('authenticated',
    'lkz_adm_private.contract_document_claims','SELECT')
  and (select count(*) from pg_trigger where not tgisinternal and
    tgname in ('contract_text_exclusive_claim',
               'signature_dossier_exclusive_claim'))=2;"
protected="$(psql -v ON_ERROR_STOP=1 -At -d "$DEST_DB" -c "$protection_sql")"
[[ "$protected" == 't' ]] || {
  echo 'ERRO: RLS, GRANTs ou triggers não sobreviveram ao restore.' >&2
  exit 1
}

# Comprovar proprietário real, GRANT positivo, negativa para anon e dados.
acl_sql="SELECT (
  pg_get_userbyid(c.relowner)='lkz_backup_fixture_owner'
  AND has_table_privilege('authenticated','lkz_adm_private.restore_acl_fixture','SELECT')
  AND NOT has_table_privilege('anon','lkz_adm_private.restore_acl_fixture','SELECT')
  AND (SELECT value FROM lkz_adm_private.restore_acl_fixture WHERE id=1)='backup-safe'
)::text
FROM pg_class c
WHERE c.oid='lkz_adm_private.restore_acl_fixture'::regclass;"
acl="$(psql -v ON_ERROR_STOP=1 -At -d "$DEST_DB" -c "$acl_sql")"
[[ "$acl" == 'true' ]] || {
  echo 'ERRO: proprietário, ACL ou conteúdo do fixture não foram restaurados.' >&2
  exit 1
}

# Tentativa de criar documento oposto deve ser rejeitada após recuperação.
if psql -v ON_ERROR_STOP=1 -d "$DEST_DB" -c "
  insert into lkz_adm_private.signature_dossiers
    (quote_id,contact_id,request_id,terms_version,document_ref,document_sha256)
  values
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
     'v1','DOC-RESTORE-0001',repeat('a',64));" > /dev/null 2>&1; then
  echo 'ERRO: exclusividade documental desativada após recuperação.' >&2
  exit 1
fi

echo 'PASS: backup GPG + restauração com dados, RLS, triggers, proprietário e ACL.'
