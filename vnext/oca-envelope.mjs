const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export const ocaBodyLimit = 8192;

export function normalizeOcaEvent(event) {
  if (event?.consent !== true || typeof event.eventId !== 'string' || !uuid.test(event.eventId)
    || typeof event.conversationId !== 'string' || !uuid.test(event.conversationId)
    || typeof event.name !== 'string' || typeof event.email !== 'string' || typeof event.note !== 'string') return null;
  const name = event.name.trim();
  const email = event.email.trim().toLowerCase();
  const note = event.note.trim();
  if (!name || name.length > 160 || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)
    || !note || note.length > 2000 || [name, email, note].some(value => value.includes('\0'))) return null;
  return { eventId: event.eventId.toLowerCase(), conversationId: event.conversationId.toLowerCase(),
    consent: true, name, email, note };
}
