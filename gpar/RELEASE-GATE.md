# Gestão de Parcerias (GP/BI) — candidata de produção, NÃO PUBLICAR

Data: 2026-10-27. URL final pretendida: https://lacrosetecnologia.com.br/gpar/

## Estado verificado

- Os arquivos index.html, styles.css e app.js vieram da prévia v1.3 fornecida no chat.
- Importação XLSX/CSV/TSV, cadastros, lançamentos manuais, gráficos, relatórios PDF e fluxo de WhatsApp existem no frontend.
- O projeto do site principal está em GitHub Pages; a branch de preparação **não deve ser mesclada em main** antes do security gate.
- A v1.3 **não tem login, banco permanente ou trilha de auditoria**, nem fechamento/vigência histórica de percentuais.
- Sem backend, os dados não sobrevivem a um fechamento de navegador sem salvar/restaurar JSON manualmente.
- Os valores por sócio são **SIMULAÇÕES**, nunca liquidar pagamentos a partir desse cálculo.
- As configurações de White Label são locais; o crédito "Desenvolvido por Lacrose Tecnologia" fica fixo na UI, mas não é à prova de edição do código publicamente servido.

## Gate bloqueador de publicação

1. Criar autenticação real, sessões seguras e mecanismo de recuperação sem divulgar tokens/segredos. Administrador com MFA quando cabível.
2. Implementar persistência transacional no backend (não localStorage/IndexedDB como fonte contábil). Separar parceiros, empresas e lançamentos por organização; RLS deny-by-default, testes anon, usuários indevidos e cross-tenant.
3. Validar valores, datas, limites, categoria e permissões no backend, inclusive contra repetição de planilhas e importações parciais.
4. Preservar **versões dos percentuais e da base bruta/líquida por vigência**, com fechamento mensal imutável, reabertura autorizada e trilha de auditoria de alterações/estornos.
5. Implementar backups agendados, retenção e **restauração comprovada**; monitoramento de falhas, conflito de edição, indisponibilidade e inconsistências financeiras.
6. Segurança: segredo exclusivamente no servidor; checagem de dependências, XSS/CSRF conforme arquitetura, CSP, limites de upload, logs sem dados sensíveis e revisão LGPD.
7. Testes ponta a ponta no domínio final em desktop e celular: cadastrar/editar empresas, sócios, percentuais e lançamentos, importar XLSX/CSV, recarregar/relogar, verificar isolamento, imprimir PDF A4, baixar arquivo, enviar PDF WhatsApp por fluxo explícito e comparar totais.
8. Revisão de regressões no ERP, FluX, home e GitHub Pages; checkpoint da branch principal e plano de rollback.
9. Somente após validação em ambiente separado promover código revisado para main e conferir HTTPS e https://lacrosetecnologia.com.br/gpar/.

## Política de deploy

**Bloqueado por padrão**: este diretório contém código experimental v1.3, e não constitui homologação de produção. Não há dados reais, senhas ou chaves privadas neste commit. Não publicar v1.3 como se fosse segura para uso financeiro real.

## Observações para continuidade

- Supabase conectado: o projeto ativo possui recursos de outras aplicações. Não alterar tabelas/configurações existentes; preferir projeto ou namespace dedicado e revisar custos antes da provisão.
- Antes de integrar o executável Jequié Telecom v1.0, recuperar projeto-fonte original e conferir regras de distribuição e fechamento efetivamente implementadas.
