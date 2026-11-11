import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { withIdentity } from './preview-db.mjs';
import { normalizeOcaEvent, ocaBodyLimit } from './oca-envelope.mjs';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const reply = (status) => new Response(null, { status });

export function createOcaIntake({ db, tenant, actor, secret, now = Date.now }) {
  if (!uuid.test(tenant ?? '') || !uuid.test(actor ?? '') || typeof secret !== 'string' || !/^[a-f0-9]{64}$/i.test(secret)) {
    throw new Error('OCA requires tenant, technical actor and a 32-byte hexadecimal signing key');
  }

  return async function intake(request) {
    if (request.method !== 'POST') return reply(405);
    const timestamp = request.headers.get('x-oca-timestamp');
    const signature = request.headers.get('x-oca-signature');
    if (!/^\d{10}$/.test(timestamp ?? '') || !/^[0-9a-f]{64}$/.test(signature ?? '')
      || Math.abs(Math.floor(now() / 1000) - Number(timestamp)) > 300) return reply(401);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415);
    const body = Buffer.from(await request.arrayBuffer());
    if (body.length > ocaBodyLimit) return reply(413);
    const expected = createHmac('sha256', Buffer.from(secret, 'hex')).update(timestamp + '.').update(body).digest();
    if (!timingSafeEqual(Buffer.from(signature, 'hex'), expected)) return reply(401);

    let event;
    try { event = normalizeOcaEvent(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))); }
    catch { return reply(400); }
    if (!event) return reply(400);
    const { eventId, conversationId, name, email, note } = event;
    const digest = createHash('sha256').update(JSON.stringify([conversationId, name, email, note])).digest('hex');
    try {
      return await withIdentity(db, { sub: actor, aal: 'aal2' }, async tx => {
        const { rows: [membership] } = await tx.query(
          "select role from lkz_vnext.memberships where tenant_id = $1 and role = 'operator'", [tenant],
        );
        if (!membership) return reply(403);
        await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [tenant + ':' + eventId]);
        const { rows: [prior] } = await tx.query(
          'select oca_event_digest from lkz_vnext.interactions where tenant_id=$1 and oca_event_id=$2', [tenant, eventId],
        );
        if (prior) return reply(prior.oca_event_digest === digest ? 200 : 409);
        await tx.query(`
          insert into lkz_vnext.leads (tenant_id, oca_reference, name, email)
          values ($1,$2,$3,$4) on conflict (tenant_id,oca_reference) do nothing
        `, [tenant, conversationId, name, email]);
        const { rows: [lead] } = await tx.query(
          'select id, email from lkz_vnext.leads where tenant_id=$1 and oca_reference=$2', [tenant, conversationId],
        );
        if (lead.email !== email) return reply(409);
        await tx.query(`
          insert into lkz_vnext.interactions (tenant_id, lead_id, channel, note, oca_event_id, oca_event_digest)
          values ($1,$2,'oca',$3,$4,$5)
        `, [tenant, lead.id, note, eventId, digest]);
        return reply(201);
      });
    } catch (error) {
      if (['23502', '23514', '22P02'].includes(error.code)) return reply(400);
      return reply(error.code === '42501' ? 403 : 503);
    }
  };
}
