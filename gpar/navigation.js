/* Navegação isolada do módulo GPar. Sem acesso ou alterações a dados financeiros. */
(() => {
  'use strict';

  const sidebar = document.getElementById('gpar-sidebar');
  const toggleButton = document.getElementById('mobile-menu-toggle');
  const closeButton = document.getElementById('mobile-menu-close');
  const scrim = document.getElementById('sidebar-scrim');
  if (!sidebar || !toggleButton || !closeButton || !scrim) return;

  const mobile = window.matchMedia('(max-width:920px)');
  let isOpen = false;

  function renderNavigation({ focus = false } = {}) {
    const visible = mobile.matches && isOpen;
    document.body.classList.toggle('sidebar-open', visible);
    sidebar.inert = mobile.matches && !visible;
    scrim.hidden = !visible;
    toggleButton.setAttribute('aria-expanded', String(visible));
    toggleButton.setAttribute('aria-label', visible ? 'Fechar menu principal' : 'Abrir menu principal');

    if (focus) {
      if (visible) closeButton.focus();
      else if (mobile.matches) toggleButton.focus();
    }
  }

  function closeNavigation(restoreFocus = false) {
    isOpen = false;
    renderNavigation({ focus: restoreFocus });
  }

  toggleButton.addEventListener('click', () => {
    isOpen = !isOpen;
    renderNavigation({ focus: isOpen });
  });
  closeButton.addEventListener('click', () => closeNavigation(true));
  scrim.addEventListener('click', () => closeNavigation(true));

  sidebar.addEventListener('click', (event) => {
    if (mobile.matches && event.target instanceof Element &&
        event.target.closest('a.nav,button.nav')) closeNavigation(false);
  });

  document.addEventListener('keydown', (event) => {
    if (!mobile.matches || !isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeNavigation(true);
      return;
    }
    if (event.key !== 'Tab') return;

    const focusables = Array.from(sidebar.querySelectorAll('a[href],button:not([disabled])'))
      .filter(node => node.getClientRects().length > 0);
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  mobile.addEventListener('change', () => {
    isOpen = false;
    renderNavigation();
  });
  window.addEventListener('pageshow', () => {
    isOpen = false;
    renderNavigation();
  });
  renderNavigation();
})();
