import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOcaIntake } from '../oca-intake.mjs';
import { ocaBodyLimit } from '../oca-envelope.mjs';

const endpoint = 'https://staging.example.test/integrations/oca';
const timestamp = String(Math.floor(Date.now() / 1000));
let databaseCalls = 0;
const intake = createOcaIntake({
  db: {
    transaction() {
      databaseCalls++;
      throw new Error('Unauthenticated requests must never reach the database');
    },
  },
  tenant: '00000000-0000-4000-8000-000000000001',
  actor: '00000000-0000-4000-8000-000000000012',
  secret: 'a'.repeat(64),
});

function signedShape(body, extraHeaders = {}) {
  return new Request(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-oca-timestamp': timestamp,
      'x-oca-signature': '0'.repeat(64),
      ...extraHeaders,
    },
    body,
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  });
}

test('OCA refuses a streamed body above its limit, cancels it, and never calls DB', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(ocaBodyLimit));
      controller.enqueue(new Uint8Array(1));
      // Deliberately leave the producer open to prove cancellation.
    },
    cancel() { cancelled = true; },
  });
  const result = await intake(signedShape(stream));
  assert.equal(result.status, 413);
  assert.equal(cancelled, true);
  assert.equal(databaseCalls, 0);
});

test('OCA processes the exact size boundary without treating a bad signature as valid', async () => {
  const exact = new Uint8Array(ocaBodyLimit);
  const result = await intake(signedShape(exact));
  assert.equal(result.status, 401);
  assert.equal(databaseCalls, 0);
});

test('OCA rejects oversized declared bodies, absent bodies, and broken streams', async () => {
  assert.equal((await intake(signedShape(
    '{}', { 'content-length': String(ocaBodyLimit + 1) }
  ))).status, 413);
  assert.equal((await intake(signedShape(undefined))).status, 400);
  const broken = new ReadableStream({
    start(controller) { controller.error(new Error('Synthetic interrupted upload')); },
  });
  assert.equal((await intake(signedShape(broken))).status, 400);
  assert.equal(databaseCalls, 0);
});
