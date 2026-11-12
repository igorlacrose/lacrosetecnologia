# LKZ ADM — Propostas comerciais internas, versionadas

## Entrega — 12/11/2026

O LKZ ADM passa a permitir **preparar internamente** uma proposta vinculada à versão salva da minuta de um cliente. Esta funcionalidade **não envia uma proposta ao cliente, não registra assinatura/aceite, não gera cobranças e não provisiona sistemas**.

### Fluxo na ficha do cliente

1. Cadastrar ou editar o cliente, selecionando um ou vários sistemas e valores.
2. Salvar a minuta. O banco registra sua versão.
3. MASTER com MFA pode usar **Preparar proposta (sem envio)**.
4. O sistema congela nomes de produtos, códigos, valores de implantação, recorrência e periodicidades da versão escolhida; guarda totais separados de implantação/mensalidade/anuidade.
5. É possível consultar histórico de propostas internas e cancelar uma com justificativa auditada.
6. Se a minuta for editada, a proposta antiga permanece inalterada e aparece como baseada em versão anterior. Uma nova versão pode gerar outra proposta.
7. Uma proposta cancelada permanece no histórico; não pode ser reativada.

### Segurança

- Tabela privada `lkz_adm_private.client_quotes` com RLS habilitado e **sem privilégios diretos para `anon` ou `authenticated`**.
- Ações protegidas por RPCs. Leitura requer operador administrativo com MFA. Preparação e cancelamento exigem MASTER com MFA, verificadas diretamente no banco.
- Controle otimista de versão da minuta. Restrição única por **cliente + versão**; retentativa da mesma operação usa identificador UUID e não duplica proposta/auditoria.
- Snapshots são imutáveis para o frontend. Não há operação autorizada para alterar itens, totais ou valores de uma proposta após preparação.
- Restrições fixas no banco: `billing_enabled=false`, `provisioning_enabled=false`, `customer_accepted=false`, status apenas `prepared` ou `cancelled`. Nenhum campo permite transformar proposta em fatura ou contrato.
- A auditoria registra IDs, versão e códigos de produtos. Não grava conteúdo integral de contrato, credenciais, contatos ou dados de pagamento em logs.

### Limites e próximos gates

**Proposta preparada não é contrato aceito.** Antes de assinar, cobrar ou entregar um sistema, ainda será necessário:

- Definir termos oficiais do serviço, escopo, prazo, renovação, política de cancelamento, reajustes e tratamento de dados.
- Exibir documento e condições ao comprador e capturar aceite/assinatura com identidade, integridade, evidência e trilha de auditoria apropriadas. Não inferir aceite por clique administrativo.
- Implementar cobrança em backend com gateway homologado, autenticação de webhook, idempotência, conciliação e estados de pagamento distintos.
- Validar isolamento por empresa em **cada produto**, provisionamento reentrante, credenciais protegidas, limites por plano, backup/restauração e healthcheck.
- Somente ativar/provisionar após confirmação de pagamento confiável e autorização server-side. Evitar revender produtos ainda não homologados.
- Homologar os cliques com sessão MASTER/MFA real e revisar segurança de produção, incluindo proteção contra senhas vazadas.

### Reversão, migração e testes

- Backup de frontend: `backup/lkz-adm-pre-propostas-20261112`.
- Migração: `supabase/migrations/20261112220200_lkz_adm_propostas_versionadas_sem_cobranca.sql`.
- Testes SQL executados com ROLLBACK: dois sistemas, totais, snapshot, repetição idempotente, concorrência, cancelamento, mudança de minuta, anon/AAL1 e ADMIN não MASTER.
- CI realiza sintaxe, testes de interface e regressões. O deploy depende do check obrigatório.
- A reversão do frontend não remove automaticamente a tabela; futuras propostas reais exigirão política de retenção e eventual migração.

**Este fluxo permanece interno à Lacrose Tecnologia. Não constitui um portal público multiempresa ou integração contratual com um provedor de assinatura.**
