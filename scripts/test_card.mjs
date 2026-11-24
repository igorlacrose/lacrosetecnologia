import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const html = readFileSync(new URL('../card/index.html', import.meta.url), 'utf8');
const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const worker = readFileSync(new URL('../card/sw.js', import.meta.url), 'utf8');
const cardUrl = 'https://lacrosetecnologia.com.br/card/';

function setup({ share, clipboardFails = false, protocol = 'https:' } = {}) {
  const elements = new Map();
  const copied = [], downloads = [], registrations = [];
  let activeElement;
  const element = (id) => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        id, hidden: false, inert: id === '.card-back', attributes: {},
        textContent: '', handlers: {},
        classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
        addEventListener(type, callback) { this.handlers[type] = callback; },
        setAttribute(name, value) { this.attributes[name] = value; },
        focus() { activeElement = this.id; },
        click() { return this.handlers.click?.(); }
      });
    }
    return elements.get(id);
  };
  const logo = element('.emblem-box img');
  logo.complete = true;
  logo.naturalWidth = 68;
  logo.nextElementSibling = { hidden: true };
  const blobs = [];
  const document = {
    getElementById: element, querySelector: element,
    addEventListener(type, callback) { if (type === 'DOMContentLoaded') this.ready = callback; },
    createElement() { return { click() { downloads.push({ href: this.href, download: this.download }); } }; },
    body: { appendChild() {}, removeChild() {} }
  };
  const navigator = {
    clipboard: { async writeText(text) { if (clipboardFails) throw new Error('denied'); copied.push(text); } },
    serviceWorker: { async register(...args) { registrations.push(args); return { async update() {} }; } }
  };
  if (share) navigator.share = share;
  vm.runInNewContext(script, {
    document, navigator, location: { protocol }, Blob, Date,
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    setTimeout() { return 1; }, clearTimeout() {}
  });
  document.ready();
  return { element, copied, downloads, blobs, registrations, focus: () => activeElement };
}

test('ecosystem links reach the existing capabilities showcase', () => {
  const links = [...html.matchAll(/<a href="([^"]+)"[^>]*class="eco-pill">([^<]+)<\/a>/g)];
  assert.deepEqual(links.map(m => m[2]), ['LCRM', 'LKZ ADM', 'LKZ ERP', 'LISP']);
  assert.ok(links.every(m => m[1] === 'https://lacrosetecnologia.com.br/#capacidades'));
  assert.match(home, /<section[^>]+id="capacidades"/);
  assert.match(home, /class="system-showcase"/);
});

test('CSP allows the exact inline script and style without unsafe-inline or eval', () => {
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
  for (const tag of ['script', 'style']) {
    const content = html.match(new RegExp(`<${tag}>([\\s\\S]*?)<\/${tag}>`))[1];
    const hash = createHash('sha256').update(content).digest('base64');
    const directive = policy.split(';').find(d => d.trim().startsWith(`${tag}-src `));
    assert.ok(directive.includes(`'sha256-${hash}'`), `${tag} hash must match`);
  }
  assert.doesNotMatch(html, /\son\w+\s*=|\sstyle\s*=/i);
  assert.doesNotMatch(script, /innerHTML|localStorage|sessionStorage|eval\(|new Function/);
});

test('contact links preserve both commercial numbers and safe new tabs', () => {
  const app = setup();
  assert.equal(app.element('telLink').href, 'tel:+5573981097097');
  assert.match(app.element('waLink').href, /^https:\/\/wa.me\/5573981097097\?text=/);
  assert.match(html, /href="https:\/\/wa.me\/5573982455573"/);
  for (const a of html.matchAll(/<a\s[^>]*target="_blank"[^>]*>/g)) assert.match(a[0], /rel="[^"\n]*\bnoopener\b/);
});

test('flip and return move focus and disable the hidden face, including repeated use', async () => {
  const app = setup();
  for (let i = 0; i < 3; i++) {
    await app.element('flipToBackBtn').click();
    assert.equal(app.element('.card-front').inert, true);
    assert.equal(app.element('.card-back').inert, false);
    assert.equal(app.element('.card-front').attributes['aria-hidden'], 'true');
    assert.equal(app.focus(), 'flipToFrontBtn');
    assert.equal(app.element('cardFlipper').classList.contains('is-flipped'), true);
    await app.element('flipToFrontBtn').click();
    assert.equal(app.element('.card-front').inert, false);
    assert.equal(app.element('.card-back').inert, true);
    assert.equal(app.focus(), 'flipToBackBtn');
    assert.equal(app.element('cardFlipper').classList.contains('is-flipped'), false);
  }
});

test('downloaded vCard has CRLF, escaped text, both phones and the canonical card URL', async () => {
  const app = setup();
  await app.element('vcfBtn').click();
  assert.equal(app.downloads[0].download, 'Igor-Lacrose.vcf');
  assert.equal(app.blobs[0].type, 'text/vcard;charset=utf-8');
  const vcf = await app.blobs[0].text();
  assert.ok(vcf.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n'));
  assert.ok(vcf.endsWith('END:VCARD\r\n'));
  assert.match(vcf, /TEL;TYPE=WORK,VOICE:\+5573981097097\r\n/);
  assert.match(vcf, /TEL;TYPE=WORK,VOICE:\+5573982455573\r\n/);
  assert.ok(vcf.includes(`URL:${cardUrl}\r\n`));
  assert.match(vcf, /sob medida\\, IA/);
  assert.ok(vcf.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
});

test('copy actions and sharing fallback use the canonical URL', async () => {
  const app = setup();
  await app.element('copyPhoneBtn').click();
  await app.element('copyUrlBtn').click();
  await app.element('shareBtn').click();
  assert.deepEqual(app.copied, ['+55 (73) 98109-7097', cardUrl, cardUrl]);
});

test('native share sends the right payload and falls back on real errors but respects cancellation', async () => {
  let payload;
  const app = setup({ share: async (data) => { payload = data; } });
  await app.element('shareBtn').click();
  assert.equal(payload.url, cardUrl);
  assert.equal(payload.title, 'Igor Lacrose — Lacrose Tecnologia');
  assert.equal(app.copied.length, 0);
  const failure = setup({ share: async () => { throw { name: 'NotAllowedError' }; } });
  await failure.element('shareBtn').click();
  assert.deepEqual(failure.copied, [cardUrl]);
  const cancel = setup({ share: async () => { throw { name: 'AbortError' }; } });
  await cancel.element('shareBtn').click();
  assert.equal(cancel.copied.length, 0);
});

test('clipboard denial displays recoverable contact data', async () => {
  const app = setup({ clipboardFails: true });
  await app.element('copyPhoneBtn').click();
  assert.equal(app.element('toast').textContent, '+55 (73) 98109-7097');
  await app.element('shareBtn').click();
  assert.equal(app.element('toast').textContent, cardUrl);
});

test('logo errors use the existing fallback and SW registration is HTTPS scoped', async () => {
  const app = setup();
  app.element('.emblem-box img').handlers.error();
  assert.equal(app.element('.emblem-box img').hidden, true);
  assert.equal(app.element('.emblem-box img').nextElementSibling.hidden, false);
  assert.equal(app.registrations[0][0], '/card/sw.js');
  assert.equal(app.registrations[0][1].scope, '/card/');
  assert.equal(app.registrations[0][1].updateViaCache, 'none');
  assert.equal(setup({ protocol: 'http:' }).registrations.length, 0);
});

function setupWorker() {
  const scope = cardUrl;
  const listeners = {}, deleted = [], added = [], puts = [];
  const prefix = `lacrose-card:${scope}:`;
  let offline = false, claimed = false, skipped = false;
  const cache = {
    async addAll(assets) { added.push(...assets); },
    async put(request, response) { puts.push([request, response]); },
    async match(request) { return request === 'index.html' ? new Response('offline card') : undefined; }
  };
  vm.runInNewContext(worker, {
    URL, Response,
    self: { registration: { scope }, location: { origin: new URL(scope).origin },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      async skipWaiting() { skipped = true; }, clients: { async claim() { claimed = true; } }
    },
    caches: {
      async open() { return cache; },
      async keys() { return [prefix + 'v6-premium-approved', prefix + 'v7-executive-card', 'other-app-cache']; },
      async delete(key) { deleted.push(key); }
    },
    async fetch() { if (offline) throw new Error('offline'); return new Response('fresh card'); }
  });
  const lifecycle = async type => { let done; listeners[type]({ waitUntil(p) { done = p; } }); await done; };
  const request = (url, mode = 'cors', method = 'GET') => {
    let response;
    listeners.fetch({ request: { url, mode, method }, respondWith(p) { response = p; } });
    return response;
  };
  return { lifecycle, request, added, deleted, puts, setOffline() { offline = true; }, state: () => ({ claimed, skipped }) };
}

test('SW updates only its own cache and precaches the approved logo', async () => {
  const sw = setupWorker();
  await sw.lifecycle('install');
  await sw.lifecycle('activate');
  assert.ok(sw.added.includes('/assets/logo-mark.webp'));
  assert.ok(sw.added.includes('index.html'));
  assert.deepEqual(sw.deleted, [`lacrose-card:${cardUrl}:v6-premium-approved`]);
  assert.deepEqual(sw.state(), { claimed: true, skipped: true });
});

test('SW is network-first for navigation and recovers offline without intercepting private routes', async () => {
  const sw = setupWorker();
  assert.equal(await (await sw.request(cardUrl, 'navigate')).text(), 'fresh card');
  assert.equal(sw.puts.length, 1);
  sw.setOffline();
  assert.equal(await (await sw.request(cardUrl, 'navigate')).text(), 'offline card');
  assert.equal(sw.request('https://lacrosetecnologia.com.br/admin/'), undefined);
  assert.equal(sw.request('https://lacrosetecnologia.com.br/card/', 'cors', 'POST'), undefined);
  assert.equal(sw.request('https://example.com/card/'), undefined);
});
