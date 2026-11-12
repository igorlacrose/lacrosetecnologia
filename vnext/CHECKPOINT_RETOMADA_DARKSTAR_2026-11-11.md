# CHECKPOINT — retomada pelo chat na Darkstar

**Preparado a partir do comando enviado em:** 2026-11-11, 21h29 (Bahia/BRT), equivalente a 2026-11-12, 00h29 UTC.  
**Comando de retomada:** `continue já de Darkstar`.  
**Execução interrompida por solicitação:** não iniciar nova implementação até esse comando.

## Contexto e limites

O usuário está utilizando **esta mesma conversa do ChatGPT** e quer continuar nela ao abrir a Darkstar. O trabalho nesta fase foi feito com o **GitHub conectado ao ChatGPT**, sem Codex e sem precisar dos arquivos locais da Darkstar/Osiris.

É possível continuar por chamadas GitHub e CI sem Codex. Isso **não** garante execução assíncrona ou literalmente infinita: cada resposta/rodada tem duração e limites. Trabalhar pelo máximo de tarefas viáveis e registrar checkpoints; nunca prometer processamento em segundo plano.

Segurança obrigatória: não modificar `main`, Supabase/produção, DNS, chaves, pagamentos ou dados de clientes; não publicar nem enviar mensagens reais sem homologação e autorização separada. Preferir branch → testes → PR → revisão, com reversão segura.

## Estado do GitHub — confirmado nesta conversa

Repositório `igorlacrose/lacrosetecnologia`.

| PR | Base | Implementado em código | Estado |
|---|---|---|---|
| [#60](https://github.com/igorlacrose/lacrosetecnologia/pull/60) | `main` | VNext: fundação CRM, banco/Asaas Sandbox simulado | draft, aberto |
| [#61](https://github.com/igorlacrose/lacrosetecnologia/pull/61) | `feat/lkz-adm-vnext-20261111` | Conexão WhatsApp por tenant / Meta Embedded Signup / faturamento próprio | draft, aberto |
| [#62](https://github.com/igorlacrose/lacrosetecnologia/pull/62) | `feat/vnext-meta-whatsapp-tenants-20261111` | Serviço de agendamentos, lembretes 24h/2h, HMAC, opt-out | draft, aberto |
| [#63](https://github.com/igorlacrose/lacrosetecnologia/pull/63) | `feat/vnext-appointment-reminders-20261111` | Webhook Meta inbound assinado e pedido PARAR/SAIR | draft, aberto |
| [#64](https://github.com/igorlacrose/lacrosetecnologia/pull/64) | `feat/vnext-meta-inbound-optout-20261111` | Preferências 24h/2h e teto desejado por empresa; dispatch desativado | draft, aberto |
| [#65](https://github.com/igorlacrose/lacrosetecnologia/pull/65) | `feat/vnext-reminder-tenant-settings-20261111` | Ensaio transacional de fila com auditoria e cancelamento/expiração | draft, aberto |

Heads consultadas antes de criar este documento:
- #60 `af291be29be741e7dbc437e48449e825bd5f635b`
- #61 `26cb41e4f5bbb69c87181091d5f6e4d15a4c4c3a`
- #62 `6b999148fbe2499d2814ec2f4802b7614e273d1a`
- #63 `1c7a949c10af0ddda3185f18007ab3e5e5c56f53`
- #64 `0555fcb8c855204e4301c9d10cf675b7fea7089c`
- #65 `fa2bdf7795f7d55105afbc06508da82a10510565` (antes deste checkpoint).

Em consulta GitHub, todos estavam abertos, drafts, mergeable e empilhados. CI da cabeça pré-checkpoint do #65: **success**, workflow [43123120189](https://github.com/igorlacrose/lacrosetecnologia/actions/runs/43123120189). Isso comprova a suíte automatizada no runner, **não** homologação real nem produção.

## Componentes e pontos de entrada já confirmados

- `vnext/db/010-whatsapp-tenant-accounts.sql`
- `vnext/db/011-whatsapp-billing-report.sql`
- `vnext/db/012-whatsapp-appointment-reminders.sql`
- `vnext/db/013-meta-inbound-optouts.sql`
- `vnext/db/014-whatsapp-reminder-preferences.sql`
- `vnext/db/015-whatsapp-reminder-rehearsal.sql`
- `vnext/meta-whatsapp.mjs` e `vnext/web/whatsapp-signup.mjs`
- `vnext/appointment-reminders.mjs` e `vnext/appointment-sender.mjs`
- `vnext/meta-inbound.mjs` e `vnext/meta-inbound-listener.mjs`
- `vnext/reminder-rehearsal.mjs`, `vnext/rehearse-reminders.mjs`
- `vnext/workspace.mjs`, `vnext/web/app.mjs`, `vnext/staging.mjs`
- `vnext/preview-db.mjs`, `vnext/staging-db.mjs`
- `vnext/WHATSAPP_META.md`, `vnext/REMINDERS_SAAS.md`, `vnext/META_INBOUND_OPT_OUT.md`, `vnext/REMINDER_PREFERENCES.md`, `vnext/REMINDER_REHEARSAL.md`.
- CI: `.github/workflows/site-check.yml`.

## Implementado versus pendente

**Implementado e testado com fixtures:** isolamento por tenant, conta Meta representada no cadastro, Embedded Signup preparado para homologação, token cifrado, callback de opt-out, assinatura HMAC entre agendas e backend, fila de confirmação e 24h/2h, idempotência/revisão, cancelamentos, preferências por empresa, auditoria/diagnóstico de fila, testes de acesso e MFA simulado.

**Não feito:** conexão Meta real, verificação de cobrança direta do cliente, templates reais aprovados, worker de envio Cloud API, confirmações/reagendamentos por mensagem, integração com agendas reais dos apps, eventos de entrega, autenticação Supabase real homologada, teste em PostgreSQL persistente hospedado, implantação ou migração de produção.

**BarbarOS e LibertyOS:** buscas realizadas em repositórios acessíveis pelo GitHub conectado não localizaram repositórios próprios; não declarar os aplicativos integrados sem localizar e ler seu código real. As referências de produtos no VNext ainda são catálogo/contrato, não serviços completos hospedados.

## Quando o usuário escrever `continue já de Darkstar`

1. Retomar **nesta conversa**, confirmar o estado/heads dos PRs e branches no GitHub (podem ter mudado), checar CI e divergências antes de editar.
2. Ler arquivos originais completos que serão alterados. Não refazer mudanças já implementadas. Preservar integrações e layout aprovado.
3. Revisar os módulos WhatsApp existentes para vulnerabilidades/regressões (RLS, SECURITY DEFINER, MFA, separação de papéis, replay, nonce, exposição de tokens, deadlocks, consentimento, timing e idempotência).
4. A próxima tarefa independente natural é preparar um **worker transacional SIMULADO** com claims/leases, idempotência e teto mensal exercitado por fixture, sem chamadas Meta, sem credenciais privadas e sem ativar nenhum envio. Revisar a necessidade de novas migrações e compatibilidade com a fila anterior.
5. Evoluir testes de integração e concorrência no GitHub Actions. Tratar falhas da CI como bloqueios reais, não ocultar erros.
6. Reavaliar acesso aos códigos de BarbarOS/LibertyOS e ambiente cloud; se não estiverem disponíveis, manter adaptadores prontos e registrar bloqueio em vez de inventar repositórios.
7. Avançar continuamente nas demais tarefas de desenvolvimento seguras, com novos PRs sobre a head mais recente e checkpoints. Não mexer em produção, cobrança, publicação, DNS, Meta real ou Supabase institucional sem autorização separada.
8. No fim da rodada, informar apenas resultados executados, links, testes reais versus simulados e bloqueios.

## Precisão e proteção

- O uso de Darkstar é somente o dispositivo de acesso à conversa; não implica acesso automático a arquivos locais.
- Não utilizar Codex enquanto o usuário pedir continuidade sem consumo de franquia.
- Os PRs em draft não foram incorporados à `main`, e o código em branch **não é um aplicativo em operação**.
- A configuração de teto mensal dos PRs ainda é um desejo do usuário, não quota efetiva cobrável. Nenhum envio pago deve ser acionado.
- Dados pessoais e chaves de API não podem constar em commits, logs, URLs, testes ou frontend.
- A autorização geral do usuário cobre alterações reversíveis em desenvolvimento; produção, contas reais, integrações pagas, migrações destrutivas e compras continuam fora do escopo.

**Não começar a próxima implementação durante a preparação deste checkpoint; aguardar o comando exato de retomada.**
