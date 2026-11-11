# Webhook de entrada da Meta — cancelamento de lembretes

**Status: homologação isolada / integração real Meta NÃO habilitada.** Código de backend sem chamadas pagas, sem disparo e sem dados de clientes reais.

## Função

O receptor `meta-inbound.mjs` aceita eventos oficiais da WhatsApp Cloud API, valida `X-Hub-Signature-256` com HMAC-SHA256 sobre **o corpo bruto**, confere se o número pertence a uma conta WABA registrada e trata somente pedidos **explícitos** de parar lembretes:

`PARAR`, `SAIR`, `STOP`, `UNSUBSCRIBE`, `CANCELAR NOTIFICAÇÕES`, `NÃO RECEBER MENSAGENS` e `NÃO QUERO MAIS MENSAGENS`.

Ele **não interpreta** "cancelar meu horário" como opt-out (isso precisa seguir para o fluxo de reagendamento/cancelamento da agenda, ainda não conectado ao WhatsApp). Não responde automaticamente, não altera a cobrança Meta, não ativa conexões e não realiza nenhuma chamada de envio.

### Segurança / dados

- GET de verificação: `hub.mode=subscribe`, `hub.verify_token` exato e `hub.challenge` numérico. Nenhuma sessão administrativa fica exposta.
- POST de evento: somente JSON até 64 KiB, assinatura Meta obrigatória, comparação em tempo constante, WABA e número conferidos contra a conta da empresa; mensagens não reconhecidas são ignoradas sem efeito.
- Identidade do tenant **derivada do WABA + ID do número no banco**, nunca do corpo de uma mensagem ou parâmetro de query.
- Apenas grava `meta_message_id`, número de conta de destino e HMAC do remetente com segredo do backend em `whatsapp_meta_optout_events`. Texto e telefone original **não são persistidos nem registrados em logs**.
- Evento repetido é ignorado pelo ledger idempotente. A transação insere opt-out, cancela jobs pendentes de BarbarOS e LibertyOS **apenas do tenant identificado**, e remove telefone cifrado/consentimento dos agendamentos.
- Retirada de consentimento independe de status financeiro e de habilitação da conta Meta.
- O processo utiliza exclusivamente o banco de homologação com o papel `lkz_vnext_reminder_runtime` e permissão efetiva `lkz_vnext_reminder_bridge`. Não acessa tokens da Meta, créditos, Asaas nem dados do CRM.

### Instalação em homologação

1. Aplicar **somente em banco isolado** a migração `013-meta-inbound-optouts.sql` após as anteriores (nunca em Supabase institucional sem validação).
2. Guardar em um Secret Manager:
   - `VNEXT_REMINDER_DATABASE_URL`: conexão isolada sob papel de ingestão de lembretes.
   - `VNEXT_REMINDER_HASH_PEPPER`: mesmo pepper do receptor de agendas, guardado e restaurável.
   - `VNEXT_META_APP_SECRET`: segredo do aplicativo Meta, exclusivamente no servidor.
   - `VNEXT_META_WEBHOOK_VERIFY_TOKEN`: token secreto de 24+ caracteres, diferente de App Secret, cadastrado no callback da Meta.
3. Executar `node meta-inbound-listener.mjs`. O processo escuta **somente** `127.0.0.1:4178`, sem rotas de painel. Publicar exclusivamente por proxy HTTPS de homologação previamente autorizado apontando `/integrations/meta-whatsapp` para a porta local e sobrescrevendo o header Host com `127.0.0.1:4178`. O proxy deve preservar o **corpo exato** e o header `X-Hub-Signature-256`.
4. Configurar o callback e assinar os eventos `messages` da WABA somente após aprovação de aplicativo/permissões. Executar testes de assinatura inválida, replay, WABA não vinculada, tenant cruzado, STOP válido, falha de banco e reinício.
5. Garantir backups/rollback testados, monitoramento sem PII, retenção de opt-outs e revisão LGPD.

**Pendente:** Meta Tech Provider/App Review e webhook real, processamento de confirmação/reagendamento, templates, controle de custos, worker de envio, homologação com sistemas e banco PostgreSQL persistente. A Cloud API só deve enviar mensagens com templates aprovados e consentimento válido, segundo as regras oficiais Meta.

### Rollback

Parar o listener dedicado e remover a rota do proxy de homologação, preservando o ledger de opt-outs e filas canceladas. Não reabrir envio automaticamente e não apagar consentimentos revogados. Nenhuma alteração foi feita na produção.

Referências:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview
- https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/
- https://business.whatsapp.com/policy/preview?lang=pt_BR
