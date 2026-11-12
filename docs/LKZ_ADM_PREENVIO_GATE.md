# LKZ ADM — Portão de segurança do pré-envio comercial

## Estado atual (12/11/2026)
- A interface de **pré-envio** e a tabela privada `lkz_adm_private.crm_message_previews` fazem apenas preparação, revisão, aprovação, rejeição e cancelamento.
- **Nenhuma RPC, worker, cron, webhook ou provedor efetua envio.**
- `status = approved` significa **aprovado por responsável**, não `queued`, `sent` ou `delivered`.
- Toda resposta de API expõe `delivery_enabled = false`. É um indicador fixo de proteção, não uma configuração de frontend.
- O banco guarda instantâneos de corpo, destino, canal e versão do rascunho, protegidos no schema privado por grants restritos e MFA.
- O painel exibe impedimentos se o consentimento, destino ou versão do rascunho mudaram.

## Aprovação
- Operador `master/admin` com MFA pode solicitar revisão de um rascunho **salvo** por WhatsApp ou e-mail, vinculado a oportunidade e contato reais.
- Apenas MASTER com MFA pode **aprovar ou rejeitar**.
- Cancelamento é permitido ao solicitante ou MASTER com MFA.
- Rejeição exige motivo. Aprovação exige autorização documentada ativa **no canal específico**, destino inalterado, rascunho inalterado e vínculo ativo.
- Retentativa com mesmo UUID não duplica solicitação nem auditoria.
- A solicitação usa no máximo uma prévia pendente por oportunidade e canal.

## Registro de autorização e revogação por canal — 12/11/2026

- O histórico agora utiliza `lkz_adm_private.contact_consent_events`, separado por **WhatsApp** e **e-mail**. Não foi realizada migração automática do campo legado `contacts.consent_contact`.
- MASTER com MFA pode registrar **somente uma manifestação comprovada**, após conferir a evidência real. Deve informar canal, método da manifestação, referência de comprovante e data/hora da manifestação. O banco registra a data/hora efetiva da inserção e o responsável.
- A **referência de comprovante não é o comprovante**. O arquivo ou mensagem original deve ser armazenado de forma segura, com acesso restrito, retenção apropriada e recuperação para auditoria. Nunca cole dados pessoais, links sensíveis, tokens ou conteúdo de conversas no campo de referência.
- Operador autorizado com MFA pode registrar revogação/oposição em cada canal, inclusive se não houver autorização anterior. O evento é auditado, sem exigir nova evidência para interromper abordagens.
- A aprovação de prévia é autorizada pelo histórico específico do canal consultado diretamente no banco, sem confiar em um booleano no navegador. Revogação desabilita a prontidão de prévias já aprovadas, **mas não altera retroativamente os registros de decisão**.
- Um UUID por operação impede dupla gravação ao repetir uma mesma solicitação após falha de rede. A mesma chave com outros dados é rejeitada.
- O módulo é **monocliente** na implantação atual. Para reutilizar em um SaaS multiempresa é bloqueador adicionar tenant_id, verificar isolamento/RLS/autorização por tenant e revisar rotas administrativas.
- Cada autorização salva de forma privada uma referência canônica ao **destino exato** (telefone ou e-mail). Se esse campo mudar, a autorização aparece como **desatualizada** e não pode liberar aprovações. A nova comprovação deve ser posterior à alteração cadastral.
- A mera declaração do operador não torna um consentimento legalmente válido. O controlador deve possuir evidência de manifestação livre, informada, inequívoca e vinculada a finalidade, conforme orientação da ANPD.
- **Não existe disparo de mensagens.** Uma autorização registrada não deve ser interpretada como habilitação de transporte.

## Exigências BLOQUEADORAS antes de criar qualquer envio real
1. Identificar provedor e canal oficial homologados. Segredos ficam exclusivamente em vault/variáveis protegidas de backend.
2. Criar endpoint/worker server-side separado; nunca executar envio pelo navegador. Authorization/RBAC/MFA e isolamento multiempresa devem ser revalidados.
3. Exigir base legal apropriada, consentimento quando aplicável, opt-out e disponibilidade do canal. Não inferir consentimento só por ter telefone.
4. Revalidar no instante do envio: aprovação atual, contato, destino, texto/versionamento, tenant, política comercial, horário, cotas e bloqueios.
5. Idempotência forte por mensagem e provedor, fila durável, política de retries com backoff, dead-letter queue e prevenção contra envio duplicado.
6. Autenticar webhooks de status usando assinatura oficial e prevenção de replay; persistir identificador do provedor e distinguir `accepted`, `sent`, `delivered`, `read` e `failed`.
7. Aplicar limites anti-spam, proteção contra abuso, opt-in/out conforme canal e restrições de templates/janela de conversação.
8. Registrar auditoria sem expor segredos ou o corpo integral das mensagens em logs; política de retenção e remoção conforme LGPD.
9. Cobrir falhas: timeout após envio, duplo webhook, destinatário revogado, mudança de versão, expiração de aprovação, token inválido, conta suspensa, rede fora, erro 429/5xx.
10. Testar com credenciais de sandbox e contatos autorizados antes da produção; PR, CI, revisão, backup e rollback.

**Não reutilizar `status=approved` como gatilho de envio**. Uma futura implementação precisará criar um recurso de autorização de despacho com sua própria máquina de estados, identidade e testes.

## Verificações executadas
- Migração nova registrada no projeto Supabase e versionada no GitHub.
- Testes SQL transacionais com `ROLLBACK` para prévia, rejeição, repetição e aprovação sem transporte.
- CI de frontend cobre os controles e bloqueios, com teste sem chamadas a provedores.
- Homologação por clique com conta MASTER e MFA real ainda pendente.
