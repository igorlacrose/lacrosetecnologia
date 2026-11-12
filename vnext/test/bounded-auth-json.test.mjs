import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBoundedJson } from '../bounded-json.mjs';
import { createStagingAuth } from '../staging-auth.mjs';

const authOrigin = 'https://authfixture.supabase.co';
const publishableKey = 'sb_publishable_synthetic_only';
const userId = '00000000-0000-4000-8000-000000000011';
const factorId = '00000000-0000-4000-8000-000000000012';
const validToken = 'synthetic.jwt.signature';
const passwordRequest = () => new Request('https://fixture.test/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'ci-only@example.test', password: 'not-a-real-password' }),
});

function createAuth(request) {
  return createStagingAuth({
    url: authOrigin, publishableKey, request,
    clientFactory: () => ({ auth: {
      getClaims: async () => ({ data: { claims: {
        iss: authOrigin + '/auth/v1', aud: 'authenticated', role: 'authenticated',
        is_anonymous: false, sub: userId,
        exp: Math.floor(Date.now() / 1000) + 60, aal: 'aal1',
      } } }),
    } }),
  });
}

test('bounded JSON accepts ordinary provider results', async () => {
  const expected = { token: validToken, factors: [{ id: factorId }] };
  assert.deepEqual(await readBoundedJson(Response.json(expected),64 * 1024),expected);
});

test('bounded JSON rejects Content-Length over 64 KiB without parsing it', async () => {
  const response = Response.json({ access_token: validToken });
  response.headers.set('content-length',String(64 * 1024 + 1));
  await assert.rejects(readBoundedJson(response,64 * 1024),
    error => error instanceof RangeError);
});

test('bounded JSON cancels an oversized streamed provider body', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(64 * 1024));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readBoundedJson(new Response(stream),64 * 1024),
    error => error instanceof RangeError);
  assert.equal(cancelled,true);
});

test('Auth login refuses oversized provider Content-Length, fail-closed', async () => {
  let requests = 0;
  const auth = createAuth(async () => {
    requests++;
    const response = Response.json({ access_token: validToken });
    response.headers.set('content-length',String(64 * 1024 + 1));
    return response;
  });
  const response = await auth.handle(passwordRequest());
  assert.equal(response.status,401);
  assert.equal(requests,1);
});

test('Auth login refuses actual provider stream larger than 64 KiB', async () => {
  let cancelled = false;
  const auth = createAuth(async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(64 * 1024));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { cancelled = true; },
  })));
  assert.equal((await auth.handle(passwordRequest())).status,401);
  assert.equal(cancelled,true);
});

test('Auth login refuses malformed JSON, provider exceptions and network errors', async () => {
  for(const request of [
    async () => new Response('{invalid'),
    async () => new Response(new Uint8Array([0xff,0xfe])),
    async () => { throw new Error('Synthetic outage'); },
  ]) {
    const auth = createAuth(request);
    assert.equal((await auth.handle(passwordRequest())).status,401);
  }
});

test('Auth login denies oversized incoming request before calling provider', async () => {
  let requests = 0;
  const auth = createAuth(async () => { requests++; return Response.json({}); });
  const body = JSON.stringify({ email:'ci-only@example.test',password:'x'.repeat(10 * 1024) });
  const response = await auth.handle(new Request('https://fixture.test/auth/login', {
    method:'POST', headers:{'content-type':'application/json'},body,
  }));
  assert.equal(response.status,401);
  assert.equal(requests,0);
});

test('Auth MFA denies malformed provider challenge without issuing another token', async () => {
  let requests = 0;
  const auth = createAuth(async (url) => {
    requests++;
    if(url.endsWith('/challenge')) return new Response('{invalid');
    throw new Error('MFA verify must not run after malformed challenge');
  });
  const response = await auth.handle(new Request('https://fixture.test/auth/mfa', {
    method:'POST',
    headers:{'content-type':'application/json', authorization:'Bearer ' + validToken},
    body:JSON.stringify({factorId,code:'123456'}),
  }));
  assert.equal(response.status,401);
  assert.equal(requests,1);
});
