# OCA híbrido — conhecimento supervisionado e API de interpretação

**Status: código preparado em branch de revisão; nenhuma Edge Function, migração SQL, chave OpenAI ou cobrança foi ativada.**

## Escopo desta entrega

O OCA mantém o motor de respostas existente (`assets/oca-advisor.js`). Uma base adicional em `assets/oca-knowledge.js` contém respostas comerciais humanas aprovadas, exemplos versionados e correspondência local conservadora. Se o motor anterior e essa base não conseguirem responder a uma pergunta comercial genérica, `app.js` pode pedir a classificação de intenção à Edge Function `oca-interpret`. Somente um ID de categoria permitido retorna do modelo; a resposta final sempre vem do catálogo aprovado, nunca do texto livre gerado pelo modelo. Se API, chave, rede, orçamento ou classificação falharem, o diagnóstico existente continua.

**Não é treinamento de um modelo substituto** nem aprendizado autônomo. Nenhuma resposta gerada pelo GPT é usada para treinar outro modelo.

## Ciclo de aprendizado supervisionado

1. Identificar lacuna no atendimento por revisão autorizada de casos, sem exportar conversas pessoais.
2. Propor uma pergunta genérica e resposta comercial **sem dados de visitantes**.
3. Revisar exatidão e aderência ao catálogo real. Validar que projetos em desenvolvimento não são vendidos como prontos, que propostas sob medida não ganham preços inventados e que nenhuma autorização operacional fica com a IA.
4. Acrescentar a nova variação à base aprovada e casos aos testes de regressão.
5. Publicar via PR, aprovação humana, CI e revisão de regressão/privacidade. Só então a próxima versão pode reconhecer localmente a nova variação.

O objetivo de longo prazo é medir a taxa de resolução local, o custo por classificação e as perguntas não resolvidas **de forma agregada**. A interface de aprovação no LKZ ADM, análise agregada por tenant, templates versionados no banco e pipeline de promoção ainda não estão implementados. O processo atual de aprovação é via código revisado no GitHub.

## Controle de custo

- Modelo escolhido: `gpt-5.6-luna`, classificador JSON estruturado, `reasoning.effort=none`, `max_output_tokens=120` e `store:false`. Conferir acesso real no projeto OpenAI antes da ativação.
- Tarifa oficial consultada em 11/11/2026: entrada US$ 0,20 / 1 milhão de tokens e saída US$ 1,20 / 1 milhão (modo padrão, contexto curto), sujeito a mudanças.
- Cada consulta faz reserva **atômica e conservadora** de US$ 0,002, independentemente do consumo efetivo. Reservas não são devolvidas quando a rede falha.
- O banco bloqueia acima de **US$ 2,00 por mês UTC** para a única empresa inicial. O backend exige um limite configurado igual ou menor. Por exemplo, US$ 2 equivaleriam a R$ 11,17 usando câmbio de R$ 5,584, mas **não garantem teto absoluto de R$ 20 na fatura** devido a câmbio, impostos, mudanças de preço e outros usos da conta OpenAI.
- Não confundir reserva conservadora com fatura efetiva. O primeiro lançamento exige monitoramento da API e reconciliação do valor em reais, além de limite de uso do projeto na OpenAI.
- Os números de orçamento são inicialmente para **a Lacrose Tecnologia**, não para um SaaS multiempresa; isolamento por tenant exige esquema e limites próprios antes da comercialização.

## Configuração requerida (somente Supabase Secrets, nunca Git/frontend)

- `OPENAI_API_KEY`: chave de projeto dedicada, criada pela conta do usuário.
- `OCA_AI_ENABLED=true`: chave de ativação consciente, ausente por padrão.
- `OCA_AI_MONTHLY_BUDGET_MICRO_USD`: número inteiro entre 2000 e 2000000; 2000000 = US$ 2,00.
- `OCA_RATE_SECRET`: segredo aleatório do backend com pelo menos 32 caracteres.
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`: secrets existentes de runtime no backend, **nunca no cliente**.

Aplicar `supabase/sql/oca_ai_monthly_budget.sql` em ambiente isolado primeiro. Ele cria tabela privada com RLS e função pública executável **somente por service_role**. Nenhum dado bruto de conversa é persistido pelo classificador. O endpoint público verifica origem, tamanho, formato, dados sensíveis, limites por sessão/IP/global e orçamento transacional.

**IMPORTANTE:** Origin/CORS não constituem autenticação; cabeçalhos IP podem ser forjados fora de proxy confiável. A validação Turnstile e o bloqueio de replay foram preparados no código, mas **ainda dependem das chaves reais e de testes integrados antes de publicação**. O teto de US$ 2 limita o risco de consumo, não substitui proteção anti-abuso nem é garantia absoluta da fatura.

## Proteção anti-bot implementada na revisão de segurança (ainda não implantada)

O cliente usa `assets/oca-turnstile.js` e só aciona a API remota se o elemento `#ocaAiTurnstile` tiver uma **sitekey pública válida**. Enquanto `data-sitekey=""`, o modelo não recebe chamadas do site. O widget é carregado sob demanda; cada pergunta paga usa um token novo. O código cancela desafios pendentes no reset e ao trocar de assunto.

A Edge Function rejeita chamadas se `TURNSTILE_SECRET_KEY` estiver ausente. Após as verificações de entrada e rate limit, envia o token ao Siteverify via HTTPS com timeout e exige: `success=true`, `action=oca_interpret`, hostname exato `lacrosetecnologia.com.br` ou `www.lacrosetecnologia.com.br` e data de desafio recente. **Só depois** solicita a reserva financeira. O servidor não armazena nem registra token, segredo ou questão do visitante.

A migração acrescenta `lkz_adm_private.oca_ai_token_claims`: chave única de hash derivado de segredo privado, usada na mesma transação da reserva mensal para impedir cobranças duplicadas por replay simultâneo do mesmo desafio. As duas tabelas ficam privadas e com RLS. O rollback remove apenas a função de reserva, preservando os registros de auditoria.

### Configuração pendente antes da ativação

1. No Cloudflare Turnstile, criar widget para os dois hostnames oficiais; obter **sitekey pública** e **secret key privada**. Nunca publicar a secret key em código, dashboard aberto ou conversas.
2. Preencher a sitekey pública em `index.html` no atributo `data-sitekey` do widget. O site usa CSP restritiva liberando somente scripts/iframes do domínio oficial do Turnstile.
3. Definir `TURNSTILE_SECRET_KEY` nos Secrets da Edge Function. Não habilitar `OCA_AI_ENABLED` antes de configurar todas as variáveis e validar limites de custo.
4. Homologar com chave de teste do Turnstile em ambiente isolado e conferir que rejeição, replay, timeout e hostname incorreto **nunca alcançam a OpenAI**.
5. Confirmar no projeto OpenAI que o modelo `gpt-5.6-luna` é acessível, verificar o custo real por chamada e o limite financeiro. A reserva de US$ 2/mês não substitui a conciliação com a fatura real.
6. Executar testes de concorrência no PostgreSQL de homologação, teste de uso por cliente real, revisão LGPD, backup e plano de rollback. Só então liberar a integração paga.

Fontes: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/ e https://developers.cloudflare.com/turnstile/get-started/server-side-validation/.

## Homologação obrigatória

- Testar FAQ, variantes, erros de digitação, pedidos de projeto, perguntas genéricas, perguntas comerciais com contato e troca de assunto.
- Testar reset durante consulta e mensagens duplicadas; sem gravar perguntas sensíveis na API de classificação.
- Testar `OPENAI_API_KEY` ausente, modelo indisponível, timeout, rejeição por CPF/e-mail e orçamento esgotado: nada de cobrança adicional e retorno seguro ao fluxo atual.
- Testar concorrência de reservas (várias chamadas simultâneas), virada do mês UTC e revogação de EXECUTE para `anon` e `authenticated`.
- Conferir RLS, integridade dos dados do CRM, registros e logs sem segredos, backup/rollback e integridade do site em desktop/mobile.
- Testes atuais da CI são estáticos e locais; **não substituem a validação integrada com serviços reais**.
- A ativação de OpenAI e publicação da migração dependem de homologação, gastos controlados, revisão de política de privacidade/LGPD e proteção contra abuso.

## Reversão

- Frontend: reverter PR e o script de conhecimento, preservando `assets/oca-advisor.js` e o antigo fluxo.
- Backend: não implantar a Edge Function, ou definir `OCA_AI_ENABLED` como falso no secret manager.
- SQL: `supabase/sql/oca_ai_monthly_budget_rollback.sql` remove a RPC, mas **preserva a tabela financeira e reservas** para auditoria.

Referências oficiais: https://developers.openai.com/api/docs/models/gpt-5.6-luna e https://developers.openai.com/api/docs/guides/structured-outputs.
