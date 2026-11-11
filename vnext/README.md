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
