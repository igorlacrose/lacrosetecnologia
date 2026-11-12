-- Lista administrativa de MINUTAS, não cobranças ou receitas recebidas.
CREATE OR REPLACE FUNCTION lkz_adm_private.list_contract_drafts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not lkz_adm_private.is_operator() or auth.uid() is null then
  raise exception 'Acesso administrativo com MFA obrigatório.' using errcode='42501';
 end if;
 return coalesce((
 select jsonb_agg(jsonb_build_object(
   'contact_id',s.contact_id,'customer',coalesce(nullif(btrim(c.company_name),''),
      nullif(btrim(c.person_name),''),'Cliente sem identificação'),
   'version',s.version,'updated_at',s.updated_at,'status','draft',
   'total_setup_cents',coalesce(p.total_setup,0),
   'total_monthly_cents',coalesce(p.monthly,0),
   'total_yearly_cents',coalesce(p.yearly,0),
   'product_codes',coalesce(p.codes,'[]'::jsonb),
   'billing_enabled',false,'provisioning_enabled',false
 ) order by s.updated_at desc,s.id)
 from (select * from lkz_adm_private.client_contract_drafts order by updated_at desc limit 200)s
 join public.contacts c on c.id=s.contact_id
 left join lateral (
   select sum(i.setup_cents)::bigint as total_setup,
     sum(i.recurring_cents) filter(where i.billing_interval='monthly')::bigint as monthly,
     sum(i.recurring_cents) filter(where i.billing_interval='yearly')::bigint as yearly,
     jsonb_agg(i.product_code order by i.product_code) as codes
   from lkz_adm_private.client_contract_draft_items i where i.contract_id=s.id
 )p on true
 ),'[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.lkz_adm_list_contract_drafts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select lkz_adm_private.list_contract_drafts();
$function$;

revoke all on function
 lkz_adm_private.list_contract_drafts(),
 public.lkz_adm_list_contract_drafts() from public,anon,authenticated;
grant execute on function
 lkz_adm_private.list_contract_drafts(),
 public.lkz_adm_list_contract_drafts() to authenticated;
