# LKZ ISP — convites automáticos pelo Gmail (remetente provisório)

**Remetente autorizado:** `lacrose.igor@gmail.com`. Não incluir senhas, app passwords ou chaves OAuth no repositório, em mensagens ou no código JavaScript.

## Configuração única pelo proprietário

1. Acesse sua **Conta Google** em [myaccount.google.com](https://myaccount.google.com/), com verificação em duas etapas ligada. Abra **Senhas de app** em https://myaccount.google.com/apppasswords. O Google pode não disponibilizar essa opção em todas as contas.
2. Gere uma senha de aplicativo exclusiva para **LKZ ISP SMTP**. Não envie essa senha ao ChatGPT nem a terceiros.
3. Acesse **Supabase exclusivo do LKZ ISP** → Authentication → SMTP Settings:
   https://supabase.com/dashboard/project/syysqoieyycclpfbadwp/auth/smtp
4. Configure o SMTP personalizado:
   - Sender email / From: `lacrose.igor@gmail.com`
   - Sender name: `LKZ ISP Intelligence`
   - Host: `smtp.gmail.com`
   - Port: `587` (STARTTLS/TLS; se necessário, `465` com TLS conforme a interface)
   - Username: `lacrose.igor@gmail.com`
   - Password: a **senha de aplicativo**, preenchida exclusivamente no painel protegido do Supabase.
5. Salve e use a função **Send test email**, se disponível, para um endereço sob seu controle. Confirme recebimento e remetente. Se o Gmail não aceitar SMTP, interrompa e diagnostique antes de liberar envios.
6. Com o teste concluído, confirme que o SMTP do Gmail foi configurado. O sinalizador de envio do LKZ ISP é inicialmente `false` para impedir o uso involuntário do SMTP-padrão do Supabase. O operador autorizado habilita o registro privado no banco **depois da verificação**. Não há mudança de custo autorizada.

### Habilitação controlada após comprovar o SMTP

Operação administrativa (não exposta a navegador), exclusivamente no projeto `syysqoieyycclpfbadwp`:

```sql
UPDATE lkz_private.lkz_isp_invitation_mailer
SET enabled = true, configured_at = now()
WHERE singleton = true
  AND sender_email = 'lacrose.igor@gmail.com';
```

Para suspender o envio imediatamente:

```sql
UPDATE lkz_private.lkz_isp_invitation_mailer
SET enabled = false
WHERE singleton = true;
```

Essas instruções **não** autorizam executar o `UPDATE enabled=true` antes de testar o SMTP.

## Fluxo implantado

1. MASTER / Gestor / Administrador cria convite da própria empresa e perfil permitido. MASTER não é convidável; Administrador não convida Gestor.
2. O banco grava convite pendente, audita e limita a um convite aberto por e-mail/empresa.
3. A função `lkzisp-user-invitations` verifica identidade real, JWT AAL2 e permissão atual, reserva um envio e aciona o e-mail Auth via SMTP configurado.
4. Para novos usuários o e-mail contém link de convite; pessoas já cadastradas recebem link de autenticação, sem criação de conta duplicada.
5. O destinatário cria a própria senha se for o primeiro acesso, confirma e-mail e cadastra/verifica MFA.
6. A função de aceite exige e-mail confirmado, MFA AAL2 e convite enviado e não expirado. O banco cria o vínculo de empresa e papel de forma não escalável, audita e marca convite aceito.
7. Tentativas de envio falhas ficam pendentes, com limite de tentativas e botão para novo envio. A aceitação não cria MASTER.

### Garantias e limites

- **Pendente não é enviado.** `sent` significa que o provedor de e-mail aceitou a requisição, não que a mensagem foi recebida na caixa de entrada.
- Uma única pessoa por empresa não muda de papel por outro convite; a divergência é bloqueada para revisão humana.
- Convite expira em sete dias no banco; o **link de Auth pode expirar antes**, conforme a configuração do projeto. Um link expirado não altera a permissão.
- Convites são restritos à empresa e acessíveis apenas aos perfis autorizados, com MFA.
- Sem SMTP habilitado, nenhum e-mail é disparado e nenhum vínculo é ativado.
- Não configurar credenciais SMTP no GitHub, nem em arquivo `.env` público.
- Senha de aplicativo Gmail e remetente provisório não são solução adequada para alto volume: no futuro migrar para domínio da Lacrose Tecnologia com SPF/DKIM/DMARC e serviço transacional.
- Usuários setoriais podem finalizar o cadastro, mas a interface de visualização setorial continua em desenvolvimento; liberar somente perfis com telas homologadas.
