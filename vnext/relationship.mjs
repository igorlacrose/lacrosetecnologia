import {randomUUID} from 'node:crypto';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const json=(value,status=200)=>Response.json(value,{status});
const fields=['phone','contact_name','segment','preferred_channel','whatsapp_permission','email_permission','permission_source','followup_on','notes'];
const permissions=['unknown','allowed','opted_out'];
function txt(v,max,optional=false){
 if(typeof v!=='string'||v.length>max||(!optional&&!v.trim())||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v))throw new TypeError('Invalid text');
 return v.trim();
}
function profile(d){
 const phone=txt(d.phone,16,true),source=txt(d.permission_source,300,true),date=txt(d.followup_on,10,true);
 if((phone&&!/^\+[1-9]\d{7,14}$/.test(phone))||(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))||
 !['new','active','followup','inactive'].includes(d.segment)||!['none','whatsapp','email','phone'].includes(d.preferred_channel)||
 !permissions.includes(d.whatsapp_permission)||!permissions.includes(d.email_permission)||
 ((d.whatsapp_permission!=='unknown'||d.email_permission!=='unknown')&&!source))throw new TypeError('Invalid profile');
 return [phone,txt(d.contact_name,160,true),d.segment,d.preferred_channel,d.whatsapp_permission,d.email_permission,source,date||null,txt(d.notes,2000,true)];
}
export function validateTemplate(d){
 const title=txt(d.title,80),body=txt(typeof d.body==='string'?d.body.replace(/\r\n?/g,'\n'):d.body,1000);
 const rest=body.replace(/\{\{(?:cliente|empresa|servico|data|horario|responsavel)\}\}/g,'');
 if(rest.includes('{{')||rest.includes('}}')||typeof d.active!=='boolean')throw new TypeError('Invalid template');
 return [title,body,d.active];
}
export async function serveRelationship(tx,request,tenant,role,parts,data){
 const [,resource,id,action]=parts,write=request.method==='POST',url=new URL(request.url);
 if(resource==='clients'&&!id&&!write&&parts.length===2){
   const q=txt(url.searchParams.get('q')??'',100,true);
   const {rows}=await tx.query(`select c.id,c.name,c.email,r.phone,r.segment,r.followup_on::text
    from lkz_vnext.clients c left join lkz_vnext.client_relationships r on (r.tenant_id,r.id)=(c.tenant_id,c.id)
    where c.tenant_id=$1 and c.archived_at is null and
    (strpos(lower(c.name),lower($2))>0 or strpos(lower(c.email),lower($2))>0 or strpos(coalesce(r.phone,''),$2)>0)
    order by c.name,c.id limit 51`,[tenant,q]);
   return json({items:rows.slice(0,50),more:rows.length>50,canEdit:role!=='viewer'});
 }
 if(!['admin','operator'].includes(role))return json({error:'Relacionamento restrito à equipe autorizada.'},403);
 if(resource==='clients'&&uuid.test(id??'')){
   const {rows:[client]}=await tx.query('select id,name,email from lkz_vnext.clients where tenant_id=$1 and id=$2 and archived_at is null',[tenant,id]);
   if(!client)return json({error:'Cliente indisponível.'},404);
   if(!write&&parts.length===3){
     const rel=await tx.query('select phone,contact_name,segment,preferred_channel,whatsapp_permission,email_permission,permission_source,followup_on::text,notes,revision from lkz_vnext.client_relationships where tenant_id=$1 and id=$2',[tenant,id]);
     const contacts=await tx.query(`select channel,note,created_at from lkz_vnext.client_contacts where tenant_id=$1 and client_id=$2 order by created_at desc,id limit 50`,[tenant,id]);
     const leads=await tx.query(`select i.channel,i.note,i.created_at from lkz_vnext.interactions i join lkz_vnext.leads l on (l.tenant_id,l.id)=(i.tenant_id,i.lead_id) where l.tenant_id=$1 and l.client_id=$2 order by i.created_at desc,i.id limit 50`,[tenant,id]);
     const inbound=await tx.query(`select 'whatsapp' as channel,case direction when 'app_echo' then 'Enviada pelo celular: ' else 'Recebida: ' end || body as note,received_at as created_at
       from lkz_vnext.whatsapp_crm_inbox where tenant_id=$1 and client_id=$2
       order by received_at desc,meta_message_id limit 50`,[tenant,id]);
     const plans=await tx.query(`select p.name as product,pl.name as plan,pl.amount_brl_cents,pl.interval from lkz_vnext.subscription_drafts d join lkz_vnext.plans pl on (pl.tenant_id,pl.id)=(d.tenant_id,d.plan_id) join lkz_vnext.products p on (p.tenant_id,p.id)=(pl.tenant_id,pl.product_id) where d.tenant_id=$1 and d.client_id=$2 order by d.created_at desc limit 50`,[tenant,id]);
     return json({client,profile:rel.rows[0]??null,contacts:[...contacts.rows,...leads.rows,...inbound.rows].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,50),plans:plans.rows});
   }
   if(write&&action==='profile'&&parts.length===4){
     const values=profile(data);
     if(!Number.isSafeInteger(data.revision)||data.revision<0)throw new TypeError('Invalid revision');
     const placeholders=fields.map((_,i)=>'$'+(i+3)).join(',');
     const result=data.revision===0?await tx.query('insert into lkz_vnext.client_relationships(tenant_id,id,'+fields.join(',')+') values($1,$2,'+placeholders+') on conflict(tenant_id,id) do nothing returning revision',[tenant,id,...values]):
      await tx.query('update lkz_vnext.client_relationships set '+fields.map((f,i)=>f+'=$'+(i+3)).join(',')+',revision=revision+1,updated_at=now() where tenant_id=$1 and id=$2 and revision=$12 returning revision',[tenant,id,...values,data.revision]);
     if(!result.rows.length)return json({error:'Ficha alterada em outra sessão. Reabra antes de salvar.'},409);
     return json(result.rows[0]);
   }
   if(write&&action==='whatsapp'&&parts.length===4){
     if(!uuid.test(data.template_id??'')||!Number.isSafeInteger(data.revision)||data.revision<1||
       !data.variables||typeof data.variables!=='object'||Array.isArray(data.variables)||
       Object.keys(data.variables).some(k=>!['servico','data','horario','responsavel'].includes(k)))throw new TypeError('Invalid message request');
     const {rows:[p]}=await tx.query('select phone,whatsapp_permission from lkz_vnext.client_relationships where tenant_id=$1 and id=$2',[tenant,id]);
     if(p?.whatsapp_permission!=='allowed'||!/^\+[1-9]\d{7,14}$/.test(p.phone))return json({error:'Registre um número válido e autorização de contato por WhatsApp.'},403);
     const {rows:[t]}=await tx.query('select revision,body,active from lkz_vnext.crm_message_versions where tenant_id=$1 and id=$2 order by revision desc limit 1',[tenant,data.template_id]);
     if(!t?.active||t.revision!==data.revision)return json({error:'Modelo inativo ou alterado. Atualize a página.'},409);
     const {rows:[company]}=await tx.query('select name from lkz_vnext.tenants where id=$1',[tenant]);
     const values={cliente:client.name,empresa:company.name};
     for(const key of ['servico','data','horario','responsavel'])values[key]=txt(data.variables[key]??'',160,true);
     let missing=false;
     const message=t.body.replace(/\{\{(\w+)\}\}/g,(m,k)=>{if(!Object.hasOwn(values,k)||!values[k]){missing=true;return m;}return values[k];});
     if(missing||message.includes('{{')||message.includes('}}')||message.length>3000)return json({error:'Confira as variáveis da mensagem.'},400);
     return json({phone:p.phone.slice(1),message});
   }
   if(write&&action==='contact'&&parts.length===4){
     const channel=data.channel,note=txt(data.note,2000);
     if(!['internal','phone','email','whatsapp','meeting'].includes(channel)||!uuid.test(data.id??''))throw new TypeError('Invalid contact');
     const result=await tx.query('insert into lkz_vnext.client_contacts(tenant_id,id,client_id,channel,note) values($1,$2,$3,$4,$5) on conflict(tenant_id,id) do nothing returning id',[tenant,data.id,id,channel,note]);
     if(result.rows.length)return json(result.rows[0],201);
     const prior=await tx.query('select id from lkz_vnext.client_contacts where tenant_id=$1 and id=$2 and client_id=$3 and channel=$4 and note=$5 and actor_id=auth.uid()',[tenant,data.id,id,channel,note]);
     return prior.rows.length?json(prior.rows[0]):json({error:'Identificador já utilizado.'},409);
   }
 }
 if(resource==='templates'){
   if(!id&&!write&&parts.length===2){
     const {rows}=await tx.query(`select * from (select distinct on(id) id,revision,title,body,active,created_at from lkz_vnext.crm_message_versions where tenant_id=$1 order by id,revision desc) v order by active desc,title,id limit 100`,[tenant]);
     return json({items:rows,canEdit:role==='admin'});
   }
   if(!write&&uuid.test(id??'')&&parts.length===3){
     if(role!=='admin')return json({error:'Histórico restrito ao administrador.'},403);
     return json((await tx.query('select revision,title,body,active,created_at from lkz_vnext.crm_message_versions where tenant_id=$1 and id=$2 order by revision desc limit 50',[tenant,id])).rows);
   }
   if(write&&role!=='admin')return json({error:'Modelos são editáveis pelo administrador.'},403);
   if(write&&((!id&&parts.length===2)||(uuid.test(id??'')&&parts.length===3))){
     const values=validateTemplate(data);
     let key=id??randomUUID(),revision=1;
     // Serialize template revisions and the per-tenant quota.
     await tx.query('select pg_advisory_xact_lock(hashtext($1::text),1926)',[tenant]);
     if(id){
       const {rows:[old]}=await tx.query('select revision from lkz_vnext.crm_message_versions where tenant_id=$1 and id=$2 order by revision desc limit 1',[tenant,id]);
       if(!old)return json({error:'Modelo indisponível.'},404);
       if(old.revision!==data.revision)return json({error:'Modelo alterado em outra sessão.'},409);
       revision=old.revision+1;
     }else{
       const {rows:[count]}=await tx.query('select count(distinct id)::int as total from lkz_vnext.crm_message_versions where tenant_id=$1',[tenant]);
       if(count.total>=100)return json({error:'Limite de 100 modelos por empresa.'},409);
     }
     const {rows:[saved]}=await tx.query('insert into lkz_vnext.crm_message_versions(tenant_id,id,revision,title,body,active) values($1,$2,$3,$4,$5,$6) returning id,revision,title,body,active',[tenant,key,revision,...values]);
     return json(saved,201);
   }
 }
 return json({error:'Ação indisponível.'},404);
}

export async function serveDashboard(tx,tenant,role,request){
 const period=new URL(request.url).searchParams.get('period')??'month';
 if(!['week','month','quarter'].includes(period))throw new TypeError('Invalid period');
 const days={week:7,month:30,quarter:90}[period];
 const {rows:[range]}=await tx.query("select (now() at time zone 'America/Bahia')::date::text as end_date, ((now() at time zone 'America/Bahia')::date - ($1::int-1))::text as start_date",[days]);
 const params=[tenant,range.start_date,range.end_date];
 const stages=(await tx.query('select stage as name,count(*)::int as value from lkz_vnext.opportunities where tenant_id=$1 group by stage',[tenant])).rows;
 const products=(await tx.query(`select p.name,count(*)::int as value from lkz_vnext.subscription_drafts d join lkz_vnext.plans pl on (pl.tenant_id,pl.id)=(d.tenant_id,d.plan_id) join lkz_vnext.products p on (p.tenant_id,p.id)=(pl.tenant_id,pl.product_id) where d.tenant_id=$1 group by p.name order by value desc,p.name limit 8`,[tenant])).rows;
 const contacts=(await tx.query(`select channel as name,count(*)::int as value from (select channel from lkz_vnext.interactions where tenant_id=$1 and (created_at at time zone 'America/Bahia')::date between $2::date and $3::date union all select channel from lkz_vnext.client_contacts where tenant_id=$1 and (created_at at time zone 'America/Bahia')::date between $2::date and $3::date) c group by channel`,params)).rows;
 const clients=(await tx.query(`select coalesce(r.segment,'unclassified') as name,count(*)::int as value from lkz_vnext.clients c left join lkz_vnext.client_relationships r on (c.tenant_id,c.id)=(r.tenant_id,r.id) where c.tenant_id=$1 and c.archived_at is null group by 1`,[tenant])).rows;
 const cash=role==='admin'?(await tx.query(`select business_date::text as day,coalesce(sum(amount_brl_cents) filter(where reverses_id is null),0)::text as received,coalesce(sum(amount_brl_cents) filter(where reverses_id is not null),0)::text as reversed from lkz_vnext.cash_entries where tenant_id=$1 and business_date between $2::date and $3::date group by business_date order by business_date`,params)).rows:null;
 const recent=role==='viewer'?[]:(await tx.query(`select c.name as client,a.channel,a.created_at from lkz_vnext.client_contacts a join lkz_vnext.clients c on (c.tenant_id,c.id)=(a.tenant_id,a.client_id) where a.tenant_id=$1 and c.archived_at is null and (a.created_at at time zone 'America/Bahia')::date between $2::date and $3::date order by a.created_at desc,a.id limit 6`,params)).rows;
 const {rows:[totals]}=await tx.query('select (select count(*)::int from lkz_vnext.subscription_drafts where tenant_id=$1) as drafts, (select count(*)::int from lkz_vnext.leads where tenant_id=$1 and client_id is null) as open_leads',[tenant]);
 return json({...range,stages,products,contacts,clients,cash,recent,totals,restricted:role==='viewer'});
}
