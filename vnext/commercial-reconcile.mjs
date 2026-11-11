import { fetchAsaasSandboxPayment } from './asaas-sandbox.mjs';

const commercialState = new Map([
  ['PENDING', 'pending'], ['RECEIVED', 'paid'], ['CONFIRMED', 'paid'], ['OVERDUE', 'overdue'],
  ['REFUNDED', 'reversed'], ['REFUND_IN_PROGRESS', 'reversed'], ['CHARGEBACK_REQUESTED', 'disputed'],
  ['CHARGEBACK_DISPUTE', 'disputed'], ['AWAITING_CHARGEBACK_REVERSAL', 'disputed'],
]);

export async function reconcileBoundSandboxPayment({ db, eventId, apiKey, request }) {
  // The connection uses a login dedicated to the reconcile role. Serialize the
  // gateway lookup and local transition for this payment in one transaction.
  return db.transaction(async tx => {
    const { rows: [event] } = await tx.query(`
      select payment_id from lkz_vnext_billing.asaas_sandbox_events where event_id=$1
    `, [eventId]);
    if (!event) return 'event_missing';

    const { rows: [binding] } = await tx.query(`
      select * from lkz_vnext_billing.payment_bindings where payment_id=$1 for update
    `, [event.payment_id]);
    if (!binding) return 'unbound';

    const prior = await tx.query('select 1 from lkz_vnext_billing.payment_state_events where event_id=$1', [eventId]);
    if (prior.rows.length) return 'already_processed';

    const payment = await fetchAsaasSandboxPayment(event.payment_id, apiKey, request);
    const state = commercialState.get(payment.status);
    if (!state) return 'unrecognized_status';
    // The Asaas Sandbox payment API returns BRL for these domestic payments.
    // Compare decimal representations exactly and accept at most two decimals.
    const amount = typeof payment.value === 'number' ? String(payment.value) : '';
    const parts = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(amount);
    const cents = parts ? Number(parts[1]) * 100 + Number((parts[2] ?? '').padEnd(2, '0')) : NaN;
    if (cents !== binding.expected_brl_cents || payment.customer !== binding.customer_id
      || payment.externalReference !== binding.external_reference
      || (payment.currency !== undefined && payment.currency !== 'BRL')) return 'mismatch';

    await tx.query('update lkz_vnext_billing.payment_bindings set state=$2 where payment_id=$1', [event.payment_id, state]);
    await tx.query(`
      insert into lkz_vnext_billing.payment_state_events (event_id,payment_id,state)
      values ($1,$2,$3)
    `, [eventId, event.payment_id, state]);
    return state;
  });
}
