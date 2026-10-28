# LKZ ISP Intelligence — rota /lkzisp/

**Estado:** staging/revisão. Este diretório ainda não contém o aplicativo completo e não deve ser anunciado como uma versão de produção.

- A aplicação será uma PWA leve em `https://lacrosetecnologia.com.br/lkzisp/`, sem instalador Windows.
- Somente recursos estáticos públicos poderão ser incluídos neste repositório. Relatórios IXC, informações empresariais, dados de clientes, chaves de acesso e backups **nunca** serão versionados.
- O backend deverá residir em projeto Supabase separado, com autenticação MFA, perfis/escopos aplicados por RLS, autorização servidor, auditoria, backups independentes e restauração validada.
- Apenas agregados autorizados podem ficar no dispositivo, criptografados e vinculados ao usuário/empresa. A sincronização só ocorre depois de validar autenticação e permissões; operações críticas não são finalizadas offline.
- A Central de Resultados deverá priorizar problemas, indicar evidências, solicitar dados insuficientes, permitir revisão do Gestor e registrar plano corretivo somente via backend seguro.
- O domínio institucional e o arquivo CNAME existente **não devem ser modificados** para adicionar o diretório.

**Gate obrigatório:** antes de copiar o frontend completo para este diretório e mesclar na branch principal, concluir os testes RLS entre empresas e setores, login/MFA, controle de escrita financeira com evidências, sincronização, cópia/restauração, testes adversariais e revisão independente de segurança. Nunca publicar uma tela aparentemente autenticada que faça autorização apenas no navegador.

Documento de preparação e isolamento de escopo. Nenhuma alteração foi aplicada ao site principal nesta branch.