# LKZ ADM VNext

Fundação experimental do LKZ ADM, com dados fictícios nos testes. O ambiente de desenvolvimento utiliza Node.js 24.

```sh
npm ci --ignore-scripts
npm test
```

- `db/001-foundation.sql` cria os esquemas de tenants, usuários associados, leads, clientes e auditoria. O RLS exige vínculo ativo e MFA. A conversão de lead usa e-mail normalizado dentro do tenant.
- `db/002-asaas-inbox.sql` cria a caixa de entrada de eventos de cobrança e um papel sem login com permissão de inserção.
- `db/003-draft-catalog.sql` cria produtos e planos em rascunho. Administradores com MFA podem cadastrar rascunhos. A oferta pública depende de um fluxo de homologação.
- `db/004-asaas-reconcile.sql` adiciona estado da fila, tentativas e um papel de processamento separado.
- `asaas-sandbox.mjs` recebe eventos autenticados, grava o envelope mínimo antes do HTTP 200 e oferece consulta a cobranças apenas no Sandbox. O runtime deve passar uma conexão PostgreSQL em autocommit sob o papel dedicado e obter o token de um gerenciador de segredos.

As migrações são um rascunho para um banco de desenvolvimento vazio, com os papéis e funções de identidade Supabase. Os testes simulam os claims de identidade em PostgreSQL embarcado e simulam a API do Asaas. O consumidor consulta o estado corrente com lease de 60 segundos, espera exponencial e até cinco tentativas. O resultado observado não autoriza cobranças, alterações comerciais ou licenças. O agendamento e a integração com Auth e Sandbox externo exigem homologação.

O backend precisa de empacotamento separado da raiz publicada do site. O fluxo de produção depende de validação da implantação, API administrativa, processamento e reconciliação de eventos, recuperação de dados e homologação do ambiente.

## Segunda entrega — prévia operacional local

Use `npm run preview` e abra a URL indicada no terminal. A prévia escuta exclusivamente na interface de loopback, cria PostgreSQL em memória e usa uma identidade administrativa fictícia para o navegador. Encerre com Ctrl+C. Cadastros de teste são descartados no encerramento. O servidor de prévia é exclusivo para desenvolvimento, sem login real e sem conexões com o Supabase, Asaas ou OCA de produção.

A interface consulta o banco para exibir indicadores e listas. Ela permite cadastrar e converter leads, cadastrar clientes, registrar atendimentos, mover oportunidades, cadastrar produtos e planos, montar rascunhos de assinatura e consultar o histórico de auditoria. As listas retornam até 100 registros. As contagens do painel consideram todo o tenant. A migração 005 acrescenta oportunidades, interações, assinaturas em rascunho e uma referência OCA idempotente por tenant.

O módulo OCA consulta somente o conhecimento aprovado da Lacrose na prévia. O catálogo exibido ao operador vem do banco do tenant. A entrada no CRM é feita pelo operador com UUID de atendimento, nome e e-mail. O vínculo com a captação pública e a integração com Auth dependem de ambiente de homologação separado. BarbarOS e LibertyOS aparecem como produtos em desenvolvimento. A consulta de elegibilidade da assinatura bloqueia o provisionamento no servidor.

Para verificar uma cobrança fictícia **já existente** na conta Asaas Sandbox, configure `ASAAS_SANDBOX_API_KEY` e `ASAAS_SANDBOX_PAYMENT_ID` pelo ambiente seguro e execute `node check-asaas-sandbox.mjs`. O comando só faz uma consulta de leitura na origem Sandbox. O envio de webhook pela conta Sandbox, a conciliação com contratos e a emissão de cobranças e licenças ainda precisam de integração e homologação.

## Terceira entrega — homologação persistente

A prévia anterior continua disponível. O modo de homologação usa um servidor PostgreSQL separado e Supabase Auth de um projeto dedicado. A URL do banco deve apontar para uma base lkz_vnext_stage ou lkz_vnext_stage_<sufixo>. O modo de homologação recusa o identificador institucional conhecido e escuta apenas em loopback. Conexões PostgreSQL remotas exigem TLS com verificação de certificado.

1. Provisione uma base exclusiva com os papéis anon e authenticated e as funções auth.uid() e auth.jwt() compatíveis. Cadastre em auth.users os UUIDs das identidades do Auth de homologação. No PostgreSQL standalone, o responsável pelo banco deve preparar essa ponte. Ela precisa manter os UUIDs e retirar vínculos ativos ao desativar usuários.
2. Com uma credencial de migração exclusiva, configure VNEXT_MIGRATION_DATABASE_URL e execute npm run migrate:staging. O migrador aplica o conjunto em transação, serializa execuções, grava SHA-256 e rejeita alterações retroativas nos arquivos. Não dê privilégios de migração ao processo web.
3. Configure um login lkz_vnext_runtime com NOINHERIT e associação ao papel authenticated para SET ROLE. A inicialização rejeita proprietário, superusuário, BYPASSRLS e associação a papéis financeiros. Cadastre tenants e vínculos pela administração da base de teste.
4. No ambiente seguro, configure VNEXT_RUNTIME_DATABASE_URL, VNEXT_AUTH_URL e VNEXT_AUTH_PUBLISHABLE_KEY. Opcionalmente, defina VNEXT_LACROSE_TENANT para ativar o conhecimento aprovado da Lacrose somente nesse tenant. Execute npm run staging. Use uma conta de homologação com TOTP previamente cadastrado. O navegador guarda o token apenas em memória. O servidor verifica emissor, audiência, validade, perfil e AAL2 antes de consultar o banco sob RLS.
5. Execute npm test. Os testes automatizados usam respostas sintéticas do Auth e Asaas. Em homologação, valide separadamente login/TOTP real, negação sem MFA, revogação de vínculo, acesso cruzado e sessão expirada.

### Integração OCA

A rota POST /integrations/oca é opcional. Configure VNEXT_OCA_ACTOR como um operador técnico ativo no tenant VNEXT_LACROSE_TENANT e VNEXT_OCA_HMAC_KEY como 32 bytes em hexadecimal. O remetente deve enviar x-oca-timestamp em segundos Unix e x-oca-signature com HMAC-SHA256 hexadecimal sobre timestamp, ponto e os bytes exatos do corpo. O envelope contém eventId e conversationId UUID, consent=true, name, email e note. A integração fixa o tenant no servidor, registra lead e interação em uma transação e audita o operador. Entregas repetidas com o mesmo conteúdo retornam 200. Referência repetida com conteúdo diferente retorna 409. O emissor público ainda precisa ser ligado em homologação. O VNext não recebe chamadas do site institucional nesta entrega.

### Sandbox e licenças

O worker de observação da primeira entrega continua disponível. Os vínculos de cobranças fictícias criados na terceira entrega continuam elegíveis à conciliação. As solicitações de licença ficam em estado bloqueado e não dão acesso ao produto.

### Quarta entrega — emissão e conciliação isoladas

**OCA.** O processo de homologação do OCA pode entregar um evento consentido com `node oca-staging-sender.mjs`, recebendo o envelope JSON por stdin. O destino é o receptor VNext no mesmo host, em loopback na porta 4176. Forneça a mesma chave de homologação aos dois processos pelo gerenciador de segredos. Grave os IDs estáveis no lado emissor antes da primeira tentativa e reutilize o mesmo envelope em caso de `retry_same_event`. Em `conflict`, investigue a origem da divergência. Valide uma entrada de atendimento e auditoria por evento. O endpoint público do site continua separado.

**Asaas.** Aplique as migrações 008 e 009 em banco de homologação e use três logins de menor privilégio. Cada login deve herdar exclusivamente o papel de sua função.

| Função | Variável da conexão | Papel |
|---|---|---|
| Recepção HTTP | `VNEXT_ASAAS_INGEST_DATABASE_URL` | `lkz_vnext_asaas_ingest` |
| Emissão | `VNEXT_ASAAS_ISSUE_DATABASE_URL` | `lkz_vnext_asaas_issue` |
| Conciliação | `VNEXT_ASAAS_RECONCILE_DATABASE_URL` | `lkz_vnext_asaas_reconcile` |

1. Configure `VNEXT_ASAAS_TENANT` com o UUID do tenant fictício. Crie no painel um cliente com endereço de teste em `example.test` e rascunhos vinculados a planos de cobrança única, mensal ou anual. Forneça `ASAAS_SANDBOX_API_KEY` e, para o cadastro do cliente, `VNEXT_ASAAS_FIXTURE_TAX_ID` com um documento fictício aceito pelo Sandbox. O cliente externo recebe um nome genérico e fica com notificações desativadas.
2. Emita o cadastro e use o UUID de cada rascunho nos comandos seguintes. Substitua a data ilustrativa por uma data válida no Sandbox. Valores e recorrência vêm do plano local. Os métodos aceitos neste ensaio são `PIX`, `BOLETO` e `UNDEFINED`.

   ```sh
   node issue-asaas-staging.mjs customers <client-uuid>
   node issue-asaas-staging.mjs payments <one-time-draft-uuid> 2030-01-15 PIX
   node issue-asaas-staging.mjs subscriptions <recurring-draft-uuid> 2030-01-15 BOLETO
   ```

3. A emissão reserva uma referência por cliente ou rascunho em PostgreSQL antes de chamar o gateway. Se o comando retornar `needs_reconciliation`, repita os mesmos argumentos para consultar a referência existente. Essa repetição nunca executa um segundo POST. Se o Sandbox não encontrar um resultado único, confira a conta e a referência antes de decidir como tratar a reserva. Preserve a trilha em `lkz_vnext_billing.sandbox_issuance`.
4. Para receber eventos, configure também `VNEXT_ASAAS_WEBHOOK_TOKEN` com um token próprio e inicie `npm run staging`. A rota de loopback `POST /integrations/asaas-sandbox` confirma o recebimento depois de gravar o envelope mínimo. Para entrega externa, ela depende de uma entrada HTTPS de homologação previamente autorizada, com publicação exclusiva dessa rota. Configure eventos de pagamento no Sandbox. A assinatura gera cobranças distintas ao longo do ciclo.
5. Execute `node reconcile-asaas-staging.mjs --next` para processar o próximo evento devido. Cada execução processa até um evento. Use um agendador do ambiente para executar o comando de forma periódica. O worker faz até cinco tentativas com espera crescente e encaminha divergências para revisão. Use `node reconcile-asaas-staging.mjs <event_id>` para investigar e reaplicar um evento específico. O reconciliador consulta o gateway e confere a cobrança, o valor, o cliente e, nas recorrências, a assinatura externa. Repita o evento e confirme `already_processed`. O painel de Assinaturas mostra as contagens por estado aos administradores do tenant. Eventos próprios do ciclo de vida de assinaturas seguem pendentes. O provisionamento exige homologação independente do produto.

**Auth real.** Com duas contas fictícias em tenants diferentes, confira o login com TOTP, a negação com token AAL1, a negação após a expiração do token AAL2 e a negação com o mesmo token após desativar seu vínculo no PostgreSQL. Confira que o token de um tenant recebe HTTP 403 ao consultar o outro. Registre somente status e horários, sem copiar tokens, códigos ou dados pessoais.

### Backup e rollback

Pare a aplicação antes do backup, confirme que o banco é de homologação e preserve o snapshot com controle de acesso. Para PostgreSQL standalone, use o backup homologado da instalação. Um backup frio exige desligamento limpo e restauração em outro diretório, com a mesma versão e arquitetura. Valide a restauração em instância isolada antes de alterar a origem. Para reverter a quarta entrega, pare a emissão e a recepção, volte o checkout para `b432df59` e restaure o snapshot anterior à migração 008 em outra base. O migrador rejeita um banco com histórico à frente do checkout. Preserve o banco avançado e concilie as referências pendentes antes de reativar emissão. Uma restauração local não apaga registros já criados no Sandbox.
