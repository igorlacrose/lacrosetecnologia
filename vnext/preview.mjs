import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createPreviewDatabase, fixture, isSyntheticPreviewDatabase } from './preview-db.mjs';
import { serveWorkspace } from './workspace.mjs';
import { ocaBodyLimit } from './oca-envelope.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/app.mjs', ['app.mjs', 'text/javascript']],
  ['/whatsapp-signup.mjs', ['whatsapp-signup.mjs', 'text/javascript']],
]);

export function createPreviewServer(db, {
  auth, oca, asaasWebhook, webhookOnly = false, lacroseTenant = fixture.tenant,
  metaProvider = null, appointmentWebhook = null, allowSyntheticIdentity = false,
} = {}) {
  if (webhookOnly && !asaasWebhook) throw new Error('A webhook handler is required');
  // Synthetic administrators are never available to persistent workspaces.
  if (allowSyntheticIdentity && (auth || webhookOnly || !isSyntheticPreviewDatabase(db))) {
    throw new Error('Synthetic identity is permitted only with a local preview fixture');
  }
  if (!webhookOnly && !allowSyntheticIdentity
    && (typeof auth?.verify !== 'function' || typeof auth?.handle !== 'function')) {
    throw new Error('A verified authentication provider is required for VNext workspace');
  }
  const limits = { requestTimeout: 15_000, headersTimeout: 10_000 };
  return createServer(limits, async (incoming, outgoing) => {
    try {
      const port = outgoing.socket.localPort;
      const origin = 'http://127.0.0.1:' + port;
      const url = new URL(incoming.url, origin);
      if (incoming.headers.host !== '127.0.0.1:' + port || url.origin !== origin) {
        outgoing.writeHead(403).end();
        return;
      }
      const metaCsp = metaProvider
        ? "script-src 'self' https://connect.facebook.net; frame-src https://www.facebook.com https://web.facebook.com https://business.facebook.com; connect-src 'self' https://www.facebook.com https://graph.facebook.com"
        : "script-src 'self'; connect-src 'self'";
      const headers = {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'self'; " + metaCsp +
          "; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      };
      if (webhookOnly) {
        if (incoming.url !== '/integrations/asaas-sandbox') {
          outgoing.writeHead(404, headers).end();
          return;
        }
        if (incoming.method !== 'POST') {
          outgoing.writeHead(405, { ...headers, allow: 'POST' }).end();
          return;
        }
      }
      if (incoming.method === 'GET' && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        const content = await readFile(new URL('./web/' + file, import.meta.url));
        outgoing.writeHead(200, { ...headers, 'content-type': type + '; charset=utf-8' }).end(content);
        return;
      }
      const ocaRoute = Boolean(oca && url.pathname === '/integrations/oca');
      const asaasRoute = Boolean(asaasWebhook && url.pathname === '/integrations/asaas-sandbox');
      const appointmentRoute = Boolean(appointmentWebhook && url.pathname === '/integrations/appointments');
      const integrationRoute = ocaRoute || asaasRoute || appointmentRoute;
      if ((!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/auth/') && !integrationRoute)
        || incoming.headers['sec-fetch-site'] === 'cross-site'
        || (incoming.method !== 'GET' && !integrationRoute && incoming.headers.origin !== origin)) {
        outgoing.writeHead(403, headers).end();
        return;
      }
      const chunks = [];
      let bytes = 0;
      const limit = asaasRoute ? 64 * 1024 : appointmentRoute ? 4096 : ocaBodyLimit;
      for await (const chunk of incoming) {
        bytes += chunk.length;
        if (bytes > limit) {
          outgoing.writeHead(413, { ...headers, connection: 'close' }).end();
          return;
        }
        chunks.push(chunk);
      }
      const requestHeaders = {
        'content-type': incoming.headers['content-type'] ?? '',
        authorization: incoming.headers.authorization ?? '',
      };
      if (ocaRoute) {
        requestHeaders['x-oca-timestamp'] = incoming.headers['x-oca-timestamp'] ?? '';
        requestHeaders['x-oca-signature'] = incoming.headers['x-oca-signature'] ?? '';
      }
      if (asaasRoute) requestHeaders['asaas-access-token'] = incoming.headers['asaas-access-token'] ?? '';
      if (appointmentRoute) {
        requestHeaders['x-lkz-source-id'] = incoming.headers['x-lkz-source-id'] ?? '';
        requestHeaders['x-lkz-timestamp'] = incoming.headers['x-lkz-timestamp'] ?? '';
        requestHeaders['x-lkz-signature'] = incoming.headers['x-lkz-signature'] ?? '';
      }
      const request = new Request(url, {
        method: incoming.method,
        headers: requestHeaders,
        body: incoming.method === 'POST' ? Buffer.concat(chunks) : undefined,
      });
      let response;
      if (ocaRoute) response = await oca(request);
      else if (asaasRoute) response = await asaasWebhook(request);
      else if (appointmentRoute) response = await appointmentWebhook(request);
      else if (url.pathname === '/auth/status' && incoming.method === 'GET') {
        response = Response.json({ requiresLogin: Boolean(auth) });
      } else if (url.pathname.startsWith('/auth/')) {
        response = auth ? await auth.handle(request) : Response.json({}, { status: 404 });
      } else {
        const token = incoming.headers.authorization?.match(/^Bearer ([\w.-]+)$/)?.[1];
        const claims = auth ? await auth.verify(token)
          : allowSyntheticIdentity ? { sub: fixture.admin, aal: 'aal2' } : null;
        response = await serveWorkspace(request, db, claims, { lacroseTenant, metaProvider });
      }
      outgoing.writeHead(response.status, { ...headers, 'content-type': 'application/json; charset=utf-8' })
        .end(await response.text());
    } catch {
      outgoing.writeHead(500).end();
    }
  });
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const db = await createPreviewDatabase();
  const server = createPreviewServer(db, { allowSyntheticIdentity: true });
  server.listen(4176, '127.0.0.1', () => console.log('LKZ ADM VNext • http://127.0.0.1:4176'));
  process.once('SIGINT', () => server.close(() => db.close()));
}
