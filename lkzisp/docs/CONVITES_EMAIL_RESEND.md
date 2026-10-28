# LKZ ISP — Resend SMTP para convites e e-mails de autenticação (v1.2)

## Configuração aprovada

- Provedor: **Resend** (https://resend.com)
- Domínio remetente: `lacrosetecnologia.com.br`
- Endereço de envio: **`convites@lacrosetecnologia.com.br`**
- Nome do remetente: **LKZ ISP Intelligence**
- O endereço `lacrose.igor@gmail.com` continua sendo **conta MASTER**, mas não remetente SMTP.
- Banco do LKZ ISP: projeto Supabase `syysqoieyycclpfbadwp`, sem alterar os projetos institucionais.
- A trava privada `lkz_private.lkz_isp_invitation_mailer.enabled` permanece **false** até a verificação.
- Sem tokens, senhas ou chaves de API no GitHub, JavaScript público, chats ou e-mails.

## Passos para concluir no painel (pelo responsável)

1. Entre ou crie conta gratuita em https://resend.com/. Não é necessário cadastrar plano pago.
2. Acesse **Domains**: https://resend.com/domains e adicione **`lacrosetecnologia.com.br`** (ou subdomínio dedicado após decisão futura). A Resend fornecerá registros DNS exatos para seu domínio.
3. No gerenciador DNS **autoritativo** atual do domínio, adicione exclusivamente os registros solicitados pelo Resend (DKIM, SPF/Return-Path, MX caso necessário). **Não substitua** registros existentes de e-mail, nem troque nameservers, A/AAAA ou CNAME do site por conta própria. Pode levar tempo para o domínio passar a **Verified**.
4. Integração oficial: abra https://supabase.com/partners/catalog/resend e selecione **Add integration**. Conecte o Resend ao projeto **LKZ ISP**. Essa integração pode criar uma chave de envio e preencher o SMTP do Supabase automaticamente. Alternativa manual, se preferir:
   - Authentication → SMTP (https://supabase.com/dashboard/project/syysqoieyycclpfbadwp/auth/smtp)
   - From / Sender email: `convites@lacrosetecnologia.com.br`
   - Sender name: `LKZ ISP Intelligence`
   - Host: `smtp.resend.com`
   - Porta: `465` (TLS/SSL) ou `587` (STARTTLS) conforme painel
   - Usuário SMTP: `resend`
   - Senha SMTP: **API Key de envio do Resend**. Crie-a pelo painel do Resend e cole exclusivamente no campo protegido do SMTP do Supabase.
5. Teste o envio de um e-mail de autenticação para um endereço **de sua propriedade**. Confirme **remetente, recebimento e eventos no Resend**.
6. Somente depois do teste bem-sucedido, habilite a trava privada por operação administrativa no projeto LKZ ISP (não disponível ao usuário comum no navegador).

### Ativar após teste completo

```sql
UPDATE lkz_private.lkz_isp_invitation_mailer
SET enabled=true,configured_at=now()
WHERE singleton=true
 AND sender_email='convites@lacrosetecnologia.com.br';
```

### Pausar imediatamente em caso de falha, abuso ou migração

```sql
UPDATE lkz_private.lkz_isp_invitation_mailer
SET enabled=false,configured_at=NULL
WHERE singleton=true;
```

## Fluxo e segurança preservados

O servidor verifica Auth real + JWT AAL2, permissões atuais do convidador e setor/empresa; limita os convites, evita duplicidades, exige e-mail confirmado e TOTP verificado para ativar o vínculo, rejeita criação de MASTER por convite e preserva auditoria. O e-mail do remetente é validado na tabela privada e também na função de envio. A conta MASTER original permanece `lacrose.igor@gmail.com` — **não mudar essa verificação**.

Enviar ao provedor não significa entrega na caixa do destinatário. A interface exibe a diferença entre pendente, solicitado, aceito e expirado. Sem domínio verificado ou configuração SMTP, deve falhar **fechado** (sem envio e sem ativação).

## Cuidados DNS

Antes de qualquer alteração, identificar no DNS existente se há serviços de correio, registros SPF e MX já em operação. Resend oferece registros específicos; não inventar valores, duplicar SPF no mesmo hostname ou sobrescrever um MX existente sem uma análise. O remetente de envio não precisa ser uma caixa postal, mas endereços de resposta devem ser monitorados em um serviço apropriado.

## Verificações

- Confirmar a função `lkzisp-user-invitations` ativa com `verify_jwt=true`.
- Confirmar que `lkz_private.lkz_isp_invitation_mailer` tem somente `convites@lacrosetecnologia.com.br` como endereço permitido, com `enabled=false` antes do SMTP validado.
- Conferir 58+ testes da plataforma, mais regressão v1.2, e o deployment GitHub Pages.
- Criar **convite real de teste somente após o SMTP validado**. Verificar e-mail recebido, senha definida pelo destinatário, MFA, vínculo no banco e auditoria. Não simular entrega como se fosse envio real.

Documentação:
- https://supabase.com/partners/catalog/resend
- https://supabase.com/docs/guides/auth/auth-smtp
- https://resend.com/changelog/smtp-service
