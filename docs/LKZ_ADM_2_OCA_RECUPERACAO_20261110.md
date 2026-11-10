# LKZ ADM 2.0 + OCA — Recuperação segura
Referência: 2026-11-10. Status: auditoria inicial, sem homologação.

## Preservação
- Construir nova interface em admin-v2/, sem substituir admin/ antes da homologação.
- Preservar site, leads, contatos, conversas, mensagens, CRM, integrações e autenticação.
- Branch de trabalho: fix/lkz-adm-recuperacao-segura-20261110.
- Branch de backup: backup/lkz-adm-estado-github-20261110.
- Não executar alteração destrutiva, deploy, cobrança ou provisionamento real sem aprovação.
- Backup Git não substitui backup consistente do banco.

## Diagnóstico em código e no Supabase
1. O site classifica intenções por expressões regulares e pergunta campos predeterminados; o fluxo OCA encerra com problema e contato e solicita revisão humana.
2. A função pública agent-lead aceita score, status e completed no corpo enviado pelo navegador. Esses valores nunca podem autorizar proposta, pagamento ou provisionamento.
3. A função possui limites de requisições e payload; verificação de Origin/CORS não é autenticação.
4. admin/styles.css e admin/operacao.css têm regras sobrepostas. Parte do menu anterior desapareceu, embora ainda haja funções.
5. As políticas RLS para contatos, leads, conversas e mensagens exigem perfil autorizado + MFA AAL2 para leitura. Avaliar todas as RPCs e suas permissões antes de novas operações.
6. O Security Advisor sinaliza proteção contra senhas vazadas desativada. Corrigir via configuração apropriada de Auth.
7. Não executar acessos comerciais com service role no navegador.

## Arquitetura alvo
Site -> endpoint de conversa no backend -> interpretação e extração estruturada -> regras determinísticas e catálogo versionado -> eventos auditáveis -> CRM/OCA -> fila de operações autorizadas -> gateway/provisionamento.
LKZ ADM v2 -> Auth + MFA -> RLS e APIs com autorização server-side -> indicadores reais, CRM e operações idempotentes.

Modelo de IA propõe dados/ações; backend valida tudo. IA não executa consultas financeiras ou SQL arbitrário.

## Etapas
- P0: auditoria, backups, autenticação, MFA, RLS, RPCs, controles antiabuso e segredos.
- P1: painel novo com navegação responsiva, consultas reais, clientes, leads e atendimentos sem operações simuladas.
- P2: OCA v2 com memória contextual, perguntas não repetitivas, prompt versionado, catálogo real e aprovação humana em exceções.
- P3: fluxo lead -> proposta -> aprovação -> cobrança em sandbox -> confirmação validada -> provisionamento em sandbox.
- P4: financeiro SaaS, licenciamento, logs, backups e restauração.
- P5: revisão de segurança, aceite, publicação gradual e rollback.

## Critérios de aceitação
- Zero valores hardcoded de preço: usar catálogo publicado com histórico e revisão.
- Nenhum pagamento ativado com informação do cliente sem validação do servidor/gateway.
- Logs sem senhas, tokens ou informações desnecessárias; request_id e idempotency_key para ações.
- Separação master/admin/comercial/consulta com autorização em banco/backend, não só UI.
- Tabelas e conversas com paginação; indicador apenas de escopo realmente consultado.
- Testes de login, MFA, conta suspensa, usuário sem acesso, XSS, dupla operação, webhooks duplicados, gateway indisponível, restore e rollback.
- Testes de atendimento: simples, complexo, mudança de intenção, correção de informação, cliente sem contato, preço fora de catálogo, encaminhamento a humano, tentativas de manipulação do assistente.
- Nenhum módulo descrito como pronto sem execução e evidências de teste.

## Não incluído ainda
- IA em produção, cobrança real, assinaturas automáticas, provisionamento de software, módulos LibertyOS/BarbarOS e integrações de WhatsApp.
