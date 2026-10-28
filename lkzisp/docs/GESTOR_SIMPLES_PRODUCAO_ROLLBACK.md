# LKZ ISP — Gestor Simples (produção)
## Regra de ativação
- Somente após sessão Supabase Auth AAL2 + vínculo autorizado de `gestor` ou `administrador` e leitura de agregados do tenant.
- MASTER, Financeiro e Líder de Setor continuam na interface original e com suas permissões.
- Nenhuma alteração em banco, RLS, autenticação ou integrações existentes. Sem dados fictícios.
- A tela do gestor usa Shadow DOM para isolar o CSS do protótipo aprovado de 28/10/2026, sem barra lateral.
- O botão **Minha conta → Abrir painel clássico** alterna a interface na mesma sessão, sem logout. No clássico, botão **Usar painel simples** retorna. A preferência não persiste para evitar gravação adicional de dados da conta.

## Dados e filtros
- Resumos **por cidade OU por setor** com base nas dimensões já importadas e autorizadas. Quando escolhe um, o outro filtro é limpo; não há cruzamento cidade × setor na origem.
- As pendências com mais de sete dias só existem no consolidado atual. Na cidade ou setor, o valor é mostrado como **—**, não como zero ou estimativa.
- Ao selecionar um filtro, a avaliação continua referindo-se **ao relatório integral**. Não há permissão de aprovação parcial.
- O CSV exporta apenas agregados, inclui marcação explícita para idade de pendências não calculável e protege contra fórmulas de planilha.
- A interface não faz requisições diretas: as operações continuam nas funções existentes de `CloudAccess`, sujeitas a autenticação, MFA, permissões/RLS e auditoria.
- Avaliações mantêm validação de justificativa entre 20 e 2000 caracteres, leitura de volta e imutabilidade no servidor.
- Sem relatório importado, não exibe dados demonstrativos.

## Rollback
1. Restauração instantânea do visual para a sessão: **Minha conta → Abrir painel clássico**.
2. Rollback padrão em código: altere somente `SIMPLE_GESTOR_DEFAULT=true` para `false` no arquivo `lkzisp/src/app.js` e publique com testes; os dois painéis permanecem.
3. Checkpoint imutável da base original no branch `checkpoint/lkzisp-gestor-classico-20261028` (commit `956e4a3483c89b00eba976fc5a56ad54a9b1cc2d`). O PR de implantação terá seu próprio commit de merge.
4. Nunca restaurar o banco para voltar ao visual; a interface é isolada, logo nenhuma decisão do Gestor ou dado novo deve ser apagado.

## Homologação
- CI com teste de MFA/RBAC, dados reais agregados, filtro independente, segurança e regressão da interface clássica.
- Como não há login do usuário de teste nesta automação, não se deve afirmar que o fluxo real de aprovação está validado ponta a ponta antes de testar com um Gestor autenticado.
