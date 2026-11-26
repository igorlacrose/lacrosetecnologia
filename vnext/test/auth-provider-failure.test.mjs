import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStagingAuth } from '../staging-auth.mjs';

const origin = 'https://fixtureauth.supabase.co';
const publishableKey = 'sb_publishable_fixture_only';
const token = 'signed.claims.signature';

test('staging rejects tokens when Supabase getClaims rejects unexpectedly', async () => {
  let validations = 0;
  const auth = createStagingAuth({
    url: origin,
    publishableKey,
    clientFactory: () => ({ auth: {
      async getClaims() {
        validations++;
        throw new Error('Synthetic JWKS provider failure');
      },
    } }),
    request: async () => {
      throw new Error('Verification must not trigger login requests');
    },
  });

  assert.equal(await auth.verify(token), null);
  assert.equal(await auth.verify(token, false), null);
  assert.equal(validations, 2);

  const request = new Request('https://fixture.test/auth/mfa', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({
      factorId: '00000000-0000-4000-8000-000000000011',
      code: '123456',
    }),
  });
  const response = await auth.handle(request);
  assert.equal(response.status, 401);
  assert.equal(validations, 3);
});

test('staging login denies a new session when provider token cannot be verified', async () => {
  let requests = 0;
  const auth = createStagingAuth({
    url: origin,
    publishableKey,
    clientFactory: () => ({ auth: {
      async getClaims() {
        throw new Error('Synthetic token verification outage');
      },
    } }),
    request: async () => {
      requests++;
      return Response.json({ access_token: token });
    },
  });
  const response = await auth.handle(new Request('https://fixture.test/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'fictitious@example.test',
      password: 'not-real-credential',
    }),
  }));
  assert.equal(response.status, 401);
  assert.equal(requests, 1);
});
