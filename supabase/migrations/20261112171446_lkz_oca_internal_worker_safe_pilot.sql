-- OCA piloto Lacrose: motor interno determinístico, sem envios, cobranças ou mudanças de etapa.
-- Não utilizar para multiempresa sem tenant_id/RLS e filas isoladas por tenant.
create table if not exists lkz_adm_private.oca_worker_config (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default true,
 max_per_run int not null default 25 check(max_per_run between 1 and 25),
 updated_at timestamptz not null default clock_timestamp()
);
insert into lkz_adm_private.oca_worker_config(singleton,enabled,max_per_run)
values(true,true,25) on conflict(singleton) do nothing;
alter table lkz_adm_private.oca_worker_config enable row level security;
revoke all on lkz_adm_private.oca_worker_config from public,anon,authenticated;

create table if not exists lkz_adm_private.oca_internal_tasks(
 id uuid primary key default gen_random_uuid(),
 lead_id uuid not null references public.leads(id) on delete cascade,
 rule_code text not null check(rule_code in
  ('human_review','identify_contact','schedule_followup','stalled_diagnosis','stalled_new')),
 week_start date not null,
 status text not null default 'open' check(status in ('open','done','dismissed')),
 created_at timestamptz not null default clock_timestamp(),
 resolved_at timestamptz,
 resolved_by uuid references auth.users(id) on delete set null,
 unique(lead_id,rule_code,week_start),
 check ((status='open' and resolved_at is null) or (status<>'open' and resolved_at is not null))
);
create index if not exists idx_oca_internal_tasks_open
 on lkz_adm_private.oca_internal_tasks(status,created_at) where status='open';
alter table lkz_adm_private.oca_internal_tasks enable row level security;
revoke all on lkz_adm_private.oca_internal_tasks from public,anon,authenticated;

create table if not exists lkz_adm_private.oca_worker_runs(
 id bigint generated always as identity primary key,
 run_at timestamptz not null default clock_timestamp(),
 enabled boolean not null,
 checked int not null default 0,
 created int not null default 0
);
alter table lkz_adm_private.oca_worker_runs enable row level security;
revoke all on lkz_adm_private.oca_worker_runs from public,anon,authenticated;

create or replace function lkz_adm_private.oca_generate_internal_tasks(p_max int default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_enabled boolean;
 v_limit int;
 v_checked int;
 v_created int;
 v_week date:=(date_trunc('week',clock_timestamp() at time zone 'America/Bahia'))::date;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(1852812) then
    return jsonb_build_object('ok',false,'reason','worker_busy','created',0);
  end if;
  select enabled,max_per_run into v_enabled,v_limit
    from lkz_adm_private.oca_worker_config where singleton=true;
  if not found or not coalesce(v_enabled,false) then
    return jsonb_build_object('ok',true,'enabled',false,'created',0);
  end if;
  v_limit:=least(greatest(coalesce(p_max,25),1),25,v_limit);
  select count(*) into v_checked from public.leads
    where status not in ('lost','archived','won');
  with eligible as (
    select l.id,l.updated_at,
      case
        when l.status='human_review' or l.needs_human_review then 'human_review'
        when l.contact_id is null then 'identify_contact'
        when l.status in ('qualified','contacted') and not exists(
          select 1 from public.followups f
          where f.lead_id=l.id and f.status in ('pending','approved','sent')
        ) then 'schedule_followup'
        when l.status='diagnosing' and l.updated_at<clock_timestamp()-interval '48 hours' then 'stalled_diagnosis'
        when l.status='new' and l.updated_at<clock_timestamp()-interval '24 hours' then 'stalled_new'
        else null end as rule_code
    from public.leads l where l.status not in ('won','lost','archived','proposal')
  ), candidates as (
    select e.id,e.rule_code from eligible e
    where e.rule_code is not null and not exists(
      select 1 from lkz_adm_private.oca_internal_tasks t
      where t.lead_id=e.id and t.status='open'
    ) order by e.updated_at,e.id limit v_limit
  )
  insert into lkz_adm_private.oca_internal_tasks(lead_id,rule_code,week_start)
    select id,rule_code,v_week from candidates
    on conflict(lead_id,rule_code,week_start) do nothing;
  get diagnostics v_created=row_count;
  insert into lkz_adm_private.oca_worker_runs(enabled,checked,created)
    values(true,v_checked,v_created);
  return jsonb_build_object('ok',true,'enabled',true,'checked',v_checked,'created',v_created);
end $$;

create or replace function lkz_adm_private.oca_list_tasks()
returns table(id uuid,lead_id uuid,rule_code text,status text,created_at timestamptz,
 resolved_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not lkz_adm_private.is_operator() then
    raise exception 'MFA e perfil administrativo obrigatórios.' using errcode='42501';
 end if;
 return query
   select t.id,t.lead_id,t.rule_code,t.status,t.created_at,t.resolved_at
   from lkz_adm_private.oca_internal_tasks t
   order by case when t.status='open' then 0 else 1 end,t.created_at desc,t.id
   limit 200;
end $$;

create or replace function lkz_adm_private.oca_worker_status()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_enabled boolean;v_run record;
begin
 if not lkz_adm_private.is_operator() then
    raise exception 'MFA e perfil administrativo obrigatórios.' using errcode='42501';
 end if;
 select enabled into v_enabled from lkz_adm_private.oca_worker_config where singleton=true;
 select run_at,checked,created into v_run from lkz_adm_private.oca_worker_runs order by id desc limit 1;
 return jsonb_build_object('enabled',coalesce(v_enabled,false),
   'open_tasks',(select count(*) from lkz_adm_private.oca_internal_tasks where status='open'),
   'last_run_at',v_run.run_at,'last_checked',v_run.checked,'last_created',v_run.created);
end $$;

create or replace function lkz_adm_private.oca_resolve_task(p_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t lkz_adm_private.oca_internal_tasks%rowtype;
begin
 if not lkz_adm_private.is_operator() then
    raise exception 'MFA e perfil administrativo obrigatórios.' using errcode='42501';
 end if;
 if p_id is null or p_action not in ('done','dismissed') then
    raise exception 'Ação inválida.' using errcode='22023';
 end if;
 select * into t from lkz_adm_private.oca_internal_tasks where id=p_id for update;
 if not found or t.status<>'open' then
    raise exception 'Tarefa alterada ou inexistente. Atualize a lista.' using errcode='40001';
 end if;
 update lkz_adm_private.oca_internal_tasks
 set status=p_action,resolved_at=clock_timestamp(),resolved_by=auth.uid()
 where id=p_id returning * into t;
 insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
 values(auth.uid(),t.id,'oca.task.'||p_action,
    jsonb_build_object('lead_id',t.lead_id,'rule',t.rule_code));
 return jsonb_build_object('id',t.id,'status',t.status);
end $$;

create or replace function lkz_adm_private.oca_set_enabled(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not lkz_adm_private.is_master() then
    raise exception 'Ação exclusiva do MASTER com MFA.' using errcode='42501';
 end if;
 if p_enabled is null then raise exception 'Valor inválido.' using errcode='22023'; end if;
 update lkz_adm_private.oca_worker_config
    set enabled=p_enabled,updated_at=clock_timestamp() where singleton=true;
 insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
 values(auth.uid(),auth.uid(),'oca.worker.toggle',jsonb_build_object('enabled',p_enabled));
 return jsonb_build_object('enabled',p_enabled);
end $$;

create or replace function lkz_adm_private.oca_run_now()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not lkz_adm_private.is_master() then
   raise exception 'Ação exclusiva do MASTER com MFA.' using errcode='42501';
 end if;
 return lkz_adm_private.oca_generate_internal_tasks(25);
end $$;

create or replace function public.lkz_adm_oca_list_tasks()
returns table(id uuid,lead_id uuid,rule_code text,status text,created_at timestamptz,
 resolved_at timestamptz)
language sql stable security invoker set search_path='' as $$
select * from lkz_adm_private.oca_list_tasks();
$$;
create or replace function public.lkz_adm_oca_status()
returns jsonb language sql stable security invoker set search_path='' as $$
select lkz_adm_private.oca_worker_status();
$$;
create or replace function public.lkz_adm_oca_resolve_task(p_id uuid,p_action text)
returns jsonb language sql security invoker set search_path='' as $$
select lkz_adm_private.oca_resolve_task(p_id,p_action);
$$;
create or replace function public.lkz_adm_oca_set_enabled(p_enabled boolean)
returns jsonb language sql security invoker set search_path='' as $$
select lkz_adm_private.oca_set_enabled(p_enabled);
$$;
create or replace function public.lkz_adm_oca_run_now()
returns jsonb language sql security invoker set search_path='' as $$
select lkz_adm_private.oca_run_now();
$$;

revoke all on function
 lkz_adm_private.oca_generate_internal_tasks(integer),
 lkz_adm_private.oca_list_tasks(),
 lkz_adm_private.oca_worker_status(),
 lkz_adm_private.oca_resolve_task(uuid,text),
 lkz_adm_private.oca_set_enabled(boolean),
 lkz_adm_private.oca_run_now(),
 public.lkz_adm_oca_list_tasks(),
 public.lkz_adm_oca_status(),
 public.lkz_adm_oca_resolve_task(uuid,text),
 public.lkz_adm_oca_set_enabled(boolean),
 public.lkz_adm_oca_run_now()
from public,anon,authenticated;

grant execute on function
 lkz_adm_private.oca_list_tasks(),
 lkz_adm_private.oca_worker_status(),
 lkz_adm_private.oca_resolve_task(uuid,text),
 lkz_adm_private.oca_set_enabled(boolean),
 lkz_adm_private.oca_run_now(),
 public.lkz_adm_oca_list_tasks(),
 public.lkz_adm_oca_status(),
 public.lkz_adm_oca_resolve_task(uuid,text),
 public.lkz_adm_oca_set_enabled(boolean),
 public.lkz_adm_oca_run_now()
to authenticated;

-- Cron roda como postgres, sem JWT de usuário; função não é acessível à API pública.
do $$
begin
 if not exists(select 1 from cron.job where jobname='lkz-oca-internal-tasks-weekdays') then
  perform cron.schedule('lkz-oca-internal-tasks-weekdays','10 14 * * 1-5',
   'select lkz_adm_private.oca_generate_internal_tasks(25)');
 end if;
end $$;
