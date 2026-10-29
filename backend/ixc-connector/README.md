# LKZ ISP → IXC (somente leitura) — Etapa 1

**Estado:** descoberta de metadados com testes sintéticos e TLS local usando o driver real; **não conectado ao IXC real** e **não publicado em produção**.

O primeiro passo é descobrir exclusivamente nomes e tipos de tabelas/colunas no INFORMATION_SCHEMA; não consulta registros, clientes, CPFs, valores financeiros ou senhas. Apenas metadados são exibidos. Não conectar antes da liberação do IPv4 de saída pelo responsável IXC. Resultados de redes anteriores não comprovam o estado da rede OCI.

## Antes de executar

- Operar **em host privado autorizado** pela equipe do IXC, idealmente VPN ou rede interna, com MySQL acessível e IP permitido.
- Solicitar ao administrador a cadeia de certificados **CA PEM** e o nome no certificado do servidor; **TLS validado é obrigatório**, não afrouxar a verificação.
- Usar esse **hostname DNS** em `IXC_DB_HOST`. O MySQL2 3.24.6 valida a identidade com `ssl.verifyIdentity:true` e deriva o nome de `host`; ignora `ssl.servername`. IP literal e nome TLS alternativo diferente do host são recusados. O administrador deve disponibilizar resolução DNS na rede autorizada.
- Confirmar privilégios limitados a SELECT e metadados; não confiar apenas no nome da conta.
- Manter senha e certificados fora do repositório, navegador e histórico de comandos. A credencial enviada no chat deve ser considerada exposta, ainda que só leia dados.
- Ter Node.js 22+ e instalar a árvore do lockfile com `npm ci --omit=dev --ignore-scripts`. Executar num host fora da hospedagem estática.

## Executar no Windows (PowerShell)

```powershell
cd caminho\para\backend\ixc-connector
npm ci --omit=dev --ignore-scripts
$env:IXC_DB_HOST = 'mysql.interno.exemplo'
$env:IXC_DB_PORT = '3306'
$env:IXC_DB_USER = 'LEITOR'
$env:IXC_DB_NAME = 'BANCO_AUTORIZADO'
$env:IXC_DB_TLS_CA_FILE = 'C:\certificados\mysql-ca.pem'
$senha = Read-Host 'Senha de leitura' -AsSecureString
$env:IXC_DB_PASSWORD = [System.Net.NetworkCredential]::new('', $senha).Password
try { npm run inspect }
finally {
 Remove-Item Env:\IXC_DB_PASSWORD -ErrorAction SilentlyContinue
 $senha = $null
}
```

A saída mostra contagens e candidatas por área: atendimentos, ordens de serviço, cidades/setores/equipes, contratos e financeiro. Para obter um relatório **local** de metadados detalhados, defina `IXC_SCHEMA_OUTPUT` como caminho fora do diretório público. O arquivo não é sobrescrito e deve ficar privado. **Não envie senhas, dados de clientes nem o dump do banco para o chat.**

## Prazos, recursos e testes

- Conexão: 7 segundos; cada operação, inclusive rollback e encerramento: 10 segundos; sessão inteira: 90 segundos. `IXC_QUERY_TIMEOUT_MS` aceita de 1 a 30000 e `IXC_TOTAL_TIMEOUT_MS` de 1 a 120000. Zero não desativa os limites.
- Ao atingir o prazo, interrompe a espera e destrói a conexão; não produz relatório parcial. Encerrar o transporte não garante cancelamento imediato de trabalho no servidor. Prazo de execução do lado MySQL/MariaDB depende da versão e deve ser validado pelo administrador antes de consultas operacionais.
- Na Micro de 1 GB, homologar uma execução por vez, heap de 128 MiB e limite RSS por serviço. Não instalar/agendar o conector na VM antes da validação da rede, TLS, grants e memória disponível.
- `npm test` instala/exercita o MySQL2 fixado via `npm ci` no workflow. Testes TLS usam somente loopback, certificados/chaves temporários gerados com OpenSSL e limpeza ao terminar; rejeitam hostname errado, CA desconhecida e servidor MySQL sem TLS. No Windows com Git for Windows, pode ser necessário definir `IXC_TEST_OPENSSL` como caminho do `openssl.exe` existente. Não usam credenciais ou banco real.
- O workflow gera um pacote Jekyll sem publicar: deve excluir `backend/`, rejeitar `.nojekyll` e preservar byte a byte as páginas de entrada existentes. `_config.yml` exclui `backend` do Pages legacy atual. A fonte continua pública neste repositório; execução e segredos permanecem privados. Se a fonte também precisar ser privada, migrar para repositório privado separado.

## O que falta para realmente integrar

1. Executar a inspeção numa rede autorizada com CA do MySQL.
2. Conferir nomes reais das tabelas, relacionamentos e índices antes de montar consultas.
3. Definir limites por período, empresa, cidade e setor; validar desempenho do banco operacional e segurança LGPD.
4. Desenvolver coletor privado (não navegador) com cofre de segredos e sincronização de **agregados minimizados** no Supabase.
5. Homologar os indicadores com a exportação do IXC antes de expor ao Gestor.

**Isolamento e rollback:** este protótipo está numa branch, em `backend/ixc-connector/`, sem merge/deploy automático. Exigir CI de isolamento aprovada e revisão antes de merge. Não remover a exclusão do backend nem habilitar `.nojekyll`. Nenhum banco foi modificado e o LKZ ISP v138 continua inalterado.
