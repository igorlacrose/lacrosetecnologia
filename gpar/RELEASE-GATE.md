# Gestão de Parcerias BI — Publicação web local-first

Data: 2026-10-27 · URL: https://lacrosetecnologia.com.br/gpar/

## Escopo liberado pelo proprietário

- Publicar o módulo BI em `/gpar` no GitHub Pages, preservando site, ERP e FluX.
- Implantação **local-first**: lógica de importação, cadastros, lançamentos manuais e PDFs no navegador; sem backend, conta, API ou sincronização.
- Salvamento automático **por navegador/dispositivo**, via IndexedDB; cópias externas em JSON permanecem necessárias para migrar de máquina ou recuperar depois de limpar o armazenamento.
- As planilhas são opcionais; a interface White Label é personalizável pelo usuário. A assinatura "Desenvolvido por Lacrose Tecnologia" permanece fixa na interface e nos relatórios (não é proteção contra alteração por alguém que modifique o código público).
- PDFs e WhatsApp são iniciados pelo usuário; fallback exige anexar PDF manualmente.

## Limites e riscos que precisam ficar explícitos

1. A URL é pública e **não possui autenticação**. Dados ficam no próprio navegador, sem sincronização entre dispositivos. Não use em computador compartilhado; proteção depende da conta e da segurança do dispositivo.
2. O armazenamento local **não é criptografado pelo aplicativo** e scripts executados sob o mesmo domínio podem acessar dados do mesmo origin. Não tratar como cofre financeiro, multiempresa hospedado ou arquivo contábil oficial.
3. Limpeza de navegador, modo privado, defeitos do PC e múltiplas abas podem causar perda/conflito. Exportar backups JSON periódicos, armazenar em pasta protegida e testar restauração.
4. Percentuais dos sócios e base bruto/líquido geram **simulações** usando a configuração corrente. Não há vigência histórica, fechamento imutável, autorização de reabertura ou trilha de auditoria; não usar como ordem de pagamento.
5. Relatórios compartilhados podem conter informações financeiras confidenciais; revisar PDF e destinatário do WhatsApp.
6. O instalador original Windows x64 da Jequié Telecom não foi alterado.

## Gate para uma futura versão financeira hospedada

- Login e autorização por empresa/organização, banco persistente, isolamento tenant/RLS, validação server-side e controle de papéis.
- Histórico de percentuais, competência, transações e fechamentos; auditoria e backups/restauração validados.
- Melhorar segurança em origem isolada (ideal: subdomínio separado), proteção de dados locais quando aplicável, testes completos de regressão, UX desktop/mobile.
- Validar PDF A4, importação XLSX/CSV, recarga do navegador, recuperação de backup, impressão e WhatsApp em dispositivos reais antes de declarar homologação completa.

## Rollback

- Repositório `igorlacrose/lacrosetecnologia`, branch `main`. A alteração é restrita à pasta `gpar/`; revertendo o merge ou removendo a pasta, o site anterior volta a ser servido.
- **Atenção:** rollback do frontend não recupera dados armazenados nos navegadores. Guarde backups JSON separadamente.
