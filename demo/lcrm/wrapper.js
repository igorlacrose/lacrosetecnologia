'use strict';
(() => {
  const frame = document.getElementById('preview');
  const key = document.body.dataset.product === 'adm' ? 'lacrose-demo-adm-v1' : 'lacrose-demo-lcrm-v1';
  function valid(data) {
    return data && typeof data === 'object'
      && Number.isFinite(data.startedAt) && data.startedAt <= Date.now()
      && ['clients','tasks','approvals','opportunities'].every(name => Array.isArray(data[name])
        && data[name].length <= 30 && data[name].every(value => typeof value === 'string' && value.length <= 100));
  }
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.origin !== 'null' || !event.data
      || event.data.channel !== 'lacrose-demo-v1') return;
    if (event.data.type === 'load') {
      let state = null;
      let available = true;
      try {
        const raw = localStorage.getItem(key);
        if (raw && raw.length <= 16000) state = JSON.parse(raw);
        if (state && !valid(state)) state = null;
      } catch { available = false; }
      frame.contentWindow.postMessage({ channel:'lacrose-demo-v1', type:'loaded', state, available }, '*');
    } else if (event.data.type === 'save' && valid(event.data.state)) {
      try { localStorage.setItem(key, JSON.stringify(event.data.state)); } catch {}
    } else if (event.data.type === 'clear') {
      try { localStorage.removeItem(key); } catch {}
    }
  });
})();
