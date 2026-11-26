# Simulação de despacho e cota mensal — VNext

**Status:** desenvolvimento isolado. NÃO é envio real. NÃO gera cobrança. NÃO habilita faturamento da Meta.

## Escopo entregue

- `db/016-whatsapp-simulated-dispatch.sql`: contador mensal **fictício** por tenant e mês UTC, ledger sintético idempotente por agendamento/revisão/tipo, RLS e permissão restrita ao backend de lembretes. Resumo agregado sujeito a MFA.
- `simulated-dispatch.mjs`: seleção de tarefas elegíveis e vencendo no máximo há 15 minutos, com `FOR UPDATE OF j SKIP LOCKED`, travamento por tenant/mês, reserva transacional de cota, transição atômica `pending` → `simulated`, ledger idempotente e rollback integral caso qualquer gravação falhe.
- `simulate-dispatch-cli.mjs`: execução manual somente com a flag `--simulation-only`, UUID do tenant e acesso à base isolada por `lkz_vnext_reminder_runtime`. Não é cron, nem servidor de envio.
- `GET /api/whatsapp/reminders/simulated`: resumo com MFA, sem telefone ou IDs de agendamentos, apresentado no painel.
- Testes de cota, concorrência, isolamento multiempresa, tentativas duplicadas, falha injetada no banco, ausência de consentimento/conta habilitada e RBAC/RLS.

## Segurança e semântica

A simulação avalia novamente a revisão vigente do agendamento, o status ativo, consentimento, existência de opt-out, prazo, política de notificações e estado de cobrança própria da empresa. Esses requisitos são apenas um modelo de testes; **não representam verificação real de titularidade, faturamento ou template Meta**.

A configuração normal permanece `enabled=false`; nos testes, a configuração é artificialmente ativada em banco efêmero com dados fictícios para exercitar a lógica de quota. O formulário administrativo nunca altera `enabled` para `true`.

A transação NÃO possui ponto de envio externo. Isso permite simular exclusividade e rollback sem usar leases de rede. Um worker de **produção** exigiria outra arquitetura: outbox durável, claims/leasing, tratamento de resposta da Meta, webhooks de entrega, idempotência, reserva de custo com regras oficiais de cobrança, conciliação, cancelamento concorrente e homologação de template. **Não converter este simulador em sender trocando simplesmente o nome de uma função.**

O contador é por mês **UTC**, no máximo 10.000 unidades simuladas, não reais. A Meta pode aplicar outros períodos, categorias e valores. Assim, `monthly_message_limit` não é orçamento monetário garantido.

No cenário de simulação, a tarefa elegível recebe status `simulated`, não `sent`, e não será automaticamente enviada depois. O simulador não é uma ferramenta para operar dados reais: utilizar apenas em banco descartável com backup/rollback.

## Homologação segura

1. Revisar os PRs empilhados #60–#66. Nunca aplicar a migração 016 antes das anteriores e sem backup verificável.
2. Usar PostgreSQL isolado nomeado `lkz_vnext_stage*` e login dedicado `lkz_vnext_reminder_runtime`, sem superuser/bypass RLS e sem privilégios do Asaas ou da Meta.
3. Configurar `VNEXT_REMINDER_DATABASE_URL` somente em Secret Manager do servidor de homologação.
4. Executar `node simulate-dispatch-cli.mjs --simulation-only <uuid-de-tenant-fictício>` **somente** em base isolada.
5. Executar testes de concorrência, recuperação e restauração também em PostgreSQL persistente; GitHub Actions + PGlite não substituem homologação real.
6. Não habilitar envio, webhook de produção, dados pessoais, credenciais privadas ou cobranças reais.

## Rollback

Sem mudar produção. A migração 016 é aditiva e versionada. Não apagar dados de consentimento, opt-out ou event ledger. Para reexecutar ensaios em homologação, restaurar snapshot isolado. Se o teste for interrompido, a transação reverte o contador e o status do job simultaneamente, impedindo resultado parcialmente simulado.
