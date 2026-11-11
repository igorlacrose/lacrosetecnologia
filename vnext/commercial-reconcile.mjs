import { fetchAsaasSandboxPayment } from './asaas-sandbox.mjs';
import { amountInCents } from './asaas-issuance.mjs';

const commercialState = new Map([
  ['PENDING', 'pending'], ['RECEIVED', 'paid'], ['CONFIRMED', 'paid'], ['OVERDUE', 'overdue'],
  ['REFUNDED', 'reversed'], ['REFUND_IN_PROGRESS', 'reversed'], ['CHARGEBACK_REQUESTED', 'disputed'],
  ['CHARGEBACK_DISPUTE', 'disputed'], ['AWAITING_CHARGEBACK_REVERSAL', 'disputed'],
]);
const appliedStates = new Set(['already_processed', ...commercialState.values()]);

export async function reconcileBoundSandboxPayment({ db, eventId, apiKey, request }) {
  return db.transaction(async tx => {
    const { rows: [event] } = await tx.query(
      'select payment_id from lkz_vnext_billing.asaas_sandbox_events where event_id=$1 for no key update', [eventId]);
    if (!event) return 'event_missing';
    const result = await applyPaymentEvent(tx, { eventId, event, apiKey, request });
    if (appliedStates.has(result)) {
      await tx.query(`
        update lkz_vnext_billing.asaas_sandbox_events
        set commercial_finished_at=coalesce(commercial_finished_at,now()),commercial_result='applied'
        where event_id=$1
      `, [eventId]);
    }
    return result;
  });
}

export async function reconcileNextCommercialEvent({ db, apiKey, request }) {
  return db.transaction(async tx => {
    const { rows: [event] } = await tx.query(`
      select event_id,payment_id,commercial_attempts from lkz_vnext_billing.asaas_sandbox_events
      where commercial_finished_at is null and commercial_next_attempt_at <= now()
      order by commercial_next_attempt_at,event_id limit 1 for no key update skip locked
    `);
    if (!event) return 'idle';

    const result = await applyPaymentEvent(tx, { eventId: event.event_id, event, apiKey, request });
    const applied = appliedStates.has(result);
    const attempts = event.commercial_attempts + 1;
    const final = applied || result === 'mismatch' || attempts >= 5;
    const outcome = applied ? 'applied' : final ? 'needs_review' : 'retry';
    await tx.query(`
      update lkz_vnext_billing.asaas_sandbox_events set commercial_attempts=$2,
        commercial_next_attempt_at=now() + interval '30 seconds' * power(2, $2::integer - 1),
        commercial_finished_at=case when $3::boolean then now() end, commercial_result=$4
      where event_id=$1
    `, [event.event_id, attempts, final, outcome]);
    return outcome;
  });
}

async function applyPaymentEvent(tx, { eventId, event, apiKey, request }) {
  await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', ['asaas:' + event.payment_id]);
  let { rows: [binding] } = await tx.query(
    'select * from lkz_vnext_billing.payment_bindings where payment_id=$1 for update', [event.payment_id]);

  const prior = await tx.query('select 1 from lkz_vnext_billing.payment_state_events where event_id=$1', [eventId]);
  if (prior.rows.length) return 'already_processed';

  let payment;
  try { payment = await fetchAsaasSandboxPayment(event.payment_id, apiKey, request); }
  catch { return 'lookup_failed'; }
  const state = commercialState.get(payment.status);
  if (!state) return 'unrecognized_status';
  if (!binding && typeof payment.subscription === 'string' && /^sub_[A-Za-z0-9_-]{1,120}$/.test(payment.subscription)) {
    const { rows } = await tx.query(`
      select s.tenant_id,s.draft_id as subscription_id,c.provider_id as customer_id,s.external_reference,
        s.amount_cents as expected_brl_cents,s.provider_id as provider_subscription_id
      from lkz_vnext_billing.sandbox_issuance s join lkz_vnext_billing.sandbox_issuance c using (tenant_id,client_id)
      where s.kind='subscriptions' and s.provider_id=$1 and c.kind='customers' and c.provider_id is not null
    `, [payment.subscription]);
    binding = rows[0];
  }
  if (!binding) return 'unbound';

  const cents = amountInCents(payment.value);
  const recurring = Boolean(binding.provider_subscription_id);
  if (cents !== binding.expected_brl_cents || payment.customer !== binding.customer_id
    || (recurring
      ? payment.subscription !== binding.provider_subscription_id
        || (payment.externalReference != null && payment.externalReference !== binding.external_reference)
      : Boolean(payment.subscription) || payment.externalReference !== binding.external_reference)
    || (payment.currency !== undefined && payment.currency !== 'BRL')) return 'mismatch';

  if (recurring) {
    await tx.query(`
      insert into lkz_vnext_billing.payment_bindings
        (payment_id,tenant_id,subscription_id,customer_id,external_reference,expected_brl_cents,provider_subscription_id)
      values ($1,$2,$3,$4,$5,$6,$7) on conflict (payment_id) do nothing
    `, [event.payment_id, binding.tenant_id, binding.subscription_id, binding.customer_id,
      binding.external_reference, binding.expected_brl_cents, binding.provider_subscription_id]);
  }
  await tx.query('update lkz_vnext_billing.payment_bindings set state=$2 where payment_id=$1', [event.payment_id, state]);
  await tx.query(`
    insert into lkz_vnext_billing.payment_state_events (event_id,payment_id,state)
    values ($1,$2,$3)
  `, [eventId, event.payment_id, state]);
  return state;
}
