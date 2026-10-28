import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../infra-monitor.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const edge = readFileSync(new URL('../../infra/edge-functions/lacrose-admin-infra-monitor/index.ts', import.meta.url), 'utf8');

class Node {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.attributes = {};
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
  }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  async click() { return await this.listeners.click?.(); }
  setAttribute(name, value) { this.attributes[name] = value; }
}
function mount(resolver) {
  const nav = new Node('button');
  const refresh = new Node('button');
  const cards = new Node();
  const updated = new Node();
  const adminApp = new Node();
  let invoked = 0;
  const elements = { infraRefresh: refresh, infraCards: cards, infraUpdated: updated, adminApp };
  const document = {
    querySelector: (selector) => selector === '[data-view="infra"]' ? nav : null,
    getElementById: (id) => elements[id] ?? null,
    createElement: (tag) => new Node(tag),
  };
  const sb = { functions: { invoke: async (slug, options) => {
    invoked++;
    assert.equal(slug, 'lacrose-admin-infra-monitor');
    assert.equal(options.method, 'GET');
    return resolver();
  }}};
  runInNewContext(source, { document, sb, Intl, Date, Number, String, Array, console });
  return { nav, refresh, cards, updated, adminApp, get invoked() { return invoked; } };
}
function flattened(node) {
  return [node.textContent, ...(node.children || []).flatMap(flattened)].join('|');
}
test('a interface preserva navegação e não toca dados sem interação/autenticação', async () => {
  const app = mount(() => { throw new Error('não deve chamar'); });
  assert.equal(app.invoked, 0);
  app.adminApp.hidden = true;
  await app.nav.click();
  assert.equal(app.invoked, 0);
  assert.match(app.updated.textContent, /não carregadas/i);
});
test('renderiza métricas disponíveis e diferencia cota de tamanho GitHub', async () => {
  const app = mount(() => ({data: {
    sampled_at: '2026-10-28T00:00:00.000Z',
    site_supabase: { status: 'ok', database_bytes: 419430400, storage_objects_bytes: 524288 },
    github: [{ name: 'igorlacrose/lacrosetecnologia', status: 'ok', size_bytes: 6000000 }],
  }}));
  await app.nav.click();
  assert.equal(app.invoked, 1);
  assert.equal(app.cards.children.length, 5);
  const text = flattened(app.cards);
  assert.match(text, /400 MiB/);
  assert.match(text, /Consumo elevado/);
  assert.match(text, /cota de espaço disponível/);
  assert.match(text, /Não conectado/);
});
test('falha da função não reutiliza números anteriores nem inventa dados', async () => {
  let valid = true;
  const app = mount(() => valid
    ? ({data:{sampled_at:'2026-10-28T00:00:00Z',site_supabase:{status:'ok',database_bytes:2000000,storage_objects_bytes:0},github:[]}})
    : ({error:new Error('offline'),data:null}));
  await app.nav.click();
  assert.match(flattened(app.cards), /1,91 MiB/);
  valid = false;
  await app.refresh.click();
  assert.doesNotMatch(flattened(app.cards), /1,91 MiB/);
  assert.match(flattened(app.cards), /Indisponível/);
  assert.equal(app.refresh.disabled, false);
});
test('nomes externos não geram elementos HTML ou injeção', async () => {
  const app = mount(() => ({data: {
    sampled_at:'2026-10-28T00:00:00Z',site_supabase:{status:'unavailable'},
    github:[{name:'<img onerror=alert(1)>',status:'ok',size_bytes:1000}]
  }}));
  await app.nav.click();
  assert.equal(app.cards.children.length, 4);
  assert.doesNotMatch(source, /innerHTML|eval\(|new Function\(/);
  assert.match(flattened(app.cards), /Indisponível/);
});
test('documentos de UI e backend não embutem segredos nem concedem acesso direto', () => {
  assert.match(html, /id="infra"/);
  assert.match(html, /data-view="infra"/);
  assert.match(app, /infra:\s*'Infraestrutura'/);
  assert.match(edge, /authentication_required/);
  assert.match(edge, /getUser\(token\)/);
  assert.match(edge, /profile\.role/);
  assert.match(edge, /SUPABASE_DB_URL/);
  assert.doesNotMatch(source, /sb_secret_|service_role|ghp_[a-zA-Z0-9]+/);
});
