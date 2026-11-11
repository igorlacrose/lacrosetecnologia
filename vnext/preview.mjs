import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createPreviewDatabase, fixture } from './preview-db.mjs';
import { serveWorkspace } from './workspace.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/app.mjs', ['app.mjs', 'text/javascript']],
]);

export function createPreviewServer(db) {
  return createServer(async (incoming, outgoing) => {
    try {
      const port = outgoing.socket.localPort;
      const origin = 'http://127.0.0.1:' + port;
      const url = new URL(incoming.url, origin);
      if (incoming.headers.host !== '127.0.0.1:' + port || url.origin !== origin) {
        outgoing.writeHead(403).end();
        return;
      }
      const headers = {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      };
      if (incoming.method === 'GET' && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        const content = await readFile(new URL('./web/' + file, import.meta.url));
        outgoing.writeHead(200, { ...headers, 'content-type': type + '; charset=utf-8' }).end(content);
        return;
      }
      if (!url.pathname.startsWith('/api/') || incoming.headers['sec-fetch-site'] === 'cross-site'
        || (incoming.method !== 'GET' && incoming.headers.origin !== origin)) {
        outgoing.writeHead(403, headers).end();
        return;
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of incoming) {
        bytes += chunk.length;
        if (bytes > 8192) {
          outgoing.writeHead(413, { ...headers, connection: 'close' }).end();
          return;
        }
        chunks.push(chunk);
      }
      const request = new Request(url, {
        method: incoming.method,
        headers: { 'content-type': incoming.headers['content-type'] ?? '' },
        body: incoming.method === 'POST' ? Buffer.concat(chunks) : undefined,
      });
      const response = await serveWorkspace(request, db, { sub: fixture.admin, aal: 'aal2' });
      outgoing.writeHead(response.status, { ...headers, 'content-type': 'application/json; charset=utf-8' })
        .end(await response.text());
    } catch {
      outgoing.writeHead(500).end();
    }
  });
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const db = await createPreviewDatabase();
  const server = createPreviewServer(db);
  server.listen(4176, '127.0.0.1', () => console.log('LKZ ADM VNext • http://127.0.0.1:4176'));
  process.once('SIGINT', () => server.close(() => db.close()));
}
