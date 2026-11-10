-- DRAFT / HOMOLOGAÇÃO: NÃO APLICAR NO BANCO DE PRODUÇÃO SEM BACKUP E REVISÃO.
-- Supabase Migration oficial deverá ser gerada pelo CLI antes da implantação.
-- Este módulo NÃO cobra, ativa licenças ou provisiona serviços.
create table if not exists public.oca_sessions_v2 (
  id uuid primary key default gen_random_uuid(),
  session_token_hash text not null unique check (length(session_token_hash) = 64),
  revision integer not null default 0 check (revision >= 0),
  conversation_state jsonb not null,
  last_request_id uuid,
  last_reply text,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.oca_sessions_v2 enable row level security;
revoke all on public.oca_sessions_v2 from public, anon, authenticated;
grant select, insert, update, delete on public.oca_sessions_v2 to service_role;
create index if not exists oca_sessions_v2_expires_idx
  on public.oca_sessions_v2 (expires_at);
comment on table public.oca_sessions_v2 is
  'Sessões de qualificação OCA v2: acesso apenas pelo backend com service_role. Sem políticas RLS públicas intencionalmente.';
-- Pendência para homologação: job de eliminação segura de sessões vencidas;
-- retenção/consentimento LGPD; testes de acesso anon/authenticated; backup/restauração.
