# LKZ ISP → IXC (somente leitura) — Etapa 1

**Estado:** código preparado, testes sintéticos; **não conectado ao IXC real** e **não publicado em produção**.

O primeiro passo é descobrir exclusivamente nomes e tipos de tabelas/colunas no INFORMATION_SCHEMA; não consulta registros, clientes, CPFs, valores financeiros ou senhas. Apenas metadados são exibidos. A porta 3306 não é acessível a partir do ambiente de execução do assistente (também há bloqueio geral de saída nesta rede); isso **não** significa que o IXC esteja fora do ar.

## Antes de executar

- Operar **em host privado autorizado** pela equipe do IXC, idealmente VPN ou rede interna, com MySQL acessível e IP permitido.
- Solicitar ao administrador a cadeia de certificados **CA PEM** e o nome no certificado do servidor; **TLS validado é obrigatório**, não afrouxar a verificação.
- Confirmar privilégios limitados a SELECT e metadados; não confiar apenas no nome da conta.
- Manter senha e certificados fora do repositório, navegador e histórico de comandos. A credencial enviada no chat deve ser considerada exposta, ainda que só leia dados.
- Ter Node.js 22+ e instalar a dependência fixada com `npm install --omit=dev`. Executar num host fora da hospedagem estática.

## Executar no Windows (PowerShell)

```powershell
cd caminho\para\backend\ixc-connector
npm install --omit=dev
$env:IXC_DB_HOST = 'ENDERECO_AUTORIZADO'
$env:IXC_DB_PORT = '3306'
$env:IXC_DB_USER = 'LEITOR'
$env:IXC_DB_NAME = 'BANCO_AUTORIZADO'
$env:IXC_DB_TLS_CA_FILE = 'C:\certificados\mysql-ca.pem'
# Definir se o certificado usa DNS diferente do IP no campo host:
# $env:IXC_DB_TLS_SERVERNAME = 'mysql.interno.exemplo'
$senha = Read-Host 'Senha de leitura' -AsSecureString
$env:IXC_DB_PASSWORD = [System.Net.NetworkCredential]::new('', $senha).Password
npm run inspect
Remove-Item Env:\IXC_DB_PASSWORD -ErrorAction SilentlyContinue
$senha = $null
```

A saída mostra contagens e candidatas por área: atendimentos, ordens de serviço, cidades/setores/equipes, contratos e financeiro. Para obter um relatório **local** de metadados detalhados, defina `IXC_SCHEMA_OUTPUT` como caminho fora do diretório público. O arquivo não é sobrescrito e deve ficar privado. **Não envie senhas, dados de clientes nem o dump do banco para o chat.**

## O que falta para realmente integrar

1. Executar a inspeção numa rede autorizada com CA do MySQL.
2. Conferir nomes reais das tabelas, relacionamentos e índices antes de montar consultas.
3. Definir limites por período, empresa, cidade e setor; validar desempenho do banco operacional e segurança LGPD.
4. Desenvolver coletor privado (não navegador) com cofre de segredos e sincronização de **agregados minimizados** no Supabase.
5. Homologar os indicadores com a exportação do IXC antes de expor ao Gestor.

**Isolamento e rollback:** este protótipo está numa branch, em `backend/ixc-connector/`. **Não fazer merge num repositório servido inteiramente pelo GitHub Pages** antes de garantir que o backend não será publicado como arquivo estático. Nenhum banco foi modificado e o LKZ ISP v138 continua inalterado.
