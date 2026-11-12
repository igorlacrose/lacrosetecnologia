# LKZ ADM — checkpoint de homologação e gate de produção (12/11/2026)

## Estado comprovado nesta rodada

- **Produção**: Supabase `icrtewhazpfauuroswri` (LacroseTech Project), PostgreSQL 17.11, organização **Free**. A correção da lixeira **NÃO** foi aplicada no banco de produção.
- **Homologação**: Supabase `nijsafzwxzcfqdevlsxe` (LKZ ADM VNext - Homologacao), PostgreSQL 17.11; projeto separado, iniciado com **zero usuários Auth, zero tabelas da aplicação e zero migrações**.
- Fonte do VNext homologado: commit GitHub `1bea692655f4b9a9c00d5e0bf51944b181784122`, PR #76, branch `integration/vnext-security-rehearsal-20261112`.
- **16 migrações aplicadas na homologação** pelo mecanismo de migrações do Supabase: `vnext_001_foundation` até `vnext_016_whatsapp_simulated_dispatch` na ordem dos arquivos `vnext/db/001-*.sql` a `016-*.sql`.
- Inspeção pós-migração: **26 tabelas em lkz_vnext/lkz_vnext_billing, todas com RLS habilitado**; nenhum tenant, vínculo de cobrança ou lembrete real; cinco papéis técnicos sem LOGIN, SUPERUSER ou BYPASSRLS.
- Permissões negativas confirmadas: `anon` sem USAGE nos dois schemas; `authenticated` sem leitura de `token_ciphertext` Meta, sem leitura de `recipient_ciphertext` e sem UPDATE na tabela financeira; o papel de ingestão Asaas sem SELECT de vínculos financeiros.
- Advisor de segurança do Supabase de homologação: **nenhum alerta** no momento da verificação. Isso não substitui revisão da aplicação ou autenticação real.

## RLS multiempresa — teste real no Supabase hospedado

- Executado em 12/11/2026 no projeto separado `nijsafzwxzcfqdevlsxe` a partir do SQL versionado em `scripts/test_vnext_hosted_rls.sql` (blob `963242537b59b696c8060388aad14b6f5e4469ee`).
- Usa uma **única transação com BEGIN/ROLLBACK**, exigindo ausência de usuários Auth, tenants e bindings antes de iniciar; aborta em base já populada.
- Cria duas empresas, quatro usuários fictícios sem senha e planos/vínculos financeiros apenas durante a transação; testa papel `authenticated` de verdade no PostgreSQL, com claims sintéticas.
- Confirma separação de clientes e cobranças entre admins A/B, restrição do viewer, rejeição sem MFA AAL2, usuário desativado, inserção cruzada e tentativa de alterar estado financeiro; revogação de associação remove acesso na mesma sessão; anônimo não tem USAGE nos schemas.
- Resultado confirmado pelo Supabase SQL: `hosted_rls_passed_no_persisted_data`. Contagens de `auth.users`, `lkz_vnext.tenants` e `payment_bindings` zero após ROLLBACK.
- O teste **não** valida login real, TOTP, JWT assinado, API externa, webhook Meta, provedor Asaas ou backup/restauração. Use `psql -X -v ON_ERROR_STOP=1 -f scripts/test_vnext_hosted_rls.sql` somente contra o projeto de homologação vazio.

## Lixeira de mensagens — validação adicional em Supabase hospedado

Fonte: `supabase/sql/lkz_adm_move_messages_acl_fix.sql` (blob Git `0e14bc88cc7d8e9f2f71759cc782b367b5fb88d4`) e rollback `supabase/sql/lkz_adm_move_messages_acl_rollback.sql` (blob `3f78852b6126203c72051ae25d26ca58de7373be`), incorporados na `main` pela PR #77.

Foram executados **em transações temporárias e totalmente revertidas** no PostgreSQL hospedado da homologação, com mensagens e usuários fictícios:

1. Aplicação do SQL de correção, negação para AAL1, admin desativado e viewer, e movimentação/arquivamento/restauração por admin ativo AAL2.
2. Aplicação seguida do arquivo de rollback original, comparação exata da definição anterior e posterior da função pública e verificação de remoção do helper privado.
3. Confirmação pós-ROLLBACK de que as tabelas e funções fictícias foram removidas. Nenhuma tabela, usuário ou função da lixeira ficou persistente na homologação.

**A produção permanece com** `public.lkz_adm_move_messages` como `SECURITY INVOKER`, sem `lkz_adm_private.move_messages`; portanto, a falha funcional de INSERT/UPDATE continua pendente.

## Bloqueios para aplicar o SQL de correção na produção

1. A organização Supabase usa plano **Free**; não foi localizada evidência de backup completo restaurável nem de teste de restauração. O plano Free não inclui backups diários gerenciados.
2. Confirmar backup **externo e criptografado**, consistente, da base de produção, protegido contra exposição de dados e credenciais. Inspecionar o conteúdo com `pg_restore --list` e testar restauração em banco isolado com Postgres 17 e extensões/roles necessários. Apenas existir um arquivo ou SHA não comprova recuperação.
3. Fazer preflight read-only comparando `pg_get_functiondef`, owner, grants, policies, dados existentes e possíveis alterações concorrentes com o SQL aprovado. Interromper diante de divergência.
4. Executar a correção com janela definida, observar erros, testar usuário real com TOTP/AAL2 (mover para lixeira, restaurar e arquivar), testar bloqueio de acesso sem autorização, auditar e confirmar que as permissões privadas não foram ampliadas.
5. Se houver regressão, executar **somente** o arquivo de rollback versionado, após registrar o estado e preservar os dados. Esse rollback reintroduz a limitação funcional anterior, mas não exclui mensagens.

### Exemplo de exportação manual em ambiente confiável

No Windows PowerShell 7 com cliente PostgreSQL 17 instalado e conexão **TLS autenticada**, usar variáveis de conexão não sensíveis e solicitar senha **interativamente** (nunca colocar segredo em commit, URL, linha de comando ou histórico):

```powershell
$env:PGHOST = "<host-direto-ou-session-pooler-confirmado-no-Supabase>"
$env:PGPORT = "5432"  # ajustar ao endpoint confirmado
$env:PGUSER = "<usuario-do-banco>"
$env:PGDATABASE = "postgres"
$env:PGSSLMODE = "verify-full"  # exige CA confiável/configurada
pg_dump -W -Fc --no-owner --no-acl --file "BACKUP_DESTINO_SEGURO.dump"
if ($LASTEXITCODE -ne 0) { throw "Falha no backup" }
pg_restore --list "BACKUP_DESTINO_SEGURO.dump" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Arquivo de backup inválido" }
Get-FileHash -Algorithm SHA256 "BACKUP_DESTINO_SEGURO.dump"
```

**O arquivo bruto contém dados sensíveis**: criptografar e armazenar fora de repositórios e sites públicos. A listagem e o hash não substituem a **restauração testada**. Sem esse gate, **não executar DDL em produção**.

## Ainda não homologado

Auth Supabase real com TOTP, acesso via endpoint HTTPS externo, Asaas Sandbox com provedor real, Meta Embedded Signup/webhooks reais, templates e envio de WhatsApp, ativação financeira, produção multiempresa e integração às agendas reais de BarbarOS/LibertyOS. O simulador de lembretes não envia mensagens e não cria custos Meta.

## Continuidade segura

Preservar a `main`, PRs de desenvolvimento e trabalho em outros chats. Não confundir teste de RLS/CI ou implantação de esquema na homologação com autorização para produção, integração paga ou homologação funcional completa. Reconfirmar heads, migrações e backup antes de qualquer etapa posterior.
