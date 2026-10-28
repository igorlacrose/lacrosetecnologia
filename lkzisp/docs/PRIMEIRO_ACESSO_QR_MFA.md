# LKZ ISP — Primeiro acesso e aplicativo autenticador

## Primeiro acesso por convite

1. Abra o link enviado pelo LKZ ISP no e-mail informado pelo administrador.
2. Defina uma senha exclusiva de pelo menos 12 caracteres. Não envie senhas ao MASTER.
3. A aplicação solicitará um novo fator TOTP ao Supabase Auth e exibirá o **QR Code do próprio Supabase**.
4. Abra Google Authenticator, Microsoft Authenticator ou outro autenticador compatível no celular e escolha **adicionar conta** → **ler QR Code**.
5. Digite os seis números gerados pelo aplicativo e confirme. A conta só recebe vínculos de empresa e dados após a verificação MFA AAL2 no servidor.
6. Se estiver no mesmo celular e não conseguir escanear, abra **Usar chave manual** e cadastre o segredo no app com o tipo **baseado em tempo (TOTP)**.

## Cadastro interrompido antes da confirmação

Se a configuração anterior ficou pendente e o QR se perdeu, volte à página e clique em **Gerar QR Code do autenticador** (ou **Gerar novo QR Code**). A aplicação elimina **apenas fatores com status `unverified`** da sessão autenticada, pedindo ao Supabase um novo fator. O fator anterior é invalidado. Nenhum fator verificado é apagado.

## Segurança

- QR emitido pelo Supabase Auth e mostrado por `img src=data:image/svg+xml`, sem chamadas a geradores externos.
- Segredo e QR ficam na memória da sessão, nunca em localStorage, IndexedDB, logs, links de terceiros ou banco de aplicação.
- QR e segredo são apagados da UI após a confirmação, logout e encerramento por inatividade.
- Não compartilhar QR, chave manual ou código de seis dígitos; MFA verificado continua obrigatório para ler informações da empresa.
- Se o usuário já possui MFA verificado e perdeu o autenticador, não recriar automaticamente: recuperar pelo fluxo administrativo autorizado, sem bypass.
- Rollback: branch `checkpoint/lkzisp-before-mfa-qr-20261028` (base v1.4).

## Verificação

Testar com conta nova de teste, usuário com fator `unverified` e usuário com fator `verified`, confirmando que os perfis não obtêm dados com sessão AAL1. Verificar no computador e celular. CI estática não substitui testes reais de convite e autenticação.
