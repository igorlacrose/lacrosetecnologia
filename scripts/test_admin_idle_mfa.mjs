import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../admin/app.js', import.meta.url), 'utf8');
const begin = source.indexOf('function verifyIdle(){');
const end = source.indexOf("document.addEventListener('pointerdown',recordActivity,true);", begin);
assert.ok(begin >= 0 && end > begin, 'funções de controle de sessão não encontradas');
const snippet = source.slice(begin, end);

function harness({ hidden, now, lastActivity }) {
  let expired = 0, prevented = 0, stopped = 0, scheduled = 0;
  const ctx = {
    user: { id: 'admin-test' },
    endingForIdle: false,
    lastInteractionAt: lastActivity,
    ADMIN_IDLE_MS: 24 * 60 * 60 * 1000,
    idleTimer: null,
    Date: { now: () => now },
    el: id => {
      assert.equal(id, 'app');
      return { hidden };
    },
    clearTimeout: () => {},
    setTimeout: () => { scheduled += 1; return 1; },
    expireIdleSession: () => { expired += 1; }
  };
  vm.createContext(ctx);
  vm.runInContext(snippet + '\nthis.handlers={verifyIdle,recordActivity};', ctx, { timeout: 2000 });
  return {
    ctx,
    check: () => ctx.handlers.verifyIdle(),
    activity: () => ctx.handlers.recordActivity({
      preventDefault: () => { prevented += 1; },
      stopImmediatePropagation: () => { stopped += 1; }
    }),
    report: () => ({ expired, prevented, stopped, scheduled })
  };
}

test('MFA não encerra a sessão antes da entrada no painel', () => {
  const x = harness({ hidden: true, now: Date.now(), lastActivity: 0 });
  x.activity();
  x.check();
  assert.equal(x.report().expired, 0);
  assert.equal(x.report().prevented, 0);
  assert.equal(x.report().scheduled, 0);
});

test('painel ativo registra interação antes do limite', () => {
  const x = harness({ hidden: false, now: 5000, lastActivity: 1000 });
  x.activity();
  assert.equal(x.report().expired, 0);
  assert.equal(x.report().scheduled, 1);
  assert.equal(x.ctx.lastInteractionAt, 5000);
});

test('painel bloqueia interação após 24h de inatividade', () => {
  const x = harness({ hidden: false, now: 24 * 60 * 60 * 1000 + 1000, lastActivity: 0 });
  x.activity();
  assert.equal(x.report().expired, 1);
  assert.equal(x.report().prevented, 1);
  assert.equal(x.report().stopped, 1);
});

test('não persiste token do administrador em storage', () => {
  assert.match(source, /persistSession:false/);
  assert.doesNotMatch(source, /persistSession:true|storage:window\.sessionStorage/);
});
