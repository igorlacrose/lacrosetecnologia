'use strict';
(() => {
  if (window.parent === window) {
    location.replace('./');
    return;
  }
  const isAdmin = document.body.dataset.product === 'adm';
  const duration = 5 * 60 * 1000;
  const intro = document.getElementById('intro');
  const demo = document.getElementById('demo');
  const expired = document.getElementById('expired');
  const countdown = document.getElementById('countdown');
  const navigation = document.getElementById('navigation');
  const view = document.getElementById('view');
  let current = 'overview';
  let state = null;
  let interval = null;
  let memoryOnly = false;
  let previous = null;
  let loaded = false;

  function save() {
    parent.postMessage({channel:'lacrose-demo-v1',type:'save',state}, location.origin);
  }
  function clear() {
    parent.postMessage({channel:'lacrose-demo-v1',type:'clear'}, location.origin);
  }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function seed() {
    return {
      startedAt: Date.now(),
      clients: ['Café Horizonte', 'Estúdio Aurora'],
      tasks: ['Enviar proposta ao Café Horizonte', 'Retornar ao Estúdio Aurora'],
      approvals: ['Revisar proposta comercial'],
      opportunities: ['Café Horizonte · Proposta', 'Estúdio Aurora · Diagnóstico']
    };
  }
  function tick() {
    if (!state) return;
    const remaining = Math.max(0, state.startedAt + duration - Date.now());
    if (!remaining) {
      clearInterval(interval);
      interval = null;
      clear();
      state = null;
      demo.hidden = true;
      intro.hidden = true;
      expired.hidden = false;
      view.replaceChildren();
      countdown.textContent = '';
      return;
    }
    const seconds = Math.ceil(remaining / 1000);
    countdown.textContent = 'Tempo restante ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }
  function start(fresh) {
    const saved = fresh ? null : previous;
    state = saved && Number.isFinite(saved.startedAt) && saved.startedAt <= Date.now()
      && Array.isArray(saved.clients) && Array.isArray(saved.tasks) && Array.isArray(saved.approvals)
      && Array.isArray(saved.opportunities) ? saved : seed();
    if (state.startedAt + duration <= Date.now()) { tick(); return; }
    save();
    intro.hidden = true;
    expired.hidden = true;
    demo.hidden = false;
    if (memoryOnly) document.querySelector('.banner').textContent += ' O armazenamento local está indisponível e o teste será mantido somente nesta página.';
    clearInterval(interval);
    interval = setInterval(tick, 1000);
    tick();
    render();
  }
  function button(text, action) {
    const node = element('button', text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }
  function menu() {
    const options = isAdmin
      ? [['overview', 'OCA · Hoje'], ['clients', 'Clientes'], ['tasks', 'Demandas'], ['approvals', 'Aprovações'], ['systems', 'Sistemas']]
      : [['overview', 'Visão geral'], ['clients', 'Clientes'], ['opportunities', 'Oportunidades'], ['tasks', 'Tarefas']];
    navigation.replaceChildren(...options.map(([id, title]) => {
      const item = button(title, () => { current = id; render(); });
      if (id === current) item.setAttribute('aria-current', 'page');
      return item;
    }));
  }
  function addForm(panel, collection, placeholder) {
    const form = element('form');
    const input = element('input');
    input.maxLength = 100;
    input.required = true;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);
    const submit = element('button', 'Adicionar');
    submit.type = 'submit';
    form.append(input, submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!state || Date.now() >= state.startedAt + duration) { tick(); return; }
      const value = input.value.trim();
      if (!value || value.length > 100 || state[collection].length >= 30) return;
      state[collection].push(value);
      save();
      render();
    });
    panel.append(form);
  }
  function list(title, collection, allowAdd, allowComplete) {
    const panel = element('section', undefined, 'panel');
    panel.append(element('h2', title));
    if (allowAdd) addForm(panel, collection, collection === 'clients' ? 'Nome fictício do cliente' : 'Descrição fictícia');
    if (!state[collection].length) panel.append(element('p', 'Nenhum registro nesta lista.'));
    state[collection].forEach((item, index) => {
      const row = element('div', undefined, 'row');
      row.append(element('span', item));
      if (allowComplete) row.append(button('Concluir', () => {
        if (!state || Date.now() >= state.startedAt + duration) { tick(); return; }
        state[collection].splice(index, 1);
        save();
        render();
      }));
      panel.append(row);
    });
    view.append(panel);
  }
  function render() {
    if (!state) return;
    tick();
    if (!state) return;
    menu();
    view.replaceChildren();
    if (current === 'overview') {
      const metrics = element('div', undefined, 'metrics');
      const values = [['Clientes', state.clients.length], [isAdmin ? 'Demandas' : 'Tarefas', state.tasks.length],
        [isAdmin ? 'Aprovações' : 'Oportunidades', isAdmin ? state.approvals.length : state.opportunities.length]];
      values.forEach(([title, value]) => {
        const card = element('section', undefined, 'panel metric');
        card.append(element('strong', String(value)), element('span', title));
        metrics.append(card);
      });
      view.append(metrics);
      list(isAdmin ? 'Prioridades do dia' : 'Próximas tarefas', 'tasks', false, false);
    } else if (current === 'clients') list('Clientes', 'clients', true, false);
    else if (current === 'tasks') list(isAdmin ? 'Demandas' : 'Tarefas', 'tasks', true, true);
    else if (current === 'opportunities') list('Oportunidades', 'opportunities', true, false);
    else if (current === 'approvals') list('Aprovações', 'approvals', false, true);
    else if (current === 'systems') {
      const panel = element('section', undefined, 'panel');
      panel.append(element('h2', 'Sistemas'));
      ['LCRM', 'LISP'].forEach(name => panel.append(element('div', name, 'row')));
      view.append(panel);
    }
  }
  document.getElementById('start').addEventListener('click', () => start(true));
  document.getElementById('restart').addEventListener('click', () => start(true));
  const askParent = () => parent.postMessage({channel:'lacrose-demo-v1',type:'load'}, location.origin);
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== 'lacrose-demo-v1' || event.data.type !== 'loaded' || loaded) return;
    loaded = true;
    clearInterval(handshake);
    memoryOnly = !event.data.available;
    previous = event.data.state;
    if (previous && !state) start(false);
  });
  const handshake = setInterval(askParent, 1000);
  askParent();
})();
