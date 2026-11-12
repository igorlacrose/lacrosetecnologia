# LKZ ADM — Minuta contratual privada gerada e verificada no servidor

## Entrega de 12/11/2026

Foi adicionada a geração de **minuta textual interna** a partir de uma proposta comercial preparada, vinculada a um cliente. O documento textual integral fica armazenado em tabela privada, com **SHA-256 calculado no PostgreSQL sobre os bytes UTF-8** do texto efetivamente guardado. Na leitura, o servidor recalcula o hash e verifica o tamanho antes de retornar qualquer conteúdo.

### Fluxo operacional

1. Em Clientes, preencher sistemas e valores e salvar minuta comercial.
2. O MASTER com MFA prepara uma proposta interna versionada.
3. A ficha mostra **Minutas contratuais geradas no servidor**. Para propostas atuais/preparadas sem dossiê documental anterior, o MASTER pode usar **Gerar minuta para revisão (sem envio)**.
4. O banco gera um texto imutável com os sistemas, valores de implantação, periodicidades, nome cadastrado do contratante e pendências documentais e legais. Guarda referência `CT-LKZ-...`, conteúdo, tamanho em bytes, versão, hash e responsável.
5. MASTER/ADMIN autenticado com MFA pode **Consultar texto privado**; a leitura verifica novamente a integridade e apresenta o conteúdo apenas dentro da sessão. Não existe link público, PDF, assinatura nem envio.
6. Alterações comerciais exigem nova versão de minuta e nova proposta; a prévia anterior permanece como histórico. Propostas canceladas ou antigas não podem gerar nova minuta. Nenhum cliente existente recebeu documento automaticamente.

### Segurança e limites

- Tabela `lkz_adm_private.contract_text_previews` com RLS, privilégios diretos revogados de `anon` e `authenticated` e gatilho que **rejeita UPDATE/DELETE**. Não há mutação de conteúdo por RPC.
- Funções `list_contract_text_previews`, `generate_contract_text_preview`, `read_contract_text_preview` são `SECURITY DEFINER` em esquema privado, com `search_path` vazio, `auth.uid()` e verificação de papel/MFA no próprio banco. Wrappers no `public` são `SECURITY INVOKER` com `EXECUTE` só para authenticated.
- Preparação restrita ao MASTER+MFA; consulta ao ADMIN/MASTER com MFA. Uma prévia por proposta, com UUID idempotente. Bloqueio quando a proposta foi cancelada, ficou desatualizada ou já possui um dossiê documental legado, para evitar documentos conflitantes.
- O texto contém apenas o nome cadastrado, itens e preços. Não copia telefone, e-mail, credenciais, documentos pessoais, conversas ou segredos para a minuta.
- Restrições no banco: `status='internal_review'`, `legal_approved=false`, `signature_enabled=false`, `customer_accepted=false`, `billing_enabled=false`, `provisioning_enabled=false`. Nenhum webhook, gateway, assinatura, transporte, provisionamento ou PDF foi ativado.
- **Risco remanescente**: o contrato-base ainda é um modelo interno incompleto com tópicos `PENDENTE`. Não tem validade de assinatura; não deve ser disponibilizado para aceite ao cliente nem usado como contrato definitivo. Exige qualificação das partes e revisão jurídica (escopo, SLA, rescisão, exportação, LGPD, responsabilidade, foro, etc.).
- **O dossiê pré-assinatura legado ainda é um processo separado**, com hash informado manualmente. Não tratar sua referência manual como integridade calculada no servidor. Uma integração futura deverá vincular obrigatoriamente o dossiê e o arquivo PDF final aos hashes realmente produzidos/verificados no backend.

### Próximas etapas antes de assinatura

1. Contrato-base completo e anexos técnicos aprovados por responsável jurídico, com versões assináveis por produto e identificação correta da Lacrose Tecnologia.
2. Gerador seguro de PDF/A ou outro formato acordado, com arquivo privado e hash calculado sobre os **bytes reais do PDF**, não apenas sobre o texto.
3. Storage privado com RBAC/RLS por cliente/tenant, sem URL pública, expiração de downloads, checksum confirmado no backend, política de backup/retenção e logs sem dados pessoais.
4. Integração de provedor de assinatura eletrônica, verificação da identidade/representação do signatário e webhook autenticado/idempotente; garantia de integridade entre documento assinado e proposta.
5. Cobrança e conciliação reais somente após aceite válido; provisionamento exige pagamento confirmado por webhook confiável e validação do ambiente/tenant.
6. Homologação visual em sessão MASTER/MFA e teste de isolamento antes de liberar cliente real.

### Testes e rollback

- Migração versionada: `20261112231933_lkz_adm_contrato_textual_privado_sha_servidor.sql`, aplicada ao Supabase com validação transacional e testes em `ROLLBACK`.
- O SHA-256 e o tamanho em bytes foram recomputados sobre o conteúdo integral retornado e comparados ao armazenado. Verificados valores por produto, idempotência e duplicidade negada.
- CI inclui teste do módulo, checagem de sintaxe e regressões anteriores.
- Backup de frontend antes da alteração: `backup/lkz-adm-pre-contrato-textual-20261112`, SHA `c727da82c48f208ffb63401e1d2ad9366d326123`.
- Em rollback do frontend, os registros já criados em produção permanecem; alterar a tabela protegida exige migração específica e aprovação de retenção. Não remover o gatilho de imutabilidade sem revisão formal.

**Status: minuta interna tecnicamente rastreável, ainda não um contrato jurídico pronto nem um arquivo PDF assinado.**
