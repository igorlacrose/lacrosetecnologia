# LKZ ERP — Autoridade Ed25519: homologação e gate comercial

**Projeto de homologação verificado:** Supabase `nijsafzwxzcfqdevlsxe`.
**Produção da Lacrose:** Supabase `icrtewhazpfauuroswri` — **a autoridade de licenciamento NÃO foi implantada nesse projeto**.

## Valores reais de HOMOLOGAÇÃO (nunca usar para build comercial)
- Endpoint HTTPS: `https://nijsafzwxzcfqdevlsxe.supabase.co/functions/v1/lkz-license/entitlement`
- Chave pública Ed25519, Base64URL sem padding: `wy6voT4zK-HdZCczxhUgHn3VnhCMTbZ3uTpjPGcM97g`
- Consulta pública da chave: `https://nijsafzwxzcfqdevlsxe.supabase.co/functions/v1/lkz-license/public-key`
- Método: `POST`, `Content-Type: application/json`, sem credenciais no cliente.
- Corpo: `{"installationId":"<64-hex>","cnpj":"<14-digitos>","product":"lkz-erp"}`.
- Resposta HTTP 200: `{"grant":{ "version":1, "licenseId":"...", "installationId":"...", "cnpj":"...", "status":"active|grace|suspended|cancelled", "issuedAt":0,"validUntil":0,"offlineUntil":0},"signature":"base64url"}`. O servidor **assina o JSON com campos na exata ordem do struct Go**, sem espaços arbitrários, como `json.Marshal(Grant)`.

O endpoint **não emite** licença a instalações não cadastradas (HTTP 404).
A chave privada é um seed de 32 bytes gerado por `extensions.gen_random_bytes(32)` inteiramente no PostgreSQL e armazenado cifrado pelo **Supabase Vault**. O seed só é retornado à Edge Function por RPC restrita a `service_role`; nunca extrair ou copiar para build, navegador, repositório, chats ou logs.

## Evidência executada em 14/11/2026
- Supabase migração aplicada no projeto de homologação, schema isolado `lkz_licensing`, sem modificar tabelas anteriores.
- RLS habilitado, `anon` e `authenticated` sem acesso ao seed; `service_role` tem EXECUTE na RPC estritamente necessária.
- Edge Function `lkz-license` v1 publicada no projeto de homologação com `verify_jwt=false` (o cliente Windows não envia JWT; só instalações autorizadas obtêm concessão).
- HTTP real `GET /public-key` respondeu 200 e chave pública de 32 bytes.
- HTTP real `POST /entitlement` sem licença respondeu 404.
- Licença fictícia ativa respondeu 200 com assinatura Ed25519; **a rotina Go original `licensing.Verify()` e `licensing.MayOperate()` passaram**.
- Suspensão fictícia respondeu 200 assinada; o **Go original bloqueou a operação**.
- A instalação e licença fictícias foram removidas. Zero clientes reais cadastrados, zero pagamentos registrados.
- Backend comercial de produção e site do ADM **não alterados** por esta etapa.

## Próximos gates para produção
- [ ] Verificar backup/restauração do Supabase alvo, **incluindo custódia da chave do Vault**. Nova instalação com seed nova exige rebuild do app com chave pública nova; sem seed original não se validam concessões anteriores.
- [ ] Aplicar migração aditiva, versionada e revisada exclusivamente ao ambiente definitivo; nunca reaproveitar a chave de homologação.
- [ ] Implantar Edge Function com `verify_jwt=false` e revisar rate-limit, validação de JWT administrativo, tenant, logs e acesso do gateway.
- [ ] Ler a **nova chave pública da própria produção** em `/public-key`, conferir 32 bytes, fixar somente ela no build Go com `licenseMode=production`.
- [ ] Criar perfil administrativo para MASTER+MFA com ativação após pagamento confirmado, limite de instalações e auditoria. RPC `lkz_license_admin_activate_v1` e `lkz_license_admin_status_v1` foram preparadas; ainda falta teste real com sessão MFA e integração à interface do ADM.
- [ ] Validar idempotência, concorrência, falhas de conectividade, revogação assinada, vencimento, relógio manipulado, perda de sessão, backup/restauração de seed, expiração e comportamento offline em máquina Windows real.
- [ ] Validar separadamente o ERP fiscal, PDV, SQLite/ledger, NFC-e, impressoras e certificado antes de vendas reais. **Licenciamento não torna a aplicação fiscal pronta.**

## Nota para o Codex
Não gerar uma segunda chave Ed25519 local; não aceitar `GET /public-key` em todo início para substituir a chave embutida. A chave de verificação da produção deve ser fixada somente depois de conferir a origem HTTPS autorizada. Nunca usar a chave de homologação em build comercial. Nenhuma licença é criada pelo aplicativo Windows.
