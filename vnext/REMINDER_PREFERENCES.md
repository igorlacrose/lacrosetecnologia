# Preferências de lembretes por empresa — BarbarOS e LibertyOS

**Status:** somente código de homologação. Nenhuma conexão Meta, envio ou cobrança real foi ativada.

## Funcionalidade

No LKZ ADM VNext, em **WhatsApp → Configurar lembretes**, administradores MFA AAL2 de cada empresa podem selecionar:

- 24h e 2h antes do agendamento;
- somente 24h;
- somente 2h;
- teto mensal **desejado** de 0 a 10.000 mensagens.

A opção padrão é 24h e 2h; teto 0 (nenhuma mensagem). O banco registra as preferências por tenant, registra auditoria e deixa `enabled=false` **em todas as alterações**. Não existe API pública para habilitar envio pago.

O receptor de agenda passa a consultar `offsets_minutes` da empresa antes de criar lembretes. Em ausência de configuração, usa os dois horários padrão. A confirmação de agendamento continua uma tarefa separada, sujeita a consentimento. Reagendamentos invalidam tarefas anteriores por revisão, sem ativar envio.

### O que isto NÃO faz

- O teto mensal é apenas uma **preferência armazenada**. Não existe worker de envio nem quota de mensagens cobráveis. Não considerar esse campo como garantia de despesa máxima perante a Meta.
- A criação de tarefa `pending` não significa agendamento de mensagem na Meta: nenhum token Meta é usado e nenhuma Cloud API é chamada.
- Alterar preferências não recalcula tarefas anteriores; elas são reconstruídas no próximo evento de reagendamento ou no futuro processo de migração/homologação.
- O administrador não pode informar `enabled=true` via API e não pode alterar a cobrança direta do cliente.

## Segurança

- A migração `014-whatsapp-reminder-preferences.sql` implementa `save_reminder_preferences` com MFA AAL2, associação admin ativa e tenant explícito, validação SQL das opções e registro em auditoria.
- A API `POST /api/whatsapp/reminders?tenant=<uuid>` recebe somente `offsets_minutes` e `monthly_message_limit`, sem aceitar campos extras.
- `GET /api/whatsapp/reminders?tenant=<uuid>` continua restrito à sessão e RLS.
- Viewer, outros tenants, AAL1 e opções inválidas não modificam configuração.
- Nenhuma escrita em Supabase de produção; nenhuma chave privada incorporada ao frontend.

## Homologação antes de permitir envio

Exige conta Meta própria da empresa e faturamento direto verificado, consentimento, opt-out, templates aprovados, worker com quota transacional por tenant, idempotência de mensagens, controle de retries, expiração de lembretes e testes de integração com as agendas reais de BarbarOS e LibertyOS.

A configuração visual e o contrato de eventos estão prontos para incorporação futura aos próprios SaaS, assim que seus repositórios forem localizados.

### Rollback

Mantenha a migração e dados em uma base de homologação isolada. Em caso de regressão, suspenda a API de preferências e restaure a branch/checkpoint anterior sem limpar consentimentos revogados. O migrador por checksum impede reaplicações incompatíveis; faça snapshot verificável antes de alterar o banco.

