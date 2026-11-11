# Serviço de lembretes — BarbarOS e LibertyOS

**Situação em 11/11/2026:** código implementado em branch de desenvolvimento, com testes simulados. **Não foi instalado, publicado nem conectado a agendas reais.** Não consome Codex ou recursos pagos de mensagens.

## Contrato entre os SaaS e o LKZ ADM VNext

O BarbarOS e o LibertyOS devem manter suas agendas operacionais em bancos isolados por produto. Cada backend envia eventos ao endpoint HTTPS `POST /integrations/appointments` com **uma credencial de assinatura HMAC exclusiva**, amarrada a `sourceId + tenantId + product` no Secret Manager do receptor. O tenant nunca é aceito de um campo de formulário do visitante.

O adaptador `appointment-sender.mjs` cria a assinatura e solicita a transmissão. A referência `eventId` deve ser gerada e preservada pelo sistema de origem (outbox transacional): **repetir sempre o mesmo evento e o mesmo corpo ao retentar**. `revision` cresce monotonicamente para impedir que eventos atrasados reabram um horário cancelado.

Exemplo estrutural com dados fictícios (não é uma requisição pronta para produção):

```json
{
  "eventId": "00000000-0000-4000-8000-000000000901",
  "type": "booked",
  "appointmentId": "agenda_123",
  "revision": 1,
  "startsAt": "2026-11-14T14:00:00-03:00",
  "timezone": "America/Bahia",
  "recipient": "+5573999990000",
  "consent": {
    "granted": true,
    "at": "2026-11-11T22:00:00-03:00",
    "source": "online_booking"
  }
}
```

Eventos suportados: `booked`, `rescheduled`, `cancelled`, `opted_out`. Para cancelamento informe `eventId`, `appointmentId`, `revision` e `type`. Para opt-out informe `eventId`, `type=opted_out`, `recipient` e `source` (`booking_platform`, `whatsapp_reply` ou `staff_recorded`). O módulo de recebimento de respostas da Meta **ainda não existe**; o evento `opted_out` só funciona se um backend autorizado o transmitir.

**Assinatura:** `HMAC-SHA256(secret, timestampUnixSegundos + "." + corpoJSONExato)`, hexadecimal minúsculo, nos headers `x-lkz-source-id`, `x-lkz-timestamp` e `x-lkz-signature`. Um `eventId` idêntico e conteúdo idêntico devolve `duplicate`; mesmo ID e conteúdo diferente devolve conflito. O endpoint rejeita assinaturas expiradas, corpo maior que 4 KiB, fontes desconhecidas e excesso de 60 eventos por minuto por empresa/produto. As respostas nunca incluem telefone, token, segredo ou dados clínicos.

## Comportamento implementado

- Cria agendamento e fila transacional de **confirmação**, **24 horas** e **2 horas antes** (as duas últimas somente se ainda estiverem no futuro).
- Reagendar cancela jobs anteriores e agenda novos pela revisão mais recente.
- Cancelar não apaga histórico da fila: marca jobs antigos como cancelados e preserva tombstone da revisão, impedindo ressuscitação por evento atrasado.
- Sem consentimento válido não agenda notificações. A retirada do consentimento registra opt-out por hash com segredo do backend, cancela pendências da empresa e bloqueia novas tentativas até futura política de reconsentimento revisada.
- Destinatário é armazenado em **AES-256-GCM**, com nonce aleatório, e nunca é retornado pela UI.
- No painel LKZ ADM aparecem **somente contagens agregadas** por tenant (agendamentos ativos, jobs pendentes e cancelados), sob sessão válida/MFA.
- `inspectDueReminders()` é exclusivamente **dry-run**: não envia, não marca mensagem como enviada e ainda exige política habilitada, consentimento, conta Meta verificada, faturamento direto e janela temporal válida. Isso não é um serviço de envio em produção.
- Não há vínculo com conta Meta nem com a linha de crédito da Lacrose no contrato da agenda. A assinatura SaaS segue separada no Asaas.

## Infraestrutura necessária para homologação

- Migração nova `vnext/db/012-whatsapp-appointment-reminders.sql`, aplicada somente após backup/restauração em PostgreSQL **isolado** (seguindo o migrador e as migrações 001–011 do VNext).
- Login dedicado `lkz_vnext_reminder_runtime` sem superuser, bypass RLS, acesso a outros roles ou propriedade de schemas; associar somente a `lkz_vnext_reminder_bridge`, com possibilidade de `SET ROLE`. A autorização é validada no startup por `assertReminderRole`.
- Secrets em runtime protegidos, nunca no frontend/Git/URL:
  - `VNEXT_REMINDER_DATABASE_URL` — URL de PostgreSQL homologado com login dedicado.
  - `VNEXT_REMINDER_SOURCES_JSON` — registro de `[{"id":"UUID","tenant":"UUID","product":"barbaros|libertyos","secret":"CHAVE_PROTEGIDA"}]`, alimentado somente por Secret Manager.
  - `VNEXT_REMINDER_ENCRYPTION_KEY` — 32 bytes aleatórios em hex.
  - `VNEXT_REMINDER_HASH_PEPPER` — segredo aleatório independente, pelo menos 32 caracteres.
- Configuração incompleta impede inicialização. Sem as quatro variáveis, a rota externa continua indisponível.
- Domínio HTTPS de homologação, gateway/proxy com limites de payload e proteção de abuso, backup recuperável e política LGPD. Não usar banco institucional nem dados reais em testes.
- **Não localizaram-se repositórios separados de BarbarOS e LibertyOS no GitHub conectado nesta sessão.** Portanto o adaptador foi desenvolvido como contrato reutilizável, mas sua instalação nos dois códigos das agendas depende de localizar/abrir os projetos que estão sendo desenvolvidos na nuvem.

## O que continua bloqueado

1. Não existe worker de envio real com Cloud API, nem fila de retries + confirmação de status de entrega.
2. Não existe processamento das respostas por webhook assinado da Meta nem integração com botões confirmar/reagendar.
3. Falta aprovação do Tech Provider, ligação das contas dos clientes, verificação independente do método de pagamento direto na Meta e templates aprovados por WABA.
4. As agendas reais dos dois sistemas precisam publicar eventos com outbox durável, consentimento documentado, cancelamento/reagendamento e testes em ambiente isolado.
5. A interface ainda não habilita políticas ou limites de disparo porque os itens acima precisam ser homologados.

**Não ativar mensagens de produção por SQL manual ou por alteração de flag no frontend.**

### Testes e rollback

CI: `vnext/test/reminders.test.mjs` e demais testes VNext, com PostgreSQL/PGlite e Meta simulada. Validar também em PostgreSQL 17 (destino real a confirmar) e com horários próximos, concorrência e serviços parados. São testes locais automatizados, **não testes reais de agendamento dos apps**.

Rollback seguro: desabilitar/remover as quatro variáveis de runtime, parar o receptor e reverter o PR sem tocar na produção. Na homologação, preservar o banco com a migração 012 e restaurar um snapshot validado em ambiente separado; não apagar logs de opt-out ou consentimento sem política de retenção. O migrador exige compatibilidade dos checksums de migração.
