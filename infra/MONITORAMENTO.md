# Monitor de Infraestrutura — Lacrose Tecnologia

Status: **implementado em branch de revisão**, sem mesclar na main e sem alterar o site público. A Edge Function `lacrose-admin-infra-monitor` foi criada separadamente no projeto Supabase institucional; as funções comerciais existentes não foram modificadas.

## Funcionamento

- O menu `Administração → Infraestrutura` aparece no painel existente `/admin/` após publicação da alteração de frontend.
- O navegador não recebe credenciais administrativas, tokens do GitHub, segredo do banco nem a string de conexão Postgres.
- `infra-monitor.js` usa a sessão atual para chamar a Edge Function por HTTPS.
- A Edge Function exige JWT válido (`verify_jwt=true`), valida o usuário via Supabase Auth, verifica `profiles.active=true` e `role IN ('master','admin')`, e só então consulta Postgres e GitHub.
- O banco Supabase do site retorna `pg_database_size` e soma de bytes nos metadados do Storage; relatórios empresariais e linhas pessoais **não** são retornados.
- GitHub: consulta `size` dos repositórios `igorlacrose/lacrosetecnologia` (público) e `igorlacrose/lcs-edge` (privado, depende de segredo opcional com privilégio mínimo).
- GitHub `size` é tamanho aproximado do repositório, não “espaço disponível”. Git LFS e Actions têm cotas independentes e **ainda não são consultados**.
- Supabase LKZ ISP é outro projeto e **ainda não está conectado** a esta função. Não adicionar service_role do outro projeto nem misturar dados.
- As referências 500 MiB PostgreSQL / 1 GiB Storage representam parâmetros do plano Free, não cotas apuradas da conta. O uso físico do disco (WAL etc.) é distinto do tamanho lógico.
- Os alertas 70/85/95% estão visuais nesta tela quando houver dados; automações de notificação proativa e histórico temporal ainda são pendentes.

## Segurança e liberação

1. Não mesclar até executar login real em conta `master/admin`, acesso bloqueado sem sessão e acesso bloqueado com perfil comum.
2. Validar função e console de rede para comprovar que apenas dados agregados são entregues.
3. Testar sem token GitHub, com repositório privado inacessível, falha de rede, recarga e sessão expirada.
4. Verificar que o site público, o agente e o painel de leads permanecem funcionando.
5. Confirmar limites do plano e custos antes de habilitar serviços adicionais.
6. Nenhum token é necessário para consultar o repositório público. Para métricas privadas futuramente, configurar segredo via painel Supabase usando token de leitura de escopo mínimo. Nunca colar segredos no frontend ou GitHub.
7. Para o LKZ ISP, integrar por mecanismo dedicado de coleta de **métricas agregadas** e autenticação cruzada; não introduzir uma chave de banco de produção em clientes web.

## Reversão

- Frontend: não mesclar o PR ou reverter apenas o commit após homologação.
- Backend: desativar/remover a função **nova** `lacrose-admin-infra-monitor`. As outras funções não dependem dela.
- O banco institucional não possui tabelas, policies ou RPC permanentes criados por esta integração.
