# OCA — conhecimento comercial e comportamento (10/11/2026)

## Escopo implementado nesta versão
- Responder dúvidas sobre atividades reais da Lacrose Tecnologia: sites, sistemas e aplicativos sob medida, automação empresarial com IA, redes, infraestrutura e segurança de TI, consultoria e integrações possíveis.
- Atuação remota no Brasil; presencial em Jequié/BA, conforme disponibilidade.
- Responder perguntas sobre orçamento, prazo, WhatsApp e portfólio sem inventar datas, preços, integrações ativas ou compromissos.
- Diagnóstico por problema do cliente, segmento quando necessário, uma pergunta direcionada ao contexto e contato voluntário. Não exigir escala, impacto, urgência e localização para concluir.
- Capturar perguntas sobre produtos no meio da conversa sem perder o estágio do diagnóstico; aproveitar contatos que vierem junto da pergunta.
- Contexto simples entre turnos para perguntas de mensalidades e status.

## Catálogo comercial informado ao visitante
- LibertyOS: sistema para salões e clínicas de estética, **em desenvolvimento**.
- BarbarOS: sistema para barbearias, **em desenvolvimento**.
- Mensalidade de lançamento **planejada** para cada um: **R$ 129,00 por estabelecimento/mês**, sujeita a confirmação comercial antes de contratar.
- **Sem** cobrança, provisionamento, licença ou ativação automática neste momento.
- Para sites, automações e desenvolvimento personalizado, **não informar valor fixo**. Diagnóstico, conversa com Lacrose e orçamento humano.
- Não exibir preços de ERP, ISP, OCA, consultoria de TI ou qualquer outro serviço sem confirmação explícita.

## Arquitetura e limites
- assets/oca-advisor.js: regras e respostas curadas, executadas no navegador, sem chamada a API paga.
- app.js: fluxo de chat, histórico, captação existente no Supabase e UI.
- scripts/test_oca_advisor.cjs: testes de regressão. Rodar `node --test scripts/test_oca_advisor.cjs`.
- Esta implementação **não é modelo de linguagem generativo** e não executa vendas. Evitar divulgar como atendimento universal por IA.
- Estado enviado pelo cliente serve para registro comercial, não para autorizar pagamento ou provisionamento. Aprovações e operações críticas devem ser validadas no backend.
- Verificar LGPD, consentimento, minimização de dados e retenção antes de automatizar mensagens, cobranças e integrações externas.
- Não incluir chaves de API, tokens ou service role no frontend.

## Próxima evolução
- Migrar interpretação contextual para endpoint protegido no servidor com catálogo comercial versionado e regras de autorização, podendo integrar modelo de IA quando houver orçamento e validação do fornecedor.
- Criar testes de conversação com linguagem livre, mudança de assunto, ambiguidades, objeções e casos adversariais.
- Implantar integração real com CRM/painel e aprovação humana; produtos homologados poderão ter provisionamento após confirmação confiável de pagamento.
- Acrescentar outros produtos ao catálogo **somente quando aprovados e entregáveis**.

## Critérios de aceite desta versão
- Valores exatos, sem divulgar site a R$ 350.
- Pergunta sobre automação de e-mails de uma clínica estética leva a pergunta sobre tipos de e-mails, não sobre número de PCs, urgência nem Wi-Fi.
- Perguntas de serviços são respondidas sem preencher `lead.problem` indevidamente.
- Pergunta por LibertyOS, seguida de 'E o BarbarOS?' usa contexto da mensalidade e sinaliza desenvolvimento.
- Pedir atendimento humano, fornecer contato ou recusar contato não é tratado como campo inválido.
- CI verde antes de mesclar; validação manual de navegador e gravação em Supabase após publicar.
