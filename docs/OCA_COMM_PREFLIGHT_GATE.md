# OCA — Pré-despacho auditado e isolamento inicial por empresa

## Entrega de 12/11/2026

Esta etapa **não envia, agenda nem entrega mensagens**. Ela implementa um diagnóstico registrável e fail-closed para uma futura camada de comunicação do OCA.

### Fronteiras implementadas
- `lkz_adm_private.oca_comm_workspaces`: empresas OCA independentes, **desativadas por padrão**. Nenhuma empresa foi criada automaticamente.
- `lkz_adm_private.oca_comm_memberships`: operador e papel por workspace, inativo por padrão.
- `lkz_adm_private.oca_comm_lead_bindings`: vínculo explícito e único entre oportunidade e workspace. **Nenhuma oportunidade existente foi migrada ou atribuída.**
- `lkz_adm_private.oca_comm_preflights`: diagnósticos auditados, idempotentes, sem conteúdo integral nem destinatário. A tabela aceita **somente** `status='blocked'` e `delivery_enabled=false`.
- RPC `public.lkz_adm_oca_comm_preflight(p_preview,p_request_id)`: verifica no **servidor** MFA e perfil administrativo, vínculo/participação no tenant, prévia aprovada, oportunidade ativa e vínculo de contato, destino inalterado, consentimento vigente para aquele destino e canal, e rascunho inalterado.
- Falta de vínculo com empresa só pode ser diagnosticada por MASTER com MFA. Se existe vínculo, **qualquer operador, inclusive MASTER, precisa possuir associação ativa com aquele workspace**.
- Cada tentativa recebe UUID de idempotência. Uma retentativa com a mesma chave confirma o mesmo registro; chave reutilizada com outro usuário, prévia ou tenant é rejeitada.
- A RPC sempre acrescenta `transport_disabled` e retorna `status='blocked'`, `delivery_enabled=false`, `dry_run_only=true`.

### Interface
Em **Oportunidades → Pré-envio e aprovação**, uma prévia já aprovada apresenta **Prontidão de despacho OCA → Verificar bloqueios**. A ação executa apenas a RPC de diagnóstico e exibe motivos legíveis, sem expor credenciais nem enviar mensagens. Prévias pendentes, rejeitadas ou canceladas não apresentam o botão.

### Limites atuais (bloqueadores de produção)
1. As tabelas de tenant existentes em `public.lkz_tenants` são de outros componentes e **não foram reutilizadas**.
2. Não há onboarding confiável para workspaces OCA, nem atribuição aprovada de oportunidades. O modelo já nega acesso se faltar associação ativa.
3. **O CRM legado ainda não é multi-tenant.** Esta entrega isola apenas a futura camada de pré-despacho; não anunciar isolamento global do painel.
4. Não existe outbox executável, adaptador de provedor, segredo de API, webhook de confirmação, fila de retry, envio de WhatsApp/e-mail, agendador ou worker de despacho.
5. `approved` significa aprovação de conteúdo, jamais autorização para envio. A futura autorização de despacho precisa ser independente, revogável e revalidar todas as condições no instante do envio.
6. Antes de abrir comunicação autônoma, homologar as integrações oficiais, aderir à LGPD e às políticas dos provedores, verificar opt-out, finalidade, controles antiabuso, autenticação webhooks, limites, tenacidade transacional e separação dos tenants em todos os níveis.
7. O admin ainda exige testes de ponta a ponta com sessão real MASTER/MFA, antes de declarar homologação operacional.

### Testes e rollback
- SQL com `ROLLBACK`: sem workspace, tenant vinculado sem membership, membership ativa em tenant desabilitado, idempotência, bloqueios `transport_disabled`, anon e MFA baixo negados. Nenhuma oportunidade ou prévia real foi criada durante os testes.
- CI: testes do componente, ausência de chamadas externas e regressões prévias do LKZ ADM.
- Backup de frontend: branch `backup/lkz-oca-preflight-before-20261112`.
- Migração aditiva em `supabase/migrations/20261112203456_lkz_oca_preflight_multitenant_bloqueado.sql`. Reverter a interface não remove automaticamente as tabelas; remover objetos requer plano específico se houver dados futuros.

**Próxima etapa segura:** onboarding revisado de workspaces e membership, vínculo explícito de leads por tenant com auditoria e testes de acesso cruzado; só depois criar outbox não executável de teste. Jamais ativar transporte apenas mudando uma flag do frontend ou banco.
