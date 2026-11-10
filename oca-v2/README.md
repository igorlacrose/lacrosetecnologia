# OCA Conversational v2 — checkpoint de homologação

Implementação em branch, **não deployada**. O motor de qualificação não depende de uma API paga. Ele usa interpretação determinística contextual limitada, sem alegar inteligência generativa.

## Arquivos
- ../supabase/functions/_shared/oca-qualification.mjs: motor puro e estado de conversa
- qualification.test.mjs: cenários de regressão (Node com node --test)
- ../supabase/functions/oca-converse/index.ts: endpoint público isolado para start/message, ainda não publicado
- schema-draft.sql: esquema sugerido, **não executar diretamente em produção**

## Contrato do endpoint (quando migrado e implantado em homologação)
- POST {"action":"start"} => token aleatório de sessão, validade e saudação
- POST {"action":"message","sessionToken":"<token>","requestId":"<UUID>","message":"<texto>"} => resposta e status de revisão
- Estados comerciais, scores, preços, pagamento e autorização **nunca** são fornecidos pelo navegador.
- A função usa hash do token e guarda todo o estado exclusivamente no servidor.

## Antes de ativar
1. Criar migração oficial com a CLI e aplicar apenas no ambiente de teste, após backup.
2. Validar grants, RLS sem políticas para cliente, operação exclusiva do service_role e impossibilidade de acesso via anon/authenticated.
3. Testar endpoint com Deno/Supabase local, incluindo rate limits, concorrência, duplicação, isolamento, expiração e comportamento de erro.
4. Garantir política de exclusão de sessões vencidas, minimização de dados, LGPD e revisão de aviso de privacidade.
5. Implementar defesa antiabuso para origens não confiáveis: Origin/CORS NÃO é autenticação; confirmar IP do proxy, adicionar Turnstile ou equivalente quando justificado.
6. Integrar com CRM somente após teste de transação e controle de idempotência; este endpoint NÃO grava leads nem executa vendas.
7. Manter agent-lead atual ativo até validação de substituição, com rollback planejado.

## Testes
Na raiz do repo: node --test oca-v2/qualification.test.mjs

## Limitações deliberadas
- Sem interpretação por modelo de IA; haverá uma camada NLP/LLM opcional após avaliação de custos e segurança.
- Sem negociação, cobrança, WhatsApp, provisionamento ou geração de contratos.
- Não há dashboard do v2 conectado ao novo estado até projetar a camada de consulta com autenticação e mínimo privilégio.
