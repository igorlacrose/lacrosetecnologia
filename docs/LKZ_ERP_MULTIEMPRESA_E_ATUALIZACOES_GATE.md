# LKZ ERP — Correção multiempresa e atualizações remotas (14/11/2026)

## Situação confirmada, sem inferir produção

- O usuário confirmou que o **LKZ ERP 1.3.3 já está instalado no computador do cliente**. Não há acesso direto neste repositório ao executável instalado, à pasta de dados ou à árvore atual do Codex em Darkstar/Osiris.
- A fonte arquivada `LKZ-ERP-1.3.3-QA-Cadastro-Tributario-Codigo-Fonte.zip` (05/11) apresenta `emissionEnabled: false`; `fiscal_profile.go` rejeita `UF != BA` e `product_tax.go` considera cadastro completo apenas para Simples Nacional. Esses limites devem ser removidos **por ampliação de regras e testes reais**, nunca apenas eliminando as validações.
- O executável de `cmd/installer-upgrade` da fonte arquivada ainda é **legado 1.2.9**. Não utilizar no cliente 1.3.3.
- A autoridade Ed25519 de licenças está em **homologação**, PR #109, não na instância comercial definitiva.
- Este PR prepara apenas o **registro e a descoberta segura de updates assinados**, não publica pacotes e não altera o ERP instalado.

## Regra definitiva do produto

**Uma base de código e um instalador por versão**, parametrizados para cada contratante. Cada empresa tem dados, CNPJ, regras fiscais, certificado, CSC, série, numeração, estoque, financeiro, usuários e licença isolados. A primeira modalidade suporta **uma empresa por instalação**; suporte a múltiplos CNPJs na mesma instalação exige isolamento adicional e testes específicos antes de ser anunciado.

### Fiscal: configurações editáveis NÃO são tributos universais

1. Cadastro da empresa: CNPJ, nome, IE, UF, município/IBGE, CRT/regime, ambiente de homologação/produção, A1, CSC por ambiente, série e numeração.
2. Catálogo: NCM, CEST condicional, origem, unidade comercial/tributável, GTIN e classificações validadas.
3. Operação: regras por UF, remetente/destinatário, finalidade, regime, CFOP, ICMS CSOSN/CST, PIS, COFINS, IPI, ST, benefícios, IBS/CBS/RTC e exceções. Cada regra precisa ser **versionada, editável por perfil autorizado e auditada**.
4. Nunca inserir um CSOSN, CST, CFOP, NCM, IE ou CNPJ fixo como regra universal. CRT 1/CSOSN 102/PIS 99/COFINS 99 são EXEMPLOS de uma contabilidade, não valores para outros clientes.
5. A seleção de UF e CRT deve controlar regras, endpoints SEFAZ, versões de NT/XSD e prontidão fiscal; configuração inválida bloqueia **somente a emissão correspondente** com diagnóstico claro, sem bloquear backup, leitura de vendas antigas ou regularização fiscal.
6. Homologar NFC-e modelo 65 e NF-e modelo 55 conforme a operação e UF, com XML-DSig, A1, CSC, consulta por chave, protocolo, idempotência, eventos, DANFE e impressora. Sem cStat 100 válido com nProt, emissão não está autorizada.

## Primeiro update para cliente já instalado: bootstrap manual seguro

A versão 1.3.3 QA arquivada **não dispõe de agente de atualização remota de produção comprovado**. Não existe mecanismo seguro de instalar remotamente um atualizador que não esteja instalado. Portanto:
- **Ponte 1.3.4:** preparar em Darkstar/Osiris o novo atualizador Windows x64, instalar inicialmente no computador piloto com acesso local/autorizado, sem sobrescrever a 1.3.3; preservar dados existentes; provar backup e restauração.
- Depois desse bootstrap, o **agente instalado** poderá consultar por HTTPS o manifesto, baixar e validar os pacotes e executar a atualização com segurança. Nada de porta de entrada exposta, execução arbitrária, script de administrador público ou download direto sem assinatura.
- Aplicar atualização somente com ERP fechado e operações transacionais concluídas; registrar versão anterior, novo estado, migrações compatíveis e retorno à anterior. Banco migrado pode exigir **restore**, não simples downgrade binário.
- **Nunca** trocar a chave pública de updates por chave fornecida dinamicamente pelo servidor no momento da atualização. Fixá-la no atualizador, com rotação planejada.

## Protocolo do plano de distribuição

Branch técnica baseada na autoridade da PR #109; novos arquivos:
- `supabase/migrations/20261114224500_lkz_updates_signed_registry.sql`: signatários **públicos** de releases, versões, canal `pilot/stable`, aprovador, liberação e grupos de clientes.
- `supabase/functions/lkz-updates/`: `POST /check` por CNPJ, instalação já licenciada e versão; valida a assinatura Ed25519 **separada da chave de licenciamento**, versão crescente, SHA-256, tamanho, identidade e caminho permitido.
- O cliente recebe `manifest` Base64URL, `signature` Base64URL, `keyId`, `downloadUrl` temporária (15 min) e `expiresIn` quando houver pacote confiável aprovado.
- Arquivos ZIP ficam no futuro bucket **privado** `lkz-update-packages`. O bucket **não foi criado** e nenhum instalador foi enviado nesta etapa.
- A assinatura do manifesto deve ser feita **offline em Darkstar/Osiris** por ferramenta revisada, com chave privada guardada em cofre/DPAPI/HSM. O servidor aceita apenas a **chave pública** do signatário; nunca reutiliza a chave privada de licença.
- **Pilot** alcança somente licenças incluídas em `update_pilot_targets`. **Stable** alcança as licenças compatíveis, após promoção explícita e assinatura.
- O cliente deve verificar assinatura do manifesto com chave fixa, SHA-256 **após download**, assinatura Authenticode do instalador, compatibilidade de plataforma, versão, escopo e não regressão **antes da execução**.

## Homologação do serviço de atualização (14/11/2026)

- Migração `lkz_updates_signed_registry_isolated` aplicada no Supabase **homologação** `nijsafzwxzcfqdevlsxe`, sem mexer no Supabase comercial.
- Edge Function `lkz-updates` v1 **ACTIVE**: `POST https://nijsafzwxzcfqdevlsxe.supabase.co/functions/v1/lkz-updates/check`.
- Instalação não registrada: **HTTP 404**, sem metadados nem acesso ao pacote.
- Instalação fictícia autorizada, sem release publicada: **HTTP 204**, corretamente sem download. Fixture criada sob CNPJ `00000000000000` e ID `f` × 64 e excluída em seguida (contagem de fixtures remanescentes: zero).
- Permanecem **2 licenças e 2 instalações** cadastradas previamente por outro trabalho em homologação. Foram preservadas sem alteração.
- Nenhuma chave pública de **updates** cadastrada, nenhum release, nenhum artefato em Storage, nenhum instalador enviado.
- Advisor do Supabase sem WARN/ERROR. Informativos `rls_enabled_no_policy` são esperados para tabelas privadas **sem policies e sem GRANT**.
- CI da PR cobre assinatura Ed25519, adulteração de manifestos, downgrade, escolha por tenant e proibição de comandos arbitrários. Esse CI **não** substitui testes de instalação/rollback em Windows.
- **Chave Ed25519 de atualização não é a mesma chave pública Ed25519 de licenciamento** já fornecida ao Codex. A primeira ainda deverá ser gerada/custodiada no laboratório e fixada no atualizador.

## Portal de gestão LKZ ADM — etapas ainda NÃO implementadas

- MASTER+MFA, autorização no servidor e auditoria para: vincular instalação; conceder **cortesia** com justificativa, expiração e distinção de cobrança; registrar pagamento confirmado, suspender, cancelar, reativar com aprovação; manter limite por licença.
- Para updates: upload autenticado por operador, validação de conteúdo/tamanho/hash/assinatura, revisão e aprovação explícita, escolha do canal e destinatários, **revogação de releases** e monitoramento de resultados. Nenhum secret em navegador.
- Isolar por tenant. Pessoas não administradoras não podem ativar licenças, trocar chave pública ou publicar updates, mesmo modificando a requisição no DevTools.
- Checkout e webhooks de pagamento verificados, idempotentes; pagamento `dinheiro` confirmado manualmente por usuário autorizado no caixa com auditoria. Cortesia não deve criar pagamento fictício.
- Gate de backups: restauração real do servidor comercial e dados locais; DPAPI/CSC/A1 e semente Ed25519 resguardados.

## Critérios de aceite do primeiro cliente real

- [ ] Confirmar build/hash, paths reais, esquema de dados e funcionamento do ERP 1.3.3 instalado (somente leitura).
- [ ] Backup local e restauração isolada validada antes de atualizar.
- [ ] Atualizador bootstrap assinado e aprovado no Windows x64 físico, rollback testado; preservar dados e a versão anterior.
- [ ] Licença específica do cliente ativa na **autoridade comercial definitiva**, sem reutilizar chave de homologação.
- [ ] Upload de versão 1.3.4 piloto assinado no painel com MFA, arquivo privado e aprovação.
- [ ] Manifesto validado com chave pública fixada, SHA e Authenticode corretos; recusar adulteração e downgrade.
- [ ] Testar falha de rede, instalação interrompida, disco cheio, falta de permissão, versão incompatível, suspensão e restauração.
- [ ] Emitir NFC-e de homologação real com retorno autorizador; testes fiscais e operacionais antes de vendas reais.
- [ ] Promover para demais clientes somente após aceitar o piloto, sem afirmar que QA significa produção.

**Situação:** catálogo/API de distribuição ainda em PR; sem registros de releases publicadas, sem cliente remotamente atualizado e sem publicação do painel operacional de assinaturas.
