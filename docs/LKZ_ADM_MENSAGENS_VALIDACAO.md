# LKZ ADM — validação da movimentação de mensagens

**Status verificado em 12/11/2026:** correção e rollback preparados no GitHub, **SQL ainda não aplicado no Supabase de produção**.

## Diagnóstico confirmado (somente leitura)

- A função pública de movimentação de mensagens é SECURITY INVOKER.
- Ela tenta INSERT e ON CONFLICT DO UPDATE na tabela privada lkz_adm_private.message_folders.
- A role authenticated possui USAGE no schema e SELECT na tabela, mas não INSERT nem UPDATE.
- A política RLS operator_access condiciona operações ao MFA AAL2 e operador ativo, porém **RLS não concede GRANT de tabela**.
- A exclusão definitiva e a movimentação de atendimentos já utilizam helpers privados SECURITY DEFINER.

## Correção isolada

O arquivo supabase/sql/lkz_adm_move_messages_acl_fix.sql transfere o corpo operacional **inalterado** para uma função privilegiada no schema privado, com SECURITY DEFINER. A função pública se torna um wrapper SECURITY INVOKER que delega à privada. Mantêm-se: operador ativo + MFA, máximo de 50 IDs únicos, transições válidas, lock e rollback automático em conflito.

Não conceder INSERT/UPDATE diretamente à role authenticated na tabela privada e não expor o schema privado na Data API.

## Bloqueios antes de produção

1. Backup recuperável de schema e dados, com restauração testável em local protegido (jamais comitar dados reais).
2. Revisão do dono da função privilegiada, search_path, dependências e grants.
3. Aplicação e teste em ambiente isolado sem dados reais; não criar branch Supabase tarifada sem aprovar custos.
4. Testes: anônimo (nega), autenticado sem MFA (nega), usuário desativado (nega), admin/MASTER com MFA (permite), active → deleted → active, IDs duplicados, destinos inválidos, ações concorrentes e purge permitido somente sob suas regras próprias.
5. Confirmar que nenhuma tabela privada passou a aceitar escritas diretas via API. Validar auditoria, regressões do painel, mensagens e lixeira com registros fictícios.
6. Só então avaliar implantação com janela de rollback.

## Rollback

supabase/sql/lkz_adm_move_messages_acl_rollback.sql restaura a definição invoker original e remove apenas o helper privado. Não apaga tabelas, mensagens nem políticas. O rollback reintroduz a falha funcional anterior.

**Validação disponível:** a CI verifica as propriedades estáticas do SQL e executa a migração e o rollback em um **PostgreSQL 17 descartável**, com usuários fictícios, claims AAL1/AAL2, papéis e políticas RLS. Esse ensaio NÃO comprova autenticação Supabase real nem substitui backup, restauração e homologação no esquema existente.

## Checklist de publicação segura

- A inclusão desses arquivos na branch `main` **não executa** a migração. A correção funcional da lixeira permanece pendente até uma implantação explícita no banco.
- Obter evidência de backup recuperável, retenção e ensaio de restauração fora da produção antes de qualquer DDL; esta ferramenta não confirma sozinha backups/restore do projeto Supabase.
- Comparar novamente a definição e o dono das funções `public.lkz_adm_move_messages` e `lkz_adm_private.is_operator` com o SQL da correção. Em caso de divergência, interromper a aplicação.
- Antes e depois de aplicar, testar os GRANTs, a RLS, o registro de auditoria e o fluxo de movimentação/retorno de mensagens por usuário com MFA real em ambiente homologado.
- Executar o rollback somente se necessário, depois de registrar a falha e preservar evidências. O rollback restaura o comportamento original, inclusive a limitação anterior de escrita.
- **Não** liberar automaticamente operações de purge, exclusão física ou alterações de permissões de tabela como atalho.
