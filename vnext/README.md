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

O worker de observação da primeira entrega continua disponível. Para conciliar comercialmente um evento já recebido, registre previamente em homologação o vínculo de cobrança fictícia em payment_bindings, com a assinatura em rascunho, cliente, referência externa e valor esperado. Use um login isolado com o papel lkz_vnext_asaas_reconcile em VNEXT_ASAAS_RECONCILE_DATABASE_URL, configure ASAAS_SANDBOX_API_KEY e execute node reconcile-asaas-staging.mjs <event_id>. O comando consulta a API Sandbox, valida o vínculo e grava a transição local com idempotência. Emissão de cliente, cobrança, assinatura e execução automática do reconciliador dependem de completar a integração Sandbox. As solicitações de licença ficam em estado bloqueado e não dão acesso ao produto.

### Backup e rollback

Pare a aplicação antes do backup, confirme que o banco é de homologação e preserve o snapshot com controle de acesso. Para PostgreSQL standalone, use o backup homologado da instalação. Um backup frio exige desligamento limpo e restauração em outro diretório, com a mesma versão e arquitetura. Valide a restauração em instância isolada antes de alterar a origem. Em rollback, pare o runtime, volte o checkout para 6d151cf e restaure o backup correspondente em outra base. O migrador rejeita um banco com histórico à frente do checkout. Preserve o banco avançado até validar os registros da recuperação.
