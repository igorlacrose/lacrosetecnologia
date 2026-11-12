# LKZ ADM — Catálogo e minutas comerciais por cliente

## Entrega inicial — 12/11/2026
Este módulo permite **selecionar mais de um sistema no cadastro ou edição do cliente** e definir condições individuais de implantação e recorrência. O estado armazenado é uma **minuta comercial**, e não uma assinatura efetivada.

### Catálogo inicial (sem preço fixo e sem ativação automática)
- OCA — Operador Comercial Autônomo
- LKZ ERP
- LibertyOS
- BarbarOS
- LKZ ISP Intelligence
- Lacrose CRM
- LKZ SST

Todos estão sujeitos a avaliação comercial/manual antes de disponibilização. O catálogo não garante que funcionalidades de cada produto estejam prontas ou homologadas. Os valores não são preenchidos automaticamente: o operador informa implantação e recorrência em reais; `0,00` significa valor previsto zerado na minuta, não serviço grátis confirmado.

### Modelo persistente
- `lkz_adm_private.commercial_products`: catálogo controlado pelo backend, com códigos estáveis e estado de disponibilidade.
- `lkz_adm_private.client_contract_drafts`: uma minuta por cliente, versionada e com auditoria. Status restrito a `draft`.
- `lkz_adm_private.client_contract_draft_items`: vários produtos por minuta; valor de implantação, recorrência (mensal/anual/nenhuma), todos guardados em **centavos inteiros BRL**.
- Funções `lkz_adm_create_client_with_draft` e `lkz_adm_edit_client_with_draft`: persistem cadastro e minuta **na mesma transação**, mantendo as validações anteriores de cliente e vinculação a atendimento. Falhas de precificação, concorrência ou autorização revertem a operação inteira.
- `lkz_adm_catalog_and_contract`: leitura privada do catálogo e minuta de um cliente.
- `lkz_adm_list_contract_drafts`: resumo administrativo das minutas com totais separados de implantação, mensal e anual, **sem misturar periodicidades nem interpretar isso como receita recebida**.

### Segurança e limites
- Leitura e alteração somente com sessão administrativa ativa e MFA AAL2, verificadas no servidor.
- Tabelas em schema privado, com RLS habilitado e sem privilégios diretos para `anon` ou `authenticated`; funções internas security definer verificam autorização. Wrappers públicos são invoker.
- Validação server-side estrita: códigos conhecidos, sem repetição de produto, formato e limites dos valores, periodicidade válida e proteção otimista de versão. Um UUID de idempotência impede duplicação de gravações na mesma operação.
- Logs de auditoria registram ação, versão e códigos de produtos; sem credenciais e sem armazenar dados de pagamento.
- **Impossível ativar cobrança/provisionamento nesta versão:** `billing_enabled=false` e `provisioning_enabled=false` são restrições no banco. Não existe webhook de pagamento, boleto, Pix, provisionador, tenant do produto ou credenciais do serviço.
- Os cadastros atuais pertencem ao CRM administrativo da Lacrose. **Ainda não existe isolamento multiempresa do CRM completo**, somente a base inicial de pré-despacho do OCA feita em fase anterior.
- Nenhum dos contatos existentes foi associado automaticamente a sistemas ou contratos; nenhuma cobrança foi gerada.

### Próximos gates antes de comercialização autônoma
1. Revisar status de disponibilidade e ficha do produto com escopo e preço aprovado, sem presumir prontidão dos produtos ainda em desenvolvimento.
2. Criar versões de plano e termos/aceites assinados, fluxo de aceite pelo comprador, identidade do contratante e assinatura ativa só após confirmação.
3. Validar meios de pagamento no backend, webhooks autenticados, conciliação, idempotência, tratamento de reembolso e LGPD.
4. Provisionar isolamento por tenant real em cada produto, usuários/perfis, backup, quotas, auditoria, testes de acesso cruzado e rollback de provisionamento.
5. Gate de entrega: pagamento realmente confirmado + plano apto + autorização de provisionar + healthcheck do ambiente criado + evidência de entrega.
6. Homologar o módulo visualmente com usuário MASTER/ADMIN e MFA real no navegador antes de declarar experiência aprovada.

### Testes e reversão
- SQL em transações com `ROLLBACK`: criação e edição atômicas, múltiplos produtos, repetição idempotente, versionamento, produtos inválidos, valores negativos, AAL1 e anônimo negados.
- CI: regressões do painel, script do módulo e checagem de sintaxe. Testes são simulações, não homologação com pagamentos ou instalações reais.
- Backup de frontend antes da alteração: `backup/lkz-adm-pre-contratos-20261112`.
- Migrações versionadas: `20261112210946` e `20261112211123`.
- A reversão de frontend é independente; caso existam minutas reais futuramente, não apagar as tabelas sem plano de migração e retenção.
