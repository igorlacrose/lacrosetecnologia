'use strict';
/* Os dados são fornecidos exclusivamente pela Edge Function autenticada. */
(() => {
  const trigger = document.querySelector('[data-view="infra"]');
  const refresh = document.getElementById('infraRefresh');
  const cards = document.getElementById('infraCards');
  const updated = document.getElementById('infraUpdated');
  if (!trigger || !refresh || !cards || !updated) return;

  const limitDb = 500 * 1024 * 1024; // referência Free; não é cota consultada na API
  const limitStorage = 1024 * 1024 * 1024;
  const displaySize = (n) => {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 'Indisponível';
    if (n < 1024) return n.toLocaleString('pt-BR') + ' B';
    if (n < 1024 ** 2) return (n / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' KiB';
    return (n / (1024 ** 2)).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' MiB';
  };
  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }
  function card(title, value, description, usage, limit) {
    const node = element('article', 'infra-card');
    node.appendChild(element('h3', '', title));
    node.appendChild(element('strong', 'infra-value', value));
    node.appendChild(element('small', 'infra-detail', description));

    if (Number.isFinite(usage) && Number.isFinite(limit) && limit > 0) {
      const pct = Math.max(0, usage / limit * 100);
      const level = pct >= 95 ? 'danger' : pct >= 85 ? 'warning' : '';
      const message = pct >= 95 ? 'Crítico' : pct >= 85 ? 'Atenção' : pct >= 70 ? 'Consumo elevado' : 'Dentro da referência';
      const bar = element('div', 'infra-bar');
      const fill = element('i', level);
      fill.style.width = Math.min(100, pct) + '%';
      fill.setAttribute('aria-hidden', 'true');
      bar.appendChild(fill);
      node.appendChild(bar);
      node.appendChild(element('span', 'infra-state ' + level, message + ' · ' + pct.toFixed(1) + '% da referência'));
    }
    return node;
  }
  function draw(payload) {
    const supa = payload && payload.site_supabase;
    const db = supa?.status === 'ok' ? Number(supa.database_bytes) : NaN;
    const storage = supa?.status === 'ok' ? Number(supa.storage_objects_bytes) : NaN;
    const nodes = [
      card('Supabase · Site', displaySize(db), 'Banco PostgreSQL · referência Free: 500 MiB', db, limitDb),
      card('Supabase · Arquivos', displaySize(storage), 'Storage da página · referência Free: 1 GiB', storage, limitStorage),
      card('Supabase · LKZ ISP', 'Não conectado', 'Métricas de outro projeto exigem integração autorizada no servidor.'),
    ];
    for (const repo of Array.isArray(payload?.github) ? payload.github : []) {
      if (!/^igorlacrose\/[a-z0-9._-]+$/i.test(repo?.name || '')) continue;
      nodes.push(card('GitHub · ' + repo.name.split('/')[1],
        repo.status === 'ok' ? displaySize(Number(repo.size_bytes)) : 'Indisponível',
        repo.status === 'ok'
          ? 'Tamanho aproximado do repositório; não é cota de espaço disponível.'
          : 'Repositório privado ou consulta indisponível; exige acesso autorizado.'));
    }
    nodes.push(card('GitHub · LFS / Actions', 'Não conectado', 'Cotas e consumo da conta precisam de integração de cobrança autenticada.'));
    cards.replaceChildren(...nodes);
    const stamp = new Date(payload?.sampled_at || '');
    updated.textContent = Number.isFinite(stamp.getTime())
      ? 'Última leitura: ' + stamp.toLocaleString('pt-BR')
      : 'Leitura concluída; data não disponível.';
  }
  async function load() {
    if (refresh.disabled || document.getElementById('adminApp')?.hidden) return;
    refresh.disabled = true;
    refresh.textContent = 'Consultando…';
    updated.textContent = 'Consultando fontes autorizadas…';
    try {
      const { data, error } = await sb.functions.invoke('lacrose-admin-infra-monitor', { method: 'GET' });
      if (error || !data || !Array.isArray(data.github)) throw new Error('Consulta indisponível');
      draw(data);
    } catch {
      updated.textContent = 'Não foi possível consultar os recursos. Confira a sessão e tente novamente.';
      cards.replaceChildren(card('Monitoramento', 'Indisponível', 'Nenhum número foi estimado ou preenchido manualmente.'));
    } finally {
      refresh.disabled = false;
      refresh.textContent = 'Atualizar métricas ↻';
    }
  }
  trigger.addEventListener('click', load);
  refresh.addEventListener('click', load);
})();
