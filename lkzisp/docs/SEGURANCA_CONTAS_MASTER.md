# LKZ ISP — Recuperação administrativa de contas (v1.5, implementação em branch)

> **ESTADO:** desenvolvimento e testes estáticos. NÃO homologado nem ativado no Supabase de produção. Não confundir commit em branch com implantação.

## Permissão decidida

Somente o MASTER cadastrado em `lkz_private.lkz_isp_system_masters`, com JWT AAL2 **e um novo desafio TOTP confirmado pelo Supabase para cada operação**, pode:
- consultar usuários efetivamente vinculados ao LKZ ISP (inclusive a própria conta);
- solicitar recuperação de senha para o e-mail confirmado de um usuário;
- apagar fatores MFA/TOTP de um usuário, inclusive da própria conta MASTER, para exigir reconfiguração no próximo acesso.

Gestor, Administrador, Líder e Financeiro não recebem essas operações. A leitura de e-mails e as mudanças são feitas pelo backend privilegiado, nunca pelo cliente. Service role permanece nas variáveis protegidas do Supabase Edge Functions.

## Diferenciar recuperação de revogação

**Solicitar recuperação não revoga imediatamente a senha atual.** O MASTER não vê nem define senhas; o titular recebe link do Supabase Auth e escolhe a nova senha. A revogação imediata da credencial antiga e de todas as sessões ainda precisará de desenho, integração e testes adicionais. Não anunciar "senha revogada" após solicitação de e-mail.

Resetar MFA apaga os fatores registrados pelo Auth Admin. Conforme a documentação do Supabase, a exclusão de um fator verificado encerra sessões ativas; JWTs existentes podem permanecer válidos até expirar, logo ações sensíveis continuam exigindo autorização atual e MFA adequado. Não apagar usuários, vínculos ou auditoria.

## Autorredefinição do MASTER

A própria conta MASTER pode executar a operação **enquanto ainda tem acesso ao seu TOTP ativo**. Depois de excluir seu fator, a sessão local e sua sessão confiável são encerradas e o próximo login deve exigir cadastro e verificação de novo fator.

Se o MASTER **perdeu todos os fatores**, ele não pode iniciar uma operação usando somente login/senha ou e-mail: isso seria contornar a MFA. A recuperação de emergência deve ocorrer fora da plataforma, por administrador autorizado do projeto Supabase e identificação independente, com registro de incidente e revisão. Cadastre e proteja previamente um TOTP secundário de contingência. Não manter bypass permanente.

## Gate de produção

1. Verificar funcionamento do SMTP Auth do Supabase, envio, destinatário e alteração de senha por link; não habilitar envios só pelo fato de o domínio Resend estar Verified.
2. Aplicar migração privada de trilha de auditoria e rate limit; conferir `EXECUTE` exclusivo para `service_role`, RLS e auditoria.
3. Publicar a nova Edge Function somente com `verify_jwt=true`, checar cabeçalhos e segredos em Supabase Secrets.
4. Com **duas contas de teste sem dados reais**, validar MASTER → Gestor, MASTER → MASTER (self) e negativas para usuário comum, sem MFA, código inválido, alvo sem vínculo, outra organização e tentativas excessivas.
5. Confirmar que o link chega apenas ao e-mail confirmado do titular e que o serviço não retorna códigos, tokens, links ou senhas.
6. Verificar remoção de fatores com read-back do Supabase, logout real e fluxo de novo cadastro TOTP; observar que falhas parciais em contas com múltiplos fatores devem ser tratadas explicitamente.
7. Testar backup/rollback das definições e restauração do acesso MASTER. Só depois mesclar o PR e publicar frontend.

A ação de senha usa recuperação, não força troca imediata. A ação MFA é sensível/irreversível sem re-enrolamento. Não utilizar a conta MASTER real no teste inicial.
