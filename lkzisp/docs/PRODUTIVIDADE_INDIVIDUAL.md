# LKZ ISP Intelligence — produtividade individual v0.9

## Objetivo

Relatórios operacionais devem identificar **colaboradores**, não clientes. Colunas lidas do IXC: `Status`, `Assunto`, `Setor`, `Cidade`, `Abertura`, `Fechamento`, `Prioridade` e **`Colaborador`**. Somente as oito colunas aprovadas são projetadas da planilha no importador. O arquivo de origem não é enviado.

**Nunca persistir/exibir**: Cliente, CPF, endereço, números de telefone, e-mail de cliente, contrato, protocolo, ID de atendimento, login ou senha/hash PPPoE/Hotspot, mensagem e texto livre.

## Proteção dos colaboradores

- `Colaborador` é **dado pessoal de trabalhador**, tratado apenas para finalidade de gestão operacional e com transparência interna; não é dado público nem anônimo.
- Nomes e contagens individuais ficam em `public.lkz_isp_employee_metrics`, com RLS: MFA AAL2 + MASTER, Gestor ou Administrador da empresa. Usuários de setores e visitantes não acessam esta tabela enquanto não houver política específica de equipe aprovada.
- Não usar nome em URL, logs, identificador público, exportação executiva ou backup geral de estatísticas.
- Persistir por operação atômica `lkz_isp_save_snapshot_with_employees` (resumo + funcionários). Verificar gravação por leitura autorizada antes de declarar sucesso.
- Snapshot e métricas são append-only. Duplicação só é idempotente se todas as métricas individuais coincidirem; divergência é rejeitada.
- Histórico previamente gravado sem funcionários pode ser complementado por reimportação do mesmo relatório, reconciliada pelo fingerprint legado. Preservar original para auditoria.

## Indicadores atuais

Por **nome e setor**: atribuídos, finalizados, pendentes, pendências abertas há mais de 7 dias, finalizações com duração cronológica acima de 24 horas e percentual de finalização (exibido apenas a partir de 5 atendimentos). Registros sem `Colaborador` não são atribuídos arbitrariamente.

Não calcular automaticamente prêmio, penalidade ou demissão. Comparações justas dependem de jornada efetiva, afastamentos, composição de chamados, dificuldade técnica, retrabalho, responsabilidade de cliente/terceiro, qualidade e metas previamente comunicadas. `Fechamento +24h` **não** é violação comprovada de SLA.

## Privacidade e governança

Responsável pelo tratamento deve informar equipe sobre finalidade, métricas, acesso e política de retenção; definir base legal adequada, manter segurança, corrigir dados inexatos e permitir contestação/revisão humana. A LGPD não proíbe a gestão da produtividade, mas requer necessidade, transparência e controles (Lei 13.709/2018, art. 6º).

Referências:
- https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_legitimo_interesse.pdf

## Homologação e pendências

Automação de bônus, indicadores de qualidade/retrabalho, revisão de objetivos, retenção, backup criptografado incluindo dados identificáveis, exportação individual restrita e validação de autenticação no dispositivo real **ainda pendentes**. Não afirmar maturidade completa do módulo até essas etapas.
