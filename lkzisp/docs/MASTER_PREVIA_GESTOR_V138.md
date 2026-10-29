# LKZ ISP — Prévia do Gestor no MASTER (v138)

## Requisito aprovado
O MASTER precisa visualizar e navegar pela interface simples do Gestor sem sair da própria conta.

## Comportamento implementado
- Botão **Visualizar painel do Gestor** na barra superior do MASTER, apenas após login Supabase com MFA AAL2, vínculo `master` da empresa **atualmente selecionada** e indicadores já carregados.
- A prévia reutiliza a interface simples aprovada com os **dados agregados reais já autorizados ao MASTER**, sem simulações e sem dados brutos de clientes.
- Faixa persistente **Pré-visualização MASTER · Somente leitura** e botão **Voltar ao painel MASTER** no topo; opção equivalente em **Minha conta**.
- Os controles de aprovação, reprovação, exportação, impressão e sair foram bloqueados no modo prévia; nenhuma decisão é enviada ao Supabase, nenhum papel é modificado e não ocorre impersonação.
- A navegação entre páginas e filtros permanece interativa para fins de homologação. A atualização de indicadores é somente leitura.
- Alterações de sessão, perda de MFA, vínculos ou tenant desativam a prévia e fazem o sistema retornar ao modo normal.
- O MASTER mantém todo o painel clássico e os seus módulos. Gestores e Administradores permanecem com a interface simples real e suas permissões originais.
- Nenhuma alteração no banco, em RLS, nas Edge Functions ou no cadastro de usuários.

## Divergência de vínculos observada nos prints
O print de 29/10 mostra o e-mail `informatica@cesmt.com.br`, mas linhas `master` e `administrador` no quadro de vínculos. A consulta **read-only** direta ao Supabase no mesmo período retornou **apenas um vínculo gestor** para esse e-mail. Essa inconsistência demanda revalidação da origem/estado da sessão apresentada no navegador; **não foram alteradas permissões**. Nunca elevar privilégios automaticamente pelo que a tela apresenta.

## Rollback
- A prévia é opt-in (apenas ao clicar no botão). **Voltar ao painel MASTER** fecha imediatamente.
- O checkpoint anterior `checkpoint/lkzisp-before-master-gestor-preview-20261029` aponta para `f6bade384d3f0c63599ec762ee2da67845380f40`.
- A versão clássica está preservada em `checkpoint/lkzisp-gestor-classico-20261028`.
- Sem migração de banco; rollback de interface não deve reverter decisões, vínculos ou dados da operação.

## Validação
Testes automatizados cobrem bloqueio da prévia para não-MASTER/sem MFA, identificação visual, navegação com agregados, desativação de aprovações/exportação e retorno ao MASTER. Homologação visual no navegador autenticado ainda necessária.
