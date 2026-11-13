#!/usr/bin/env bash
# Backup lógico criptografado do Supabase LacroseTech (uso local/WSL).
# Não publica segredos nem cria arquivos de dump sem criptografia.
# Este script NÃO restaura dados, NÃO altera o banco e NÃO aplica migrações.
set -Eeuo pipefail
set +x
umask 077

readonly PROJECT_REF='icrtewhazpfauuroswri'
readonly DIRECT_HOST="db.${PROJECT_REF}.supabase.co"
readonly REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"

fail() {
  printf 'ERRO: %s\n' "$*" >&2
  exit 1
}

if (( $# != 1 )); then
  fail 'Uso: bash scripts/lkz_adm_backup_encrypted.sh /caminho/seguro/fora-do-repositorio'
fi

for bin in pg_dump pg_restore gpg sha256sum mktemp; do
  command -v "$bin" >/dev/null 2>&1 || fail "Ferramenta ausente: $bin"
done

[[ "$(pg_dump --version)" =~ [[:space:]]17\. ]] ||
  fail 'Use pg_dump PostgreSQL 17 para o banco atual.'
[[ "$(pg_restore --version)" =~ [[:space:]]17\. ]] ||
  fail 'Use pg_restore PostgreSQL 17 para conferir o arquivo.'

: "${PGHOST:?Configure PGHOST a partir do botão Connect do projeto correto}"
: "${PGUSER:?Configure PGUSER a partir do botão Connect do projeto correto}"
: "${PGSSLROOTCERT:?Configure PGSSLROOTCERT com o certificado raiz obtido no Supabase}"
: "${PGDATABASE:?Configure PGDATABASE=postgres}"
: "${PGPORT:?Configure PGPORT=5432}"

[[ "$PGPORT" == '5432' ]] || fail 'Não usar modo de pool transacional/porta incorreta.'
[[ "$PGDATABASE" == 'postgres' ]] || fail 'Banco incorreto; esperado postgres.'
[[ "${PGSSLMODE:-}" == 'verify-full' ]] ||
  fail 'Exija PGSSLMODE=verify-full (validação da CA e do hostname).'
[[ -f "$PGSSLROOTCERT" && -r "$PGSSLROOTCERT" ]] ||
  fail 'PGSSLROOTCERT não existe ou não pode ser lido.'

if [[ "$PGHOST" == "$DIRECT_HOST" ]]; then
  [[ "$PGUSER" == 'postgres' ]] || fail 'Usuário direto não pertence ao projeto esperado.'
elif [[ "$PGHOST" == *.pooler.supabase.com ]]; then
  [[ "$PGUSER" == "postgres.${PROJECT_REF}" ]] ||
    fail 'Usuário do pooler não corresponde ao projeto esperado.'
else
  fail 'Host fora da lista de endpoints Supabase esperados.'
fi

# Não aceitar arquivos dentro do Git ou em sistemas de arquivos de código.
mkdir -p -- "$1"
readonly BACKUP_DIR="$(cd -- "$1" && pwd -P)"
case "$BACKUP_DIR/" in
  "$REPO_ROOT/"*) fail 'Backups nunca devem ficar dentro do repositório Git.' ;;
esac
if git -C "$BACKUP_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
  fail 'Diretório escolhido está dentro de um repositório Git.'
fi

# A entrada é sempre protegida; GPG consulta a senha pelo agente/pinentry.
[[ -t 0 && -t 1 ]] || fail 'Execute em terminal interativo, não em CI/log/pipe.'
export GPG_TTY
GPG_TTY="$(tty)"
readonly TS="$(date -u '+%Y%m%dT%H%M%SZ')"
readonly ARCHIVE_NAME="lacrosetech-${PROJECT_REF}-${TS}-$$.pgdump.gpg"
readonly FINAL="$BACKUP_DIR/$ARCHIVE_NAME"
[[ ! -e "$FINAL" ]] || fail 'Arquivo já existe. Nada será sobrescrito.'

WORK_DIR=''
cleanup() {
  if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
    rm -rf -- "$WORK_DIR"
  fi
}
trap cleanup EXIT

WORK_DIR="$(mktemp -d "$BACKUP_DIR/.lkz-backup.XXXXXXXX")"
readonly ENCRYPTED_TEMP="$WORK_DIR/archive.gpg"

printf 'Iniciando exportação lógica completa, diretamente para criptografia AES-256.\n'
printf 'Confirme a senha forte no GPG. O banco não será modificado.\n'

# pg_dump envia os bytes para GPG sem gravar dump plaintext no disco.
# Senha do PostgreSQL é obtida pela libpq (prompt ou PGPASSFILE fora do Git).
pg_dump \
  --format=custom \
  --no-owner \
  --no-acl |
  gpg --symmetric --cipher-algo AES256 --compress-algo none \
    --output "$ENCRYPTED_TEMP"

[[ -s "$ENCRYPTED_TEMP" ]] || fail 'O backup criptografado está vazio.'

# Leitura integral (confere integridade criptográfica) + TOC PostgreSQL.
# O cat final drena o stream após pg_restore --list, evitando SIGPIPE no GPG.
gpg --quiet --decrypt "$ENCRYPTED_TEMP" |
  { pg_restore --list >/dev/null && cat >/dev/null; } ||
  fail 'Falhou validação criptográfica ou índice pg_restore.'

mv -- "$ENCRYPTED_TEMP" "$FINAL"
rmdir -- "$WORK_DIR"
WORK_DIR=''

(
  cd -- "$BACKUP_DIR"
  sha256sum -- "$ARCHIVE_NAME" > "${ARCHIVE_NAME}.sha256"
)
chmod 600 -- "$FINAL" "${FINAL}.sha256"

printf 'OK: arquivo criptografado e legível pelo pg_restore.\n'
printf 'Arquivo: %s\n' "$FINAL"
printf 'Hash: %s\n' "${FINAL}.sha256"
printf 'ATENÇÃO: inspeção de arquivo NÃO substitui teste de restauração isolada.\n'
printf 'NÃO habilite o deploy sem ensaio de restauração e validação de acesso.\n'
