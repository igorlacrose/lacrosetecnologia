import knowledge from '../assets/oca-knowledge.js';
import { fixture, withIdentity } from './preview-db.mjs';

const stages = ['qualification', 'proposal', 'negotiation', 'won', 'lost'];
const fields = {
  leads: ['name', 'email'],
  clients: ['name', 'email'],
  opportunities: ['lead_id', 'title'],
  interactions: ['lead_id', 'channel', 'note'],
  products: ['slug', 'name', 'kind'],
  plans: ['product_id', 'name', 'amount_brl_cents', 'interval'],
  subscription_drafts: ['client_id', 'plan_id'],
  license_requests: ['subscription_id'],
  audit: [],
};

function insert(tx, resource, columns, tenant, data, conflict = '') {
  const values = [tenant, ...columns.map(column => {
    const value = data[column];
    if (column === 'amount_brl_cents') {
      if (!Number.isInteger(value) || value < 1 || value > 2147483647) throw new TypeError('Invalid price');
      return value;
    }
    if (typeof value !== 'string') throw new TypeError('Invalid field');
    const text = value.trim();
    return column === 'email' ? text.toLowerCase() : text;
  })];
  return tx.query(
    'insert into lkz_vnext.' + resource + ' (tenant_id,' + columns.join(',') + ') values ('
      + values.map((_, index) => '$' + (index + 1)).join(',') + ') ' + conflict + ' returning *',
    values,
  );
}

function json(value, status = 200) {
  return Response.json(value, { status });
}

export async function serveWorkspace(request, db, claims, { lacroseTenant = fixture.tenant, metaProvider = null } = {}) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').slice(2);
  const [resource, id, action] = parts;
  const tenant = url.searchParams.get('tenant');
  if (!claims) return json({ error: 'Sessão obrigatória.' }, 401);
  if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'Método inválido.' }, 405);
  if (request.method === 'POST' && !request.headers.get('content-type')?.startsWith('application/json')) {
    return json({ error: 'Envie dados em JSON.' }, 415);
  }

  try {
    const data = request.method === 'POST' ? await request.json() : null;
    if (request.method === 'POST' && (!data || typeof data !== 'object' || Array.isArray(data))) {
      return json({ error: 'Dados inválidos.' }, 400);
    }
    return await withIdentity(db, claims, async (tx) => {
      if (resource === 'tenants' && parts.length === 1 && request.method === 'GET') {
        return json((await tx.query('select id,name from lkz_vnext.tenants order by name')).rows);
      }
      const access = await tx.query(`select role from lkz_vnext.memberships where tenant_id = $1`, [tenant]);
      if (!access.rows.length) return json({ error: 'Empresa indisponível para esta sessão.' }, 403);
      if (resource === 'whatsapp') {
        // MFA-backed RLS is checked by the active tenant membership lookup above.
        // The actual Meta OAuth token is never accessible from this API or its role.
        if (request.method === 'GET' && parts.length === 1) {
          const { rows } = await tx.query(
            'select tenant_id,id,meta_waba_id,meta_phone_number_id,meta_messaging_account_id,' +
            'phone_display,connection_state,billing_owner,billing_state,billing_verified_at,' +
            'created_at,updated_at from lkz_vnext.whatsapp_connections ' +
            'where tenant_id=$1 order by created_at desc limit 20', [tenant]);
          return json(rows);
        }
        if (request.method === 'GET' && id === 'config' && parts.length === 2) {
          return json({ enabled: Boolean(metaProvider), directBillingOnly: true,
            ...(metaProvider?.publicConfig ?? {}) });
        }
        if (request.method === 'GET' && id === 'reminders' &&
          action === 'rehearsal' && parts.length === 3) {
          const { rows: [summary] } = await tx.query(
            'select * from lkz_vnext.whatsapp_reminder_rehearsal_summary($1)',[tenant]);
          return json({ ...summary, dryRun:true, canDispatch:false });
        }
        if (request.method === 'GET' && id === 'reminders' &&
          action === 'summary' && parts.length === 3) {
          const { rows: [summary] } = await tx.query(
            'select * from lkz_vnext.whatsapp_reminder_summary($1)',[tenant]);
          return json(summary);
        }
        if (request.method === 'GET' && id === 'reminders' && parts.length === 2) {
          const { rows } = await tx.query(
            'select enabled,offsets_minutes,monthly_message_limit ' +
            'from lkz_vnext.whatsapp_reminder_policies where tenant_id=$1', [tenant]);
          // Reminders MUST remain disabled pending provider/billing checks and product QA.
          return json(rows[0] ?? { enabled: false, offsets_minutes: [1440,120], monthly_message_limit: 0 });
        }
        if (request.method === 'POST' && id === 'reminders' && parts.length === 2) {
          if (access.rows[0].role !== 'admin')
            return json({ error: 'Configuração restrita a administrador com MFA.' }, 403);
          if (Object.keys(data).sort().join(',') !== 'monthly_message_limit,offsets_minutes'
            || !Array.isArray(data.offsets_minutes)
            || !data.offsets_minutes.every(Number.isInteger)
            || !Number.isInteger(data.monthly_message_limit)) {
            return json({ error: 'Preferências inválidas.' }, 400);
          }
          const { rows:[preferences] } = await tx.query(
            'select * from lkz_vnext.save_reminder_preferences($1,$2::integer[],$3::integer)',
            [tenant,data.offsets_minutes,data.monthly_message_limit]
          );
          return json({ ...preferences, canDispatch:false,
            message:'Preferências salvas. Envios permanecem desativados até homologação.' });
        }
        if (request.method !== 'POST' || access.rows[0].role !== 'admin')
          return json({ error: 'Conexão WhatsApp exige administrador com MFA.' }, 403);
        if (id === 'signup' && parts.length === 2) {
          if (!metaProvider) return json({ error: 'Integração Meta ainda não configurada.' }, 503);
          return json(await metaProvider.start(tx, tenant, claims.sub), 201);
        }
        if (id === 'complete' && parts.length === 2) {
          if (!metaProvider) return json({ error: 'Integração Meta ainda não configurada.' }, 503);
          const linked = await metaProvider.finish(tenant, claims.sub, data);
          return linked.ok ? json(linked, 201) : json({ error: linked.status }, 409);
        }
        if (id && action === 'report-billing' && parts.length === 3) {
          if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
            return json({ error: 'Conta inválida.' }, 400);
          const { rows:[report] } = await tx.query(
            'select lkz_vnext.report_whatsapp_billing($1,$2) as billing_state', [tenant,id]);
          return json({ billing_state: report.billing_state, active: false,
            message: 'Relato recebido. Verificação externa da conta Meta ainda pendente.' });
        }
        return json({ error: 'Ação WhatsApp indisponível.' }, 404);
      }

      if (request.method === 'GET' && resource === 'overview' && parts.length === 1) {
        const result = await tx.query(`
          select
            (select count(*) from lkz_vnext.leads where tenant_id=$1) as leads,
            (select count(*) from lkz_vnext.clients where tenant_id=$1 and archived_at is null) as clients,
            (select count(*) from lkz_vnext.opportunities where tenant_id=$1) as opportunities,
            (select count(*) from lkz_vnext.interactions where tenant_id=$1) as interactions,
            (select count(*) from lkz_vnext.subscription_drafts where tenant_id=$1) as subscription_drafts
        `, [tenant]);
        return json(result.rows[0]);
      }
      if (request.method === 'GET' && resource === 'subscription_drafts'
        && action === 'eligibility' && parts.length === 3) {
        const result = await tx.query(`
          select product.slug
          from lkz_vnext.subscription_drafts draft
          join lkz_vnext.plans plan on (draft.tenant_id,draft.plan_id) = (plan.tenant_id,plan.id)
          join lkz_vnext.products product on (plan.tenant_id,plan.product_id) = (product.tenant_id,product.id)
          where draft.tenant_id = $1 and draft.id = $2
        `, [tenant, id]);
        if (!result.rows.length) return json({ error: 'Assinatura indisponível.' }, 404);
        // This catalog stores drafts only. Eligibility cannot be granted by a browser or OCA request.
        return json({ eligible: false, product: result.rows[0].slug, reason: 'product_not_homologated' });
      }
      if (request.method === 'GET' && resource === 'subscription_drafts' && parts.length === 1) {
        const { rows } = await tx.query(`
          select d.*, coalesce((
            select jsonb_object_agg(p.state,p.total)
            from (
              select state,count(*) as total from lkz_vnext_billing.payment_bindings
              where tenant_id=d.tenant_id and subscription_id=d.id group by state
            ) p
          ),'{}'::jsonb) as sandbox_payments
          from lkz_vnext.subscription_drafts d where d.tenant_id=$1 order by d.id limit 100
        `, [tenant]);
        return json(rows);
      }
      if (request.method === 'GET' && parts.length === 1 && Object.hasOwn(fields, resource)) {
        return json((await tx.query('select * from lkz_vnext.' + resource
          + ' where tenant_id = $1 order by id ' + (resource === 'audit' ? 'desc ' : '') + 'limit 100', [tenant])).rows);
      }
      if (request.method !== 'POST') return json({ error: 'Ação indisponível.' }, 404);
      if (resource === 'oca' && id === 'assist' && parts.length === 2) {
        const question = data.question;
        if (typeof question !== 'string' || question.trim().length < 1 || question.length > 350) {
          return json({ error: 'Informe uma pergunta de até 350 caracteres.' }, 400);
        }
        const approved = tenant === lacroseTenant ? knowledge.match(question) : null;
        const answer = approved?.answer ?? 'Encaminhe esta solicitação para análise comercial.';
        const drafts = await tx.query('select name from lkz_vnext.products where tenant_id = $1 order by name limit 100', [tenant]);
        return json({ answer, drafts: drafts.rows.map(row => row.name) });
      }
      if (resource === 'oca' && id === 'intake' && parts.length === 2) {
        if (typeof data.oca_reference !== 'string'
          || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data.oca_reference)) {
          return json({ error: 'Informe a referência UUID do atendimento.' }, 400);
        }
        const result = await insert(tx, 'leads', ['name', 'email', 'oca_reference'], tenant, data,
          'on conflict (tenant_id, oca_reference) do nothing');
        if (result.rows.length) return json(result.rows[0], 201);
        const prior = await tx.query(`select * from lkz_vnext.leads
          where tenant_id = $1 and oca_reference = $2`, [tenant, data.oca_reference]);
        const existing = prior.rows[0];
        if (existing?.email !== data.email.trim().toLowerCase() || existing?.name !== data.name.trim()) {
          return json({ error: 'A referência já pertence a outro registro.' }, 409);
        }
        return json(existing);
      }
      if (resource === 'leads' && action === 'convert' && parts.length === 3) {
        const result = await tx.query('select lkz_vnext.convert_lead($1,$2) as client_id', [tenant,id]);
        return json(result.rows[0]);
      }
      if (resource === 'opportunities' && action === 'stage' && parts.length === 3) {
        if (!stages.includes(data.stage)) return json({ error: 'Etapa inválida.' }, 400);
        const result = await tx.query(`update lkz_vnext.opportunities set stage=$3
          where tenant_id=$1 and id=$2 returning *`, [tenant,id,data.stage]);
        return result.rows.length ? json(result.rows[0]) : json({ error: 'Oportunidade indisponível.' }, 404);
      }
      if (parts.length === 1 && Object.hasOwn(fields, resource) && fields[resource].length) {
        const result = await insert(tx, resource, fields[resource], tenant, data);
        return json(result.rows[0], 201);
      }
      return json({ error: 'Ação indisponível.' }, 404);
    });
  } catch (error) {
    if (error.code === '42501') return json({ error: 'Ação sem permissão.' }, 403);
    if (['23503', '23505', 'P0002'].includes(error.code)) return json({ error: 'Registro indisponível ou duplicado.' }, 409);
    if ((error instanceof SyntaxError || error instanceof TypeError) || ['22P02', '22003', '22023', '23502', '23514'].includes(error.code)) {
      return json({ error: 'Confira os dados informados.' }, 400);
    }
    return json({ error: 'Falha ao acessar o espaço de trabalho.' }, 500);
  }
}
