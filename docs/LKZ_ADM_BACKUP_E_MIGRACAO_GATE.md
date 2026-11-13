# LKZ ADM — backup e gate da migração documental

Preparação: 12/11/2026. Projeto Supabase: LacroseTech Project (ref icrtewhazpfauuroswri).
Migração pendente: supabase/migrations/20261112233300_lkz_adm_documentos_exclusivos_por_proposta.sql.
A PR #99 já foi incorporada ao GitHub. Merge não executa DDL no Supabase.

## Situação observada
- Banco hospedado: PostgreSQL 17, Supabase Free.
- Consulta somente leitura em 12/11/2026: 0 propostas, 0 dossiês, 0 minutas textuais, 0 conflitos.
- A ausência desses documentos NÃO significa que os demais dados empresariais estejam vazios.
- Não foi comprovado backup restaurável nesta continuidade.
- Script novo: scripts/lkz_adm_backup_encrypted.sh. Não contém senhas ou tokens.

## Exportar backup criptografado no WSL (sem credenciais no Git)

1. Abra o projeto certo no Supabase. No botão Connect, copie os dados da conexão Direct (IPv6, preferível) ou Session pooler (IPv4). Não use Transaction pooler.
2. Em Database Settings, baixe o certificado de CA do banco, em pasta privada fora do repositório. É certificado público para validação TLS, não a senha do banco.
3. Use um terminal WSL confiável com cliente PostgreSQL 17, GnuPG e sha256sum. Confira: pg_dump --version, pg_restore --version, gpg --version.
4. Configure os parâmetros da conexão no terminal, conforme Connect. Para conexão direta, se tiver IPv6:

       export PGHOST='db.icrtewhazpfauuroswri.supabase.co'
       export PGPORT='5432'
       export PGUSER='postgres'
       export PGDATABASE='postgres'
       export PGSSLMODE='verify-full'
       export PGSSLROOTCERT="$HOME/certificados/supabase-lacrosetech-ca.crt"

   Se usar Session pooler IPv4, COPIE o host real do Dashboard (não invente):

       export PGHOST='HOST-REAL-DO-SESSION-POOLER'
       export PGPORT='5432'
       export PGUSER='postgres.icrtewhazpfauuroswri'
       export PGDATABASE='postgres'
       export PGSSLMODE='verify-full'
       export PGSSLROOTCERT="$HOME/certificados/supabase-lacrosetech-ca.crt"

   Nunca insira a senha numa URL de conexão, linha de comando, script ou commit. Deixe a libpq pedir a senha no terminal, ou use PGPASSFILE privado com permissão 0600 fora do Git.

5. Execute em terminal interativo, indicando diretório SEGURO FORA DO REPOSITÓRIO:

       bash scripts/lkz_adm_backup_encrypted.sh "$HOME/Backups/LacroseTech"

   O script valida identificação do projeto, host, usuário, porta, TLS verify-full com CA, versões do PostgreSQL, diretório e TTY. Use sempre uma revisão posterior à correção que retirou --file=- do pg_dump (opção que criava um arquivo chamado '-' em vez de escrever no stdout). Se uma versão anterior tiver sido executada, inspecione em privado o diretório de execução em busca de um arquivo com nome literal '-' e trate-o como dump sensível, sem enviar o arquivo ao chat ou ao Git.
   Os bytes do pg_dump são criptografados em streaming por GPG AES-256; o dump em claro não é salvo no disco. Gera .pgdump.gpg e checksum .sha256 com acesso restrito. Digite senha forte para GPG, distinta da senha do banco.

6. Copie o arquivo criptografado e checksum para local off-site privado. Guarde a senha de criptografia em gerenciador separado. Evite sincronização pública. Verifique checksum depois:

       sha256sum -c NOME_DO_ARQUIVO.sha256

7. OBRIGATÓRIO: faça ensaio de restauração funcional em PostgreSQL 17 ISOLADO e compatível, com schemas/extensões necessários. A validação automática de formato via pg_restore --list NÃO comprova restauração funcional. Nunca use o Supabase de produção para teste de recuperação. Um novo projeto Supabase para esse teste pode ter custo e exige aprovação própria.

### Limites do backup
O dump criptografado preserva agora metadados de propriedade dos objetos e comandos de GRANT/REVOKE do PostgreSQL. **Não utilize --no-owner ou --no-acl no dump de recuperação**, pois as permissões poderiam ser perdidas. Isso pressupõe que as roles globais correspondentes já existam no destino antes da restauração: valide-as separadamente e jamais crie usuários privilegiados automaticamente com base em um arquivo não verificado. O teste sintético no CI comprova restauração de proprietário, GRANT positivo e acesso negado para anon; não comprova a disponibilidade das roles reais no ambiente de recuperação.
pg_dump cobre a parte lógica acessível pelo usuário do banco, mas NÃO exporta conteúdo dos objetos do Storage API, código de Edge Functions, segredos externos, DNS/Cloudflare, configurações de plataforma ou roles globais. Auth e metadados do Storage podem exigir tratamento especial ao restaurar em outro projeto. Esses componentes demandam plano de recuperação específico. Não confundir este arquivo com snapshot completo do projeto.

## Gate para publicar a migração no Supabase

- [ ] Backup criptografado produzido e preservado off-site, hash conferido.
- [ ] Teste real de restauração em destino isolado concluído com permissões verificadas.
- [ ] Repetir consulta de colisões e garantir resultado zero antes de aplicar.
- [ ] CI de PostgreSQL 17 e segurança aprovado no commit final.
- [ ] Confirmar ausência de conflito com trabalho paralelo nas branches e no banco.
- [ ] Aplicar SOMENTE a migração versionada pelo mecanismo de migrações do Supabase.
- [ ] Após aplicar, conferir histórico da migração, triggers, reserva única, RLS e revogação de permissões diretas.
- [ ] Conferir MASTER+MFA, ADMIN+MFA, AAL1, anon e idempotência nas RPCs.
- [ ] Registro de checkpoint. Manter assinatura, envio, cobrança e provisionamento desabilitados.

## Rollback e preservação
Backup do código: branch backup/lkz-adm-pre-documentos-exclusivos-20261112.
Git revert não remove alterações do banco. A migração é aditiva; eventual rollback exige análise dos registros e, preferencialmente, outra migração corretiva. NÃO executar DROP TABLE, apagar dossiês ou alterar hashes para simular reversão. Um restore pode afetar outros módulos que compartilham o banco.

Referências:
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
