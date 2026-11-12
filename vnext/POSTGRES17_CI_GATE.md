# Gate PostgreSQL 17 — homologação real do banco em CI

Objetivo: ir além das fixtures em PGlite e detectar incompatibilidades nas migrações 001–016 e no isolamento RLS usando **PostgreSQL 17.11 real em serviço descartável do GitHub Actions**, sem serviço de banco externo, Supabase institucional, dados de clientes ou Codex.

- Workflow separado: `.github/workflows/vnext-postgres17-smoke.yml`
- Teste: `vnext/pg17-staging.smoke.mjs`
- Serviço efêmero: `postgres:17.11`, banco `lkz_vnext_stage_ci`, senha **apenas de teste público**, sem conexão à internet/produção.
- Bootstrap mínimo de schemas/roles `auth`, `anon` e `authenticated` para representar as dependências do Supabase Auth.
- Migração completa de todas as versões a partir do diretório versionado, aplicada **duas vezes** para verificar checksum e idempotência.
- Identidades PostgreSQL exclusivas de web e do serviço de lembretes (sem superuser, BYPASSRLS ou acesso cruzado).
- Reserva de cota sintética em transação e segundo processamento idempotente.
- Testes de leitura agregada permitida ao admin com MFA simulado, leitura direta do ledger negada e consulta cruzada de tenant rejeitada.
- Integração sintética adicional: agendas de BarbarOS e LibertyOS enviam eventos HMAC ao receptor real em PostgreSQL 17; webhook Meta de opt-out com assinatura simulada cancela os lembretes do tenant correto, mantendo a segunda empresa isolada; replay e assinatura falsa são rejeitados.

Esse gate não é teste de webhook Meta, método de pagamento, hospedagem de produção ou agenda real. A migração, credenciais e dados ficam dentro da máquina temporária do runner; não habilitar as notificações reais por causa de CI verde.

Se falhar, tratar como bloqueador de integração e diagnosticar o SQL/role específico, sem afrouxar permissões ou suprimir testes. Nenhuma alteração na base de produção é autorizada. O fluxo permanece organizado como PR dependente do #66.
