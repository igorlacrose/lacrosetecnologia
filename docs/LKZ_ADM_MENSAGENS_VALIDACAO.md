# LKZ ADM — validação da movimentação de mensagens

**Status em 11/11/2026:** correção preparada no GitHub, **não aplicada no Supabase**.

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

**A CI valida propriedades estáticas do SQL, não a execução integrada com PostgreSQL e sessão MFA.**
