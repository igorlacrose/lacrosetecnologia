# Ensaio transacional dos lembretes — VNext

**Modo obrigatório: homologação isolada, sem Meta, sem emissão e sem cobrança.**

O código deste pacote não implementa envio de WhatsApp. Ele permite verificar, com dados fictícios, quais tarefas da fila estão elegíveis **apenas na simulação**, bloqueadas ou vencidas. Não contém clientes Meta, métodos de envio, tokens de empresa, detalhes de atendimento ou interface para cobrar mensagens.

## Implementado

- Migração `015-whatsapp-reminder-rehearsal.sql`: trilha idempotente por `tenant + produto + agendamento + revisão + tipo`, com RLS e permissão somente para o papel isolado `lkz_vnext_reminder_bridge`.
- `reminder-rehearsal.mjs`: verifica até 50 tarefas por transação sob `FOR UPDATE OF j SKIP LOCKED` e devolve **somente contadores**. Requer tenant explícito.
- `rehearse-reminders.mjs`: CLI opt-in `node rehearse-reminders.mjs --dry-run <tenant-uuid>`, no banco PostgreSQL de homologação e sob usuário `lkz_vnext_reminder_runtime`, verificado por `assertReminderRole`.
- `GET /api/whatsapp/reminders/rehearsal?tenant=<uuid>`: resumo agregado com sessão válida e MFA. Nunca expõe números, histórico bruto ou identificadores de agendamentos.
- Painel WhatsApp: contagens diferenciadas de verificações, bloqueadas, expiradas e elegíveis na simulação.
- Testes automatizados em PGlite sobre reexecução, expiração, consentimento, revisão, RLS, MFA e separação de tenants.

## Decisões/limites

A simulação usa a janela de tolerância de **15 minutos** para avaliar tarefas vencidas. Em um ensaio, tarefas cuja janela expirou são marcadas `expired` e tarefas sem consentimento/revisão válida são marcadas `cancelled`. Isso altera **somente a fila de homologação**; não reverte as marcações automaticamente. A execução repetida usa a mesma chave, atualiza a última avaliação e incrementa o contador, mas **jamais marca `sent`**.

As decisões são: `blocked_appointment`, `blocked_consent`, `blocked_opt_out`, `blocked_policy`, `blocked_billing`, `expired` ou `dry_run_eligible`. A última é **hipotética**; não significa que templates, método de cobrança, limites ou API Meta estejam realmente homologados.

Enquanto `whatsapp_reminder_policies.enabled=false` (estado padrão e obrigatório), as simulações não resultam em `dry_run_eligible` em uso normal. O valor `monthly_message_limit` é apenas uma preferência. Não há controle financeiro real ou serviço de envio. **Não usar essa versão para cobrar ou enviar mensagens**.

## Implantação/teste sem Codex

1. Acompanhar e revisar os PRs encadeados #60–#65. Esta etapa depende das migrações 001–014 anteriores.
2. Preparar PostgreSQL **isolado de homologação**, backup e restauração antes de executar a migração 015. Nunca usar o Supabase institucional ou qualquer dado pessoal real.
3. Disponibilizar somente em Secret Manager `VNEXT_REMINDER_DATABASE_URL` para o login isolado já previsto no PR #62.
4. Aplicar migrações com o migrador versionado do VNext, executar a CLI **somente** com UUID de tenant fictício de homologação.
5. Executar `npm test` e testes negativos de acesso, isolamento, concorrência, retries, limite mensal e recuperação de banco após reinício.
6. Se o ensaio produzir estados `expired`/`cancelled`, restaurar snapshot na homologação isolada caso seja necessário repetir o mesmo cenário.

## Não implementado

- Transporte de envio de mensagens com Cloud API real, templates Meta, webhooks de entrega e retries pagos.
- Reserva de quota transacional para custos reais e faturamento Meta direto por empresa.
- Confirmar/reagendar horário via WhatsApp e sincronização efetiva com as agendas de BarbarOS/LibertyOS.
- Deploy/rodar cron real da simulação; servidor local ou GitHub CI **não equivalem** a hospedagem.

A homologação desses módulos permanece bloqueada por falta de ambiente/credenciais oficiais e acesso aos códigos-fonte das agendas em nuvem. Não ativar mensagens pagas nem fazer alterações de produção.
