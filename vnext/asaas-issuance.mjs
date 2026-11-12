const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const origin = 'https://api-sandbox.asaas.com/v3/';
const idPatterns = {
  customers: /^cus_[A-Za-z0-9_-]{1,120}$/,
  payments: /^pay_[A-Za-z0-9_-]{1,120}$/,
  subscriptions: /^sub_[A-Za-z0-9_-]{1,120}$/,
};

export function amountInCents(value) {
  const parts = typeof value === 'number' && /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(String(value));
  return parts ? Number(parts[1]) * 100 + Number((parts[2] ?? '').padEnd(2, '0')) : NaN;
}

export function createAsaasSandboxIssuer({ apiKey, request = fetch }) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('Missing Sandbox credentials');

  async function send(kind, operation, body) {
    if (!Object.hasOwn(idPatterns, kind) || !uuid.test(operation.external_reference ?? '')) {
      throw new Error('Invalid Sandbox operation');
    }
    const url = new URL(kind, origin);
    if (body === undefined) {
      url.search = new URLSearchParams({ externalReference: operation.external_reference, limit: '2' });
    }
    const response = await request(url.href, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { access_token: apiKey, accept: 'application/json', 'user-agent': 'LKZ-ADM-VNext',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const result = await response.json();
    if (body !== undefined) return result;
    if (result?.hasMore !== false || !Array.isArray(result.data) || result.data.length !== 1) return null;
    return result.data[0];
  }

  return { create: (op, body) => send(op.kind, op, body), lookup: op => send(op.kind, op) };
}

function matches(op, record) {
  if (typeof record?.id !== 'string' || !idPatterns[op.kind].test(record.id)
    || record.externalReference !== op.external_reference || record.deleted === true) return false;
  if (op.kind === 'customers') return record.notificationDisabled === true;
  if (record.customer !== op.customer_id || amountInCents(record.value) !== op.amount_cents
    || (record.currency !== undefined && record.currency !== 'BRL')
    || (op.billing_type !== 'UNDEFINED' && record.billingType !== op.billing_type)) return false;
  if (op.kind === 'subscriptions') return record.cycle === op.cycle;
  return record.dueDate === op.due_date && !record.subscription;
}

async function reserve(db, { tenant, subject, kind, dueDate, billingType }) {
  return db.transaction(async tx => {
    let clientId = subject;
    let amount = null;
    let cycle = null;
    let customerId = null;
    const draftId = kind === 'customers' ? null : subject;
    if (draftId) {
      const { rows: [draft] } = await tx.query(`
        select d.client_id,p.amount_brl_cents,p.interval,c.provider_id
        from lkz_vnext.subscription_drafts d
        join lkz_vnext.plans p on p.tenant_id=d.tenant_id and p.id=d.plan_id
        join lkz_vnext_billing.sandbox_issuance c on c.tenant_id=d.tenant_id and c.client_id=d.client_id
        where d.tenant_id=$1 and d.id=$2 and c.kind='customers' and c.provider_id is not null
      `, [tenant, subject]);
      if (!draft || (draft.interval === 'once') !== (kind === 'payments')) return null;
      clientId = draft.client_id;
      amount = draft.amount_brl_cents;
      cycle = { monthly: 'MONTHLY', annual: 'YEARLY' }[draft.interval] ?? null;
      customerId = draft.provider_id;
    } else {
      const { rows } = await tx.query('select id from lkz_vnext.clients where tenant_id=$1 and id=$2', [tenant, subject]);
      if (rows.length !== 1) return null;
    }
    const { rows: [inserted] } = await tx.query(`
      insert into lkz_vnext_billing.sandbox_issuance
        (tenant_id,client_id,draft_id,kind,amount_cents,due_date,cycle,billing_type)
      values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing
      returning external_reference
    `, [tenant, clientId, draftId, kind, amount, dueDate, cycle, billingType]);
    const { rows: [operation] } = await tx.query(`
      select tenant_id,client_id,draft_id,kind,external_reference,provider_id,amount_cents,
        due_date::text as due_date,cycle,billing_type
      from lkz_vnext_billing.sandbox_issuance
      where tenant_id=$1 and client_id=$2 and draft_id is not distinct from $3::uuid and kind=$4
    `, [tenant, clientId, draftId, kind]);
    if (!operation || operation.due_date !== dueDate || operation.billing_type !== billingType) return null;
    return { ...operation, customer_id: customerId, newlyReserved: Boolean(inserted) };
  });
}

async function link(db, op, providerId) {
  return db.transaction(async tx => {
    const { rows: [linked] } = await tx.query(`
      update lkz_vnext_billing.sandbox_issuance set provider_id=$2, linked_at=now()
      where external_reference=$1 and provider_id is null returning provider_id
    `, [op.external_reference, providerId]);
    if (!linked) {
      const { rows: [current] } = await tx.query(
        'select provider_id from lkz_vnext_billing.sandbox_issuance where external_reference=$1', [op.external_reference]);
      return current?.provider_id === providerId ? 'already_linked' : 'needs_reconciliation';
    }
    if (op.kind === 'payments') {
      await tx.query(`
        insert into lkz_vnext_billing.payment_bindings
          (payment_id,tenant_id,subscription_id,customer_id,external_reference,expected_brl_cents)
        values ($1,$2,$3,$4,$5,$6)
      `, [providerId, op.tenant_id, op.draft_id, op.customer_id, op.external_reference, op.amount_cents]);
    }
    return 'linked';
  });
}

export async function issueSandboxRecord({ db, gateway, tenant, subject, kind, fixtureTaxId,
  dueDate = null, billingType = null }) {
  if (!uuid.test(tenant ?? '') || !uuid.test(subject ?? '') || !Object.hasOwn(idPatterns, kind)) return 'invalid';
  if (kind === 'customers') {
    if (dueDate !== null || billingType !== null || typeof fixtureTaxId !== 'string'
      || !/^(?:\d{11}|\d{14})$/.test(fixtureTaxId)) return 'invalid';
  } else {
    const date = new Date(dueDate + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate ?? '') || !Number.isFinite(date.getTime())
      || date.toISOString().slice(0, 10) !== dueDate || !['PIX', 'BOLETO', 'UNDEFINED'].includes(billingType)) return 'invalid';
  }
  const op = await reserve(db, { tenant, subject, kind, dueDate, billingType });
  if (!op) return 'not_eligible';
  if (op.provider_id) return 'already_linked';
  const fields = { externalReference: op.external_reference };
  const body = kind === 'customers'
    ? { ...fields, name: 'LKZ ADM Sandbox', cpfCnpj: fixtureTaxId, notificationDisabled: true }
    : { ...fields, customer: op.customer_id, value: op.amount_cents / 100, billingType,
      ...(kind === 'payments' ? { dueDate } : { nextDueDate: dueDate, cycle: op.cycle }) };
  try {
    // Persist the reservation before the first POST. Later calls only look up the reference.
    const record = op.newlyReserved ? await gateway.create(op, body) : await gateway.lookup(op);
    if (matches(op, record)) return await link(db, op, record.id);
  } catch {
    // A provider timeout or an interrupted local link must never trigger another POST.
  }
  return 'needs_reconciliation';
}
