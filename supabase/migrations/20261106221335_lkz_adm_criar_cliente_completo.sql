-- Migration reconstructed from verified live schema, no data deletion.
CREATE OR REPLACE FUNCTION lkz_adm_private.create_client(p_id uuid, p_company text, p_name text, p_segment text, p_email text, p_phone text, p_city text, p_state text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.contacts%rowtype;
  v_company text:=nullif(btrim(coalesce(p_company,'')),'');
  v_name text:=nullif(btrim(coalesce(p_name,'')),'');
  v_segment text:=nullif(btrim(coalesce(p_segment,'')),'');
  v_email text:=nullif(lower(btrim(coalesce(p_email,''))),'');
  v_phone text:=nullif(btrim(coalesce(p_phone,'')),'');
  v_city text:=nullif(btrim(coalesce(p_city,'')),'');
  v_state text:=nullif(upper(btrim(coalesce(p_state,''))),'');
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Acesso administrativo com MFA obrigatório.' using errcode='42501';
  end if;
  if p_id is null or (v_company is null and v_name is null)
    or length(v_company)>120 or length(v_name)>120 or length(v_segment)>100
    or length(v_email)>254 or length(v_phone)>32 or length(v_city)>100
    or (v_state is not null and v_state !~ '^[A-Z]{2}$')
    or (v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or (v_phone is not null and v_phone !~ '^[+0-9(). -]+$')
    or (coalesce(v_company,'')||coalesce(v_name,'')||coalesce(v_segment,'')||
        coalesce(v_email,'')||coalesce(v_phone,'')||coalesce(v_city,'')) ~ '[[:cntrl:]]'
  then raise exception 'Dados inválidos para cadastro do cliente.' using errcode='22023'; end if;
  insert into public.contacts(id,company_name,person_name,segment,email,phone,city,state)
  values(p_id,v_company,v_name,v_segment,v_email,v_phone,v_city,v_state)
  on conflict (id) do nothing returning * into c;
  if found then
    insert into lkz_adm_private.operator_audit(actor_id,target_id,action)
      values(auth.uid(),p_id,'client.create');
  else
    select * into c from public.contacts where id=p_id;
    if not exists (select 1 from lkz_adm_private.operator_audit where
      target_id=p_id and actor_id=auth.uid() and action='client.create')
      or (c.company_name,c.person_name,c.segment,c.email,c.phone,c.city,c.state)
        is distinct from (v_company,v_name,v_segment,v_email,v_phone,v_city,v_state)
    then raise exception 'Já existe um registro incompatível com este identificador.' using errcode='23505'; end if;
  end if;
  return jsonb_build_object('id',c.id,'company_name',c.company_name,'person_name',c.person_name,
       'segment',c.segment,'email',c.email,'phone',c.phone,'city',c.city,'state',c.state,
       'created_at',c.created_at,'updated_at',c.updated_at,'consent_contact',c.consent_contact);
end; $function$;

CREATE OR REPLACE FUNCTION public.lkz_adm_create_client(p_id uuid, p_company text, p_name text, p_segment text, p_email text, p_phone text, p_city text, p_state text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select lkz_adm_private.create_client(p_id,p_company,p_name,p_segment,
                                      p_email,p_phone,p_city,p_state);
$function$;


revoke all on function lkz_adm_private.create_client(uuid,text,text,text,text,text,text,text),
 public.lkz_adm_create_client(uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function lkz_adm_private.create_client(uuid,text,text,text,text,text,text,text),
 public.lkz_adm_create_client(uuid,text,text,text,text,text,text,text) to authenticated;
