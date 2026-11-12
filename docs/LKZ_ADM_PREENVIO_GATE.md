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
- Rejeição exige motivo. Aprovação exige consentimento com data, destino inalterado, rascunho inalterado e vínculo ativo.
- Retentativa com mesmo UUID não duplica solicitação nem auditoria.
- A solicitação usa no máximo uma prévia pendente por oportunidade e canal.

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
