import { createClient } from '@supabase/supabase-js';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function createStagingAuth({ url, publishableKey, clientFactory = createClient, request = fetch }) {
  const project = new URL(url);
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(project.origin)
    || project.hostname === 'icrtewhazpfauuroswri.supabase.co'
    || project.href !== project.origin + '/' || !publishableKey?.startsWith('sb_publishable_')) {
    throw new Error('Use a separate Supabase Auth project and its publishable key');
  }
  const issuer = project.origin + '/auth/v1';
  const client = clientFactory(project.origin, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  async function verify(token, requireMfa = true) {
    if (typeof token !== 'string' || token.length > 6000 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return null;
    const { data, error } = await client.auth.getClaims(token);
    const claims = data?.claims;
    if (error || !claims || claims.iss !== issuer || claims.aud !== 'authenticated'
      || claims.role !== 'authenticated' || claims.is_anonymous !== false || !uuid.test(claims.sub ?? '')
      || !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000
      || !['aal1', 'aal2'].includes(claims.aal) || (requireMfa && claims.aal !== 'aal2')) return null;
    return { sub: claims.sub, aal: claims.aal };
  }

  async function send(path, { method = 'POST', token, body } = {}) {
    const response = await request(issuer + path, {
      method,
      headers: {
        apikey: publishableKey,
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    return response.status === 204 ? {} : response.json();
  }

  async function handle(request) {
    if (request.method !== 'POST') return Response.json({}, { status: 405 });
    const data = await request.json().catch(() => null);
    const action = new URL(request.url).pathname;
    const denied = () => Response.json({ error: 'Sessão ou verificação inválida.' }, { status: 401 });
    if (action === '/auth/login') {
      if (typeof data?.email !== 'string' || data.email.length > 254
        || typeof data.password !== 'string' || !data.password || data.password.length > 1024) return denied();
      const result = await send('/token?grant_type=password', { body: { email: data.email, password: data.password } });
      if (!await verify(result?.access_token, false)) return denied();
      const user = await send('/user', { method: 'GET', token: result.access_token });
      const factors = Array.isArray(user?.factors) ? user.factors : [];
      const factor = factors.find(item => item.factor_type === 'totp' && item.status === 'verified' && uuid.test(item.id));
      if (!factor) return Response.json({ error: 'Cadastre o autenticador TOTP no ambiente de homologação.' }, { status: 403 });
      return Response.json({ token: result.access_token, factorId: factor.id });
    }

    const token = request.headers.get('authorization')?.match(/^Bearer ([\w.-]+)$/)?.[1];
    if (action !== '/auth/mfa' || !await verify(token, false)
      || !uuid.test(data?.factorId ?? '') || !/^\d{6}$/.test(data?.code ?? '')) return denied();
    const path = '/factors/' + data.factorId;
    const challenge = await send(path + '/challenge', { token, body: {} });
    if (!uuid.test(challenge?.id ?? '')) return denied();
    const result = await send(path + '/verify', { token, body: { challenge_id: challenge.id, code: data.code } });
    if (!await verify(result?.access_token)) return denied();
    return Response.json({ token: result.access_token });
  }

  return { verify, handle };
}
