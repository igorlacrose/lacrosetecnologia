# Checkpoint — continuidade pelo ChatGPT na Darkstar (12/11/2026)

## Escopo e decisão

O usuário retomou **esta mesma conversa**, solicitou continuar **sem Codex**, sem depender dos arquivos locais e com autonomia para mudanças reversíveis em desenvolvimento. Trabalho realizado com GitHub conectado + GitHub Actions. Esta conversa não é um processo em segundo plano: novas rodadas usam os checkpoints do repositório.

Nenhum deploy, DNS, mudança de produção, cobrança, ativação Meta, conta real ou dado de cliente foi alterado.

## PRs empilhados

| PR | Conteúdo | Base |
|---|---|---|
| [#60](https://github.com/igorlacrose/lacrosetecnologia/pull/60) | LKZ ADM VNext CRM, Asaas Sandbox simulado, fundação multiempresa | main |
| [#61](https://github.com/igorlacrose/lacrosetecnologia/pull/61) | Conexão Meta por tenant e faturamento próprio ainda não homologado | #60 |
| [#62](https://github.com/igorlacrose/lacrosetecnologia/pull/62) | Agendas HMAC, lembretes 24h/2h, revisões e opt-out | #61 |
| [#63](https://github.com/igorlacrose/lacrosetecnologia/pull/63) | Webhook Meta assinado e cancelamento de avisos | #62 |
| [#64](https://github.com/igorlacrose/lacrosetecnologia/pull/64) | Preferências por empresa, envios sempre desativados | #63 |
| [#65](https://github.com/igorlacrose/lacrosetecnologia/pull/65) | Ensaio de elegibilidade/expiração, sem envio | #64 |
| [#66](https://github.com/igorlacrose/lacrosetecnologia/pull/66) | Simulador de despacho com quota UTC por tenant, idempotência e rollback | #65 |
| [#67](https://github.com/igorlacrose/lacrosetecnologia/pull/67) | Gate PostgreSQL 17.11 real e teste integrado dos dois SaaS com opt-out Meta fictício | #66 |

**Todos os PRs estão em draft, não mesclados à main.** Validar heads e mergeability novamente antes de qualquer edição futura.

## Entrega nova desta rodada

### PR #66

- `vnext/db/016-whatsapp-simulated-dispatch.sql`: ledger de despachos fictícios e contador mensal UTC, sem dados pessoais em claro, protegidos por RLS.
- `vnext/simulated-dispatch.mjs`: transação com reserva de cota, exclusão de jobs já simulados, bloqueios de consentimento/MFA/Meta e job `pending → simulated`. **Jamais envia e nunca marca `sent`**.
- `vnext/simulate-dispatch-cli.mjs`: execução somente com `--simulation-only` em base homologada e login de menor privilégio.
- `vnext/test/simulated-dispatch.test.mjs`: quota, repetição, isolamento, concorrência, rollback após falha injetada, RLS e MFA.
- `vnext/SIMULATED_DISPATCH.md`: operação, custos fictícios e limites.
- CI site completa **aprovada** no commit `a771be50e553cc65b6bae6afbdbca15ac52bddfd` — [GitHub Actions #43128915828](https://github.com/igorlacrose/lacrosetecnologia/actions/runs/43128915828).

### PR #67

- `vnext/pg17-staging.smoke.mjs`: teste com PostgreSQL 17 real, 16 migrações aplicadas e reaplicadas (checksum), papéis exclusivos sem RLS bypass, reserva e idempotência de quota, acesso negado entre empresas.
- Teste adicional end-to-end de **eventos HMAC de BarbarOS/LibertyOS → banco PostgreSQL 17 → STOP simulado da Meta → cancelamento só do tenant correto**. Não são sistemas reais integrados: os eventos são sintéticos, produzidos pelo teste.
- `.github/workflows/vnext-postgres17-smoke.yml`: serviço PostgreSQL 17.11 efêmero no runner, com senha fictícia fixa só de CI; nada acessa Supabase institucional.
- `vnext/POSTGRES17_CI_GATE.md`: documentação.
- Após corrigir o verificador estático do site (que proíbe marcadores locais em workflows), os dois gates passaram no commit `2cb04db35e568aceb9aac399d10f5e8fc9c0a666`:
  - [Site Production Check #43130273158](https://github.com/igorlacrose/lacrosetecnologia/actions/runs/43130273158)
  - [VNext PostgreSQL 17 Staging Smoke #43130273172](https://github.com/igorlacrose/lacrosetecnologia/actions/runs/43130273172)

A CI após inclusão deste próprio checkpoint deve ser verificada novamente.

## Itens ainda bloqueados ou incompletos

- **BarbarOS e LibertyOS:** nenhum repositório independente foi localizado entre os GitHub acessíveis, apesar de buscas. O adaptador e testes fictícios não provam integração às agendas reais.
- **Meta:** falta aprovação da modalidade de parceiro, App Review, conexão real, billing independente verificado, templates aprovados, webhooks reais e testes end-to-end com conta do cliente.
- **Envio real:** não existe worker Cloud API, nem fila de envio externa com leasing/retry/status, nem quota financeira por categoria. O simulador de cota é somente por *quantidade de mensagens fictícias*, **não por reais**.
- **Autenticação e faturamento:** Supabase Auth MFA real, Asaas Sandbox real e implantação em staging persistente externo precisam de homologação independente.
- Não há migração de produção, SMS, WhatsApp real, token privado de empresa nem conexão financeira efetivada.

## Regras de continuidade

1. Na próxima rodada, confirmar PRs, heads, CI, alterações concorrentes e backups antes de editar.
2. Preferir revisão de segurança profunda antes de novas funcionalidades em produção. Preservar todas as decisões, APIs, testes e layout existentes.
3. Continuar diretamente com ferramentas GitHub e Actions **sem Codex**, salvo instrução contrária; nenhuma integração real paga ou publicação sem autorização específica.
4. Ler os arquivos originais completos antes de corrigir. Não misturar a base institucional da Lacrose com staging descartável.
5. Proteger segredos, RLS, MFA, RBAC, isolamento de tenant, auditoria, consentimento, idempotência e LGPD.
6. Não declarar PR aberto como concluído em produção, nem CI verde como homologação externa.
7. Não repetir perguntas já respondidas e não prometer trabalho assíncrono fora desta sessão.

## Próximas frentes seguras

- Revisão e endurecimento de segurança nos PRs #60–#67, com testes negativos e permissões PostgreSQL.
- Contratos de integração e testes de resposta/entrega Meta com fixtures, mantendo envio real desabilitado.
- Análise dos componentes de OCA, CRM e Asaas Sandbox para tarefas independentes e reversíveis.
- Revisitar localização dos códigos de BarbarOS/LibertyOS nos projetos cloud acessíveis; não inventar repositórios.

**Este arquivo é um checkpoint de continuidade, não uma homologação de produção.**
