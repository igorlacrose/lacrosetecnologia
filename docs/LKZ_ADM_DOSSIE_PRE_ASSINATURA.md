# LKZ ADM — Dossiê contratual pré-assinatura

## Entrega de 12/11/2026

A ficha do cliente passa a permitir preparar **internamente** um registro documental vinculado a uma proposta comercial, antes da futura integração com um provedor de assinatura. **Não existe assinatura, aceite, envio, cobrança, pagamento confirmado ou provisionamento nesta etapa.**

### Operação
1. Cliente → selecionar sistemas, valores e salvar a minuta.
2. MASTER com MFA → preparar proposta interna, preservando a versão dos preços.
3. Em **Documento para futura assinatura** → selecionar uma proposta preparada, atual e ainda não cancelada.
4. Informar **versão** do documento, **referência interna**, **SHA-256** calculado sobre os bytes do arquivo original e atestar conferência humana. Não colar texto do contrato, dados pessoais, URLs públicas/privadas, links assinados, senhas ou tokens no campo de referência.
5. O backend cria um dossiê imutável relacionado à proposta. O documento original deve permanecer em um repositório privado com controle de acesso, backup, retenção e auditabilidade; esta entrega **não implementa armazenamento nem calcula/verifica o hash do conteúdo**.
6. O MASTER pode invalidar a referência, com motivo e auditoria. A referência invalidada não deve ser reutilizada; para corrigir o documento, preparar nova versão de minuta/proposta.
7. O painel exibe o histórico, inclusive propostas antigas ou canceladas. **Dossiê preparado não equivale a documento assinado.**

### Segurança
- `lkz_adm_private.signature_dossiers` em esquema privado com RLS e sem privilégios diretos para `anon` e `authenticated`.
- Funções privadas `list_signature_dossiers`, `prepare_signature_dossier` e `void_signature_dossier`. Leitura só por operador administrativo com MFA AAL2; preparação/invalidação só MASTER+MFA, com verificação no banco.
- Preparação somente de proposta `prepared` cuja versão corresponda à minuta atual.
- Validação rígida de versão, referência sem URL, SHA-256 hexadecimal, atestado do operador e UUID de idempotência. Uma referência por proposta, com unicidade garantida no banco.
- Auditoria grava apenas IDs, versão e ação, não conteúdo do contrato, dados do titular ou segredos.
- **Gates definitivos nesta fase**: `signature_enabled=false`, `signer_identity_verified=false`, `customer_accepted=false`, `payment_confirmed=false`, `billing_enabled=false`, `provisioning_enabled=false`, impostos pelo banco. Estado permitido só `prepared/void`.
- Uma proposta cancelada ou a alteração posterior da minuta pode tornar o dossiê historicamente preservado, mas **inapto** a avançar. A futura integração de assinatura deve revalidar todas essas condições antes de enviar.
- Não há acesso público, link de assinatura nem endpoint para marcar o cliente como aceito. `noindex` ou esconder botão não substituem essas barreiras.

### Próximos gates obrigatórios
1. Aprovar os termos oficiais por produto: objeto, prazos, implantação, suporte, SLA, renovações, cancelamento e tratamento de dados/LGPD.
2. Conectar repositório privado de documentos: gerar documento do snapshot, calcular SHA-256 **server-side** sobre o arquivo armazenado, bloquear alterações e garantir download autenticado.
3. Integrar provedor de assinatura, identidade/representação do assinante, convite com validade, opt-out/consentimento e trilha de auditoria.
4. Receber webhook de assinatura **autenticado e idempotente** no backend, vinculado a hash, proposta e destinatário verificados. Só então introduzir estado real de aceite; **nunca por botão administrativo isolado**.
5. Homologar cobrança, webhook de pagamento e conciliação; somente após confirmação server-side avaliar provisionamento por tenant/produto com backup, rollback, RLS, menor privilégio e testes de isolamento.
6. Testar visualmente em sessão MASTER/MFA real; QA, backup/restore e threat model antes da produção de assinatura.

### Preservação, testes e rollback
- Backup do site: branch `backup/lkz-adm-pre-dossie-assinatura-20261112` no commit `517006a88432956e3ae2854f58d04ecb13d00071`.
- SQL versionado na migração remota `20261112220548_lkz_adm_dossie_pre_assinatura_sem_aceite.sql`.
- Testes com `ROLLBACK`: dossiê fictício, idempotência, impedimento de duplicidade, URL proibida, invalidação com justificativa, anon e AAL1 negados, ADMIN sem MASTER impedido de alterar.
- CI inclui testes de frontend e regressões. Testes automatizados não substituem homologação manual autenticada.
- O rollback do frontend não remove registros eventualmente criados depois; uma remoção de dados exigiria plano de retenção e decisão explícita.

**Limite comercial:** esta implementação prepara evidências de versionamento; não valida juridicamente o contrato, não confirma que o hash corresponde ao arquivo original e não constitui assinatura eletrônica.
