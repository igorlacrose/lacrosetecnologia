# LKZ ISP Intelligence v0.8.0 — primeira operação em nuvem controlada

A interface gerencial completa está integrada ao Supabase exclusivo. Apenas resumos agregados e canônicos de relatórios IXC são enviados ao PostgreSQL após MFA TOTP, RLS por tenant, validação SQL e auditoria append-only. Não enviar planilhas originais, CPFs, nomes, telefones, IDs, hashes, senhas ou linhas de atendimentos. Os indicadores são consultados na nuvem, e a importação só é confirmada após leitura de volta do mesmo fingerprint.

## Homologação do primeiro uso

1. Acessar HTTPS `/lkzisp/` e entrar com e-mail/senha e MFA já cadastrados.
2. Verificar acesso global MASTER e escolher empresa autorizada.
3. Usar **Exemplo fictício** para navegar nas telas sem modificar o banco.
4. Fazer importação de um CSV/XLSX TESTE sintético, sem dados pessoais, e observar mensagem de armazenamento confirmado.
5. Sair, abrir novo navegador, entrar com MFA e verificar o registro persistido no histórico.
6. Validar a exportação CSV e download de backup criptografado (senha exclusiva >=16 caracteres).

## Limitações explícitas

- É possível usar o Dashboard, Radar, Central de Resultados, Qualidade, Atendimento, Produtividade **setorial**, simulador de custos, exportações, importação de agregados IXC, permissões base e auditoria.
- Não existem análises individuais de colaboradores, integração automática de 6-8 arquivos de tipos diferentes, faturamento real, planos corretivos online, convites completos com e-mail, White Label persistente, operação financeira e sincronização offline com resolução de conflitos. Indicadores específicos mostram dados insuficientes.
- O banco Supabase é a fonte autoritativa. O navegador mantém dados empresariais apenas na RAM da sessão, e os arquivos originais não saem do dispositivo. Offline não executa importações nem carrega dados confidenciais. O PWA guarda apenas recursos estáticos.
- Backup da sessão em arquivo `.lkzbackup.json` criptografado, iniciado manualmente ao finalizar. Isso NÃO é backup completo do PostgreSQL. Ainda é obrigatório implementar backup externo automatizado do banco e testar restauração em outro ambiente antes de produção crítica.
- Contagem diária, categorias e pequenos grupos podem ter risco de reidentificação. Validar política LGPD e retenção antes de disponibilizar a operadores reais.

### Implantação

Somente os arquivos da pasta `lkzisp` são destinados à hospedagem pública. `backend/`, planilhas originais e tokens não devem ser publicados. A atualização foi desenvolvida sem uso do Codex nem dependência paga.
