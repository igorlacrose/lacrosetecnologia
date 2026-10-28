# LKZ ISP — MASTER, gestão de usuários e auditoria

Estado: **pré-produção em branch isolada**. Migrações aplicadas apenas no Supabase **exclusivo LKZ ISP**. Não mesclar ou publicar dados reais antes de homologação.

## Papéis

| Perfil | Dados | Convites de usuários |
|---|---|---|
| MASTER | Global, MFA obrigatório | Gestor, Administrador, Líder e Financeiro; nunca outro MASTER |
| Gestor | Todos os setores da empresa | Gestor, Administrador, Líder e Financeiro na própria empresa |
| Administrador | Todos os setores, leitura | Administrador, Líder e Financeiro na própria empresa |
| Líder | Somente setor vinculado | Não |
| Financeiro | Somente setor financeiro vinculado | Não |

Convites iniciam como `pending`. A aceitação do convite, confirmação do e-mail e definição da própria senha precisam de serviço de provisionamento seguro (pendente). Registro de convite não envia e-mail.

## Primeiro MASTER

A autoridade global fica em tabela privada `lkz_private.lkz_isp_system_masters`, protegida por deny-all para clientes. Não há concessão MASTER por comparação pública de e-mail ou por autoinscrição. Ativação é ato administrativo, somente após conta real confirmada e MFA TOTP. O MASTER ativo recebe automaticamente vínculos de leitura global nos tenants, sem expor a tabela privada.

## Auditoria e revisões

- Auditoria é append-only; a aplicação não pode excluir eventos, nem o MASTER.
- Eventos do MASTER recebem `audit_visibility=master_only`; só MASTER vê esses eventos em consultas. Gestor vê apenas eventos `standard` da própria empresa. Administrador, Financeiro e Líder não têm acesso à auditoria.
- Editar/excluir não apaga a fonte: correção/anulação cria **revisão versionada**, com justificativa, autor, data e evidência obrigatória quando financeira.
- Essa tabela de revisões é preliminar; ainda falta aplicar revisões na projeção de relatórios, aprovações independentes de movimentações críticas, backups isolados e restore.
- Segurança de confiança do proprietário não substitui auditoria independente e backups.

## Validações efetuadas

Testes de banco simulados em transações com `ROLLBACK`: master com aal2 vê tenants, master com aal1 não vê, gestor restrito, admin sem permissão de convidar gestor, auditoria MASTER invisível ao gestor, revisão sem MFA/evidência bloqueada, original imutável. Banco não contém usuários ou empresas reais.

O frontend v0.5.1 foi testado localmente, sem deploy. Código completo de pré-produção entregue em pacote independente ao proprietário.

Nenhuma modificação do site principal ou dos módulos anteriores do GitHub nesta branch.
