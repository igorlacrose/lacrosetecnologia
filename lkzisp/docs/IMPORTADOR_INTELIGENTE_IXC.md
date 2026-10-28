# LKZ ISP Intelligence — importador inteligente de relatórios IXC

Estado: requisito APROVADO, implementação **em andamento**. Este documento não comprova habilitação automática em produção.

## Escopo

- Fonte admitida por enquanto: **relatórios exportados do IXC** (XLSX/CSV).
- Ao carregar: identificar modelo por cabeçalhos (sem interpretar ou armazenar colunas sensíveis), validar, apresentar prévia com campos e cálculos, exigir confirmação e então salvar dados saneados.
- Cada **tipo de relatório validado** pode habilitar automaticamente um **módulo funcional no menu da empresa**, com telas, indicadores, filtros, histórico e permissões, persistente entre logins; não apenas uma tabela de importação.
- A aplicação deve combinar relatórios complementares no mesmo módulo por competência e empresa, impedindo somas duplicadas e permitindo revisão humana de divergências.
- Relatórios de formato desconhecido: mostrar **proposta de mapeamento**, nunca criar métricas ou tabelas arbitrárias, não afirmar sucesso, não transmitir linhas brutas. Mapear conscientemente primeiro; salvar template versionado depois de aprovado.
- Não interpretar nome de arquivo como prova de origem: exigir associação ao IXC na etapa de importação e validações por layout, cabeçalhos e conteúdo.
- Suportar evolução dos layouts IXC por **templates versionados**, não por migrações SQL para cada arquivo.

## Módulos-alvo

| Família de relatório IXC | Módulo pretendido | Estado atual |
| --- | --- | --- |
| Atendimento / Ordens de Serviço | Operação, Produtividade, Ineficiência | Implementado para layout já homologado |
| Financeiro | Receitas, despesas, inadimplência, margem | Não implementado — requer exemplo real e regras de classificação |
| Comercial / Vendas | Funil, conversões e produtividade comercial | Não implementado — requer exemplo real |
| Cancelamentos | Churn, motivos e histórico | Não implementado — requer exemplo real |
| Outros relatórios IXC | Módulo proposto para confirmação | Não implementado; NUNCA habilitar automaticamente sem homologação |

**Não presumir que colunas iguais têm a mesma semântica** em relatórios diferentes.

## Contrato de mapeamento

Cada template requer: `template_id`, `template_version`, `source_system='IXC'`, `report_family`, `required_columns`, `optional_columns`, `allowed_fields`, `validation_rules`, `metric_calculators`, `module_id`, `permissions` e `retention_class`. Declarativo e aprovado em revisão: **NUNCA executar fórmulas, scripts ou SQL originados da planilha**.

## Privacidade

- Identidades **de clientes**: nome, CPF/CNPJ, telefone, endereço, contrato, login, senha, hash PPPoE, mensagens e texto livre **excluídos**.
- Identidades de **colaboradores**: nome/setor e métricas operacionais podem ser mantidos em tabela específica sob escopo de organização, RLS, MFA e política de retenção.
- Logs e auditorias não registram células brutas, URL com token, e-mail pessoal de cliente ou cabeçalhos completos quando desconhecidos.
- Se um modelo exigir uma informação sensível para KPI, revisar necessidade e base legal antes de aprovação.

## Persistência e integridade

- Empresas segregadas por tenant, RLS obrigatória.
- Registro de modelo do relatório + versão; lote de importação + SHA-256 de conteúdo saneado e assinatura do arquivo para **duplicidade exata**.
- Replicar o mesmo período com dados alterados requer revisão, não sobrescrita silenciosa.
- Publicar novo módulo somente após commit atômico validado, leitura de confirmação e registro de auditoria.
- Backup e restauração devem abranger templates, módulos e indicadores persistidos.

## Testes de aceitação exigidos

1. Atendimento IXC já homologado mantém números e não duplica importação anterior.
2. Relatório financeiro IXC reconhecido (depois de homologado) cria e exibe módulo Financeiro no menu da empresa; ao sair e entrar, o módulo permanece e mostra dados salvos.
3. Um segundo relatório da mesma família atualiza histórico sem recriar módulo nem duplicar valores.
4. Arquivo desconhecido mostra mapeamento e impede a criação de indicador falso.
5. Arquivo contendo colunas de cliente/senha: esses campos não são enviados ao backend em hipótese alguma.
6. Usuário de outro tenant, sem MFA ou com perfil não autorizado não enxerga módulos/dados.
7. Backup/restore + auditoria + rollback de template são comprovados.
8. Cada novo modelo requer verificação com exportação real do IXC, não apenas com dados sintéticos.

## Entrega

Não declarar `Importador Inteligente pronto` até haver pelo menos **um segundo tipo de relatório IXC**, diferente de atendimentos, criando módulo persistente com testes ponta a ponta. Enquanto isso, continuar informando no sistema quais formatos estão realmente suportados.
