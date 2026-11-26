# LKZ ADM VNext — WhatsApp oficial por empresa (Meta Tech Provider)

**Status: código em branch de homologação. NÃO conectado à Meta nem habilitado em produção.**

## Objetivo

BarbarOS e LibertyOS utilizarão o mesmo módulo administrativo de integração, com conta e número WhatsApp Business próprios **por tenant**. A Lacrose cobra a licença SaaS via Asaas. Mensagens Meta deverão ser faturadas **à empresa titular da conta de mensagens**, por meio de método de pagamento próprio cadastrado no WhatsApp Manager.

**Conectar um número NÃO transfere automaticamente a cobrança para o contratante.** O contratante deve manter uma conta Meta válida, configurar faturamento próprio e atender aos requisitos de elegibilidade. Não compartilhamos linha de crédito da Lacrose. O modelo de Tech Provider deve ser aprovado pela Meta; o comportamento de faturamento não pode ser inferido apenas de um ID de telefone. A evolução de contas WAAC/PMA divulgada em 16/06/2026 separa números das contas de mensagens/faturamento: por isso o esquema mantém `meta_phone_number_id`, `meta_waba_id` e `meta_messaging_account_id` separados (este último **não é confirmado nem preenchido automaticamente**).

## O que o código implementa agora

- Migração `010-whatsapp-tenant-accounts.sql`: conexões WABA por tenant, número único dentro da plataforma, token de integração **cifrado AES-256-GCM** (chave fora do banco), RLS e permissões distintas para UI, operador e bridge Meta. Nenhuma tabela é escrita no Supabase institucional.
- Migração `011-whatsapp-billing-report.sql`: operador administrador com MFA pode **informar** que cadastrou o pagamento na Meta. Isso produz `customer_reported`, com auditoria, **não** `verified` e **não** libera envio.
- `meta-whatsapp.mjs`: início do Embedded Signup Meta v4, nonce por usuário/tenant/expiração, troca do código OAuth **no servidor** (POST HTTPS, evitando segredo em URL), consulta de WABA e número diretamente na Graph API, token cifrado e persistência por backend independente. Número já vinculado a outro tenant é rejeitado.
- Rotas `/api/whatsapp`: listagem apenas de metadados permitidos por RLS, configuração pública, início/conclusão, relato de faturamento e leitura da política de lembretes **desativada**.
- Interface VNext: área WhatsApp com instruções, conectar via Embedded Signup quando a integração estiver configurada, exibição do estado do número e orientação para configurar o método de pagamento próprio.
- `staging.mjs`: a integração é **opt-in**. Qualquer configuração parcial impede a inicialização. Usa `lkz_vnext_meta_runtime`, separado do usuário web e dos três papéis do Asaas. O runtime deve ter RLS efetivo. Nenhuma chave em frontend, GitHub ou logs.

**Não foi implementado**: criação/gestão de template Meta, envio efetivo de mensagens, worker de lembretes, sincronização WAAC/PMA real, monitoramento de faturamento Meta ou atestação externa de cobrança. A conexão só chega a `awaiting_billing`; mesmo o relato do cliente não ativa WhatsApp.

## Pré-requisitos Meta e infraestrutura (NÃO criar sem autorização)

1. Inscrever a Lacrose no programa Meta Tech Provider, concluir verificação empresarial, App Review e permissões pertinentes, entre elas `business_management`, `whatsapp_business_management` e `whatsapp_business_messaging`, conforme modalidade/versão atual.
2. Criar o aplicativo Meta e a configuração do **Embedded Signup v4**. Configurar domínios e redirecionamentos HTTPS reais, restritos ao ambiente homologado; não usar wildcard.
3. Cada cliente conecta sua conta empresarial/WAAC e número pelo diálogo Meta. A empresa deve configurar faturamento **no seu Meta Business/WhatsApp Manager**. Não selecionar nem compartilhar linha de crédito da Lacrose.
4. Preparar PostgreSQL **isolado de homologação**, aplicando 010 e 011 por migrador existente com backup verificável. Criar login exclusivo `lkz_vnext_meta_runtime` com `NOINHERIT` e vínculo só com `lkz_vnext_meta_bridge`, sem privilégios gerais. Exemplo de concessão em **homologação isolada** pelo DBA: `GRANT lkz_vnext_meta_bridge TO lkz_vnext_meta_runtime;` e verificar as opções de associação PostgreSQL.
5. Fornecer secrets somente no gerenciador protegido de runtime:
   - `VNEXT_META_DATABASE_URL`: conexão à **base de homologação** usando login isolado de Meta.
   - `VNEXT_META_APP_ID`: identificador público numérico do aplicativo Meta.
   - `VNEXT_META_CONFIG_ID`: identificador público do Embedded Signup.
   - `VNEXT_META_APP_SECRET`: segredo Meta **somente servidor**.
   - `VNEXT_META_TOKEN_ENCRYPTION_KEY`: 32 bytes aleatórios, **hexadecimal de 64 caracteres**, fora do Git, com backup e rotação planejada.
   - `VNEXT_META_GRAPH_VERSION`: versão da Graph API homologada (ex. `v26.0`, confirmar suporte da conta).
6. Homologar a troca de código OAuth por POST com a versão atual da Graph API, a lista `/{WABA-ID}/phone_numbers`, a titularidade da conta, o tempo limite e a revogação. O token criptografado é altamente sensível; rotação da chave e recuperação de backup exigem processo separado.
7. **Verificação financeira real:** a Meta não fornece garantia universal de faturamento direto por número apenas por meio do sucesso do OAuth. Revisar na conta do cliente a titularidade da conta **de mensagens/PMA** e a forma de pagamento ativa; somente processo privilegiado/auditado pode marcar `verified` e eventualmente `ready` quando os critérios forem implementados. Não executar essa transição manual via SQL improvisado.
8. **Envio de lembretes** exige módulos de agenda reais, consentimento registrado do destinatário, templates aprovados da categoria pertinente, agendador por fuso horário, idempotência, cancelamento de tarefas após reagendamento, opt-out, limites por tenant, processamento de status dos webhooks e cobrança segregada por conta Meta.

## Segurança e testes

- O navegador recebe apenas IDs de aplicativo/configuração e metadados necessários. Código OAuth e IDs devolvidos pelo popup são **dados não confiáveis**; o backend consulta a Graph API antes de armazenar qualquer vínculo.
- O operador acessa somente seu tenant com sessão válida/MFA AAL2. O frontend nunca pode selecionar a conta de outro tenant ou visualizar `token_ciphertext`, `token_nonce`, chaves ou segredos.
- `customer_reported` não significa faturamento aprovado. `billing_owner='customer_direct'` é o modo desejado, não confirmação da Meta.
- Se faltar credencial, configuração ou conta homologada, as ações de conexão falham com segurança e as notificações continuam desativadas.
- Executar testes de isolamento: visitante, AAL1, viewer, admin de outro tenant, vínculo duplicado, nonce expirado/reutilizado, telefone que não pertence à WABA, faturamento não verificado e perda da chave de criptografia.
- **Nenhuma chamada real à Meta nem cobrança é feita pelos testes automatizados.** As respostas Meta são fictícias e a base local de testes é descartável.
- Antes de integrar à branch principal do VNext: atualizar com a HEAD recente do PR #60, executar CI, revisar alteração de permissões e homologar o fluxo OAuth/SDK em ambiente isolado com credenciais reais guardadas em Secrets.

Fontes:
- https://whatsappbusiness.com/partners/become-a-partner/
- https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup
- https://developers.meta.com/resources/videos/whatsapp-account-model-evolution/
- https://www.facebookblueprint.com/student/path/253152-whatsapp-embedded-signup-course
