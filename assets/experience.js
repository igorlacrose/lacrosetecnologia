(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = window.matchMedia('(pointer: coarse)');

  // Responsive navigation; keep focus and ARIA state synchronized.
  const toggle = $('#menuToggle');
  const mobileMenu = $('#mobileMenu');
  const setMenu = (open) => {
    if (!toggle || !mobileMenu) return;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    mobileMenu.classList.toggle('is-open', open);
    mobileMenu.inert = !open;
  };
  toggle?.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
  $$('#mobileMenu a').forEach((link) => link.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setMenu(false); });
  document.addEventListener('click', (event) => {
    if (mobileMenu?.classList.contains('is-open') && !mobileMenu.contains(event.target) && !toggle.contains(event.target)) setMenu(false);
  });

  // Content and diagram change together; usable with pointer and keyboard.
  const capabilities = {
    construir: {
      category: 'DESENVOLVIMENTO DIGITAL',
      title: 'Soluções com a sua lógica.<br>Não com limitações prontas.',
      description: 'Sites de alto nível, sistemas sob medida, plataformas SaaS e experiências digitais desenhadas para o trabalho real da sua empresa.',
      label: 'Conversar sobre desenvolvimento digital',
    },
    automatizar: {
      category: 'AUTOMAÇÃO EMPRESARIAL + IA',
      title: 'Menos tarefas repetidas.<br>Mais inteligência em cada fluxo.',
      description: 'Conectamos informações, regras e ações. Do lead ao follow-up, do documento ao cadastro, com automação responsável e controle humano.',
      label: 'Conversar sobre automação empresarial',
    },
    fortalecer: {
      category: 'REDES, INFRAESTRUTURA & SEGURANÇA',
      title: 'Uma operação sólida.<br>Pronta para o que vem depois.',
      description: 'Infraestrutura de redes, segurança, segmentação, conectividade e continuidade: a base técnica para uma empresa crescer com confiança.',
      label: 'Conversar sobre redes e segurança',
    },
  };
  const tabs = $$('.capability-tab');
  const panel = $('#panel-capability');
  const activateTab = (mode, focus = false) => {
    if (!capabilities[mode]) return;
    const item = capabilities[mode];
    tabs.forEach((tab) => {
      const selected = tab.dataset.mode === mode;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });
    $('#blueprint').dataset.mode = mode;
    $('#capCategory').textContent = item.category;
    $('#capTitle').innerHTML = item.title;
    $('#capDescription').textContent = item.description;
    $('#capLink').setAttribute('aria-label', item.label);
    panel.setAttribute('aria-labelledby', `tab-${mode}`);
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.mode));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const newIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
      activateTab(tabs[newIndex].dataset.mode, true);
    });
  });

  // Scroll reveals are progressive enhancement: content remains visible without JS.
  const revealEls = $$('[data-reveal]');
  if ('IntersectionObserver' in window && !reducedMotion.matches) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting) return;
        target.classList.add('is-visible');
        observer.unobserve(target);
      });
    }, { rootMargin: '0px 0px -30px 0px', threshold: 0.06 });
    revealEls.forEach((el) => observer.observe(el));
  } else revealEls.forEach((el) => el.classList.add('is-visible'));

  // Custom 3D projection, drawn in a single 2D canvas. No WebGL, libraries or assets.
  const canvas = $('#orbCanvas');
  const stage = $('#orbStage');
  if (!canvas || !stage) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;
  let w = 480, h = 480, dpr = 1, visible = true, running = true, last = 0, tick = 0;
  let targetX = 0, targetY = 0, pointerX = 0, pointerY = 0;
  const twopi = Math.PI * 2;
  const stars = Array.from({ length: 75 }, (_, i) => {
    const a = (i * 2.399963229728653) % twopi;
    const r = 0.2 + (i * 17 % 73) / 91;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, seed: i * 0.618 };
  });
  const resize = () => {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    w = rect.width; h = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reducedMotion.matches) render(performance.now());
  };

  const intersection = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
    if (visible && running && !reducedMotion.matches) requestAnimationFrame(frame);
  }, { threshold: 0.01 });
  intersection.observe(stage);
  const inViewPointer = (event) => {
    if (coarse.matches) return;
    const r = stage.getBoundingClientRect();
    targetX = Math.max(-1, Math.min(1, (event.clientX - (r.left + r.width / 2)) / (r.width / 2)));
    targetY = Math.max(-1, Math.min(1, (event.clientY - (r.top + r.height / 2)) / (r.height / 2)));
  };
  stage.addEventListener('pointermove', inViewPointer, { passive: true });
  stage.addEventListener('pointerleave', () => { targetX = 0; targetY = 0; });
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running && visible && !reducedMotion.matches) requestAnimationFrame(frame);
  });
  const halo = $('#pointerHalo');
  if (halo && !coarse.matches && !reducedMotion.matches) {
    window.addEventListener('pointermove', (e) => {
      halo.style.left = `${e.clientX}px`; halo.style.top = `${e.clientY}px`; halo.style.opacity = '.8';
    }, { passive: true });
  }

  const rotate = (x,y,z,ay,ax,az) => {
    const cy = Math.cos(ay),sy = Math.sin(ay),cx = Math.cos(ax),sx = Math.sin(ax),cz = Math.cos(az),sz = Math.sin(az);
    let X = x*cy + z*sy, Z = -x*sy + z*cy;
    let Y = y*cx - Z*sx; Z = y*sx + Z*cx;
    return [X*cz - Y*sz, X*sz + Y*cz, Z];
  };
  const project = (x,y,z,angle,ax,az,radius) => {
    const [X,Y,Z] = rotate(x,y,z,angle,ax,az);
    const foreshorten = 3.6/(3.6-Z*.35);
    return [w/2 + X * radius * foreshorten, h/2 + Y * radius * foreshorten, Z];
  };
  const render = (time) => {
    ctx.clearRect(0,0,w,h);
    const m = Math.min(w,h);
    const r = m*.33;
    pointerX += (targetX-pointerX) * .055;
    pointerY += (targetY-pointerY) * .055;
    const turn = reducedMotion.matches ? .35 : time*.000145;
    const ax = -.22 + pointerY*.23;
    const az = -.18 + pointerX*.16;
    const angle = turn + pointerX*.28;
    // Background central aura and reticle.
    const halo = ctx.createRadialGradient(w/2,h/2,m*.08,w/2,h/2,m*.48);
    halo.addColorStop(0,'rgba(51,118,255,.13)'); halo.addColorStop(.6,'rgba(31,81,236,.055)'); halo.addColorStop(1,'rgba(3,11,23,0)');
    ctx.fillStyle = halo; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle='rgba(90,166,245,.20)';ctx.lineWidth=.7;
    ctx.beginPath();ctx.arc(w/2,h/2,r*1.19,0,twopi);ctx.stroke();
    // Interlaced latitude filaments, with actual depth-driven illumination.
    for (let lat=1;lat<=16;lat++) {
      const phi = -Math.PI/2 + lat*Math.PI/17;
      let prev=null;
      for (let k=0;k<=170;k++) {
        const theta = k/170*twopi;
        const ripple = 1+.032*Math.sin(theta*5 + phi*6 + turn*7);
        const xyz=[Math.cos(phi)*Math.cos(theta)*ripple, Math.sin(phi)*ripple, Math.cos(phi)*Math.sin(theta)*ripple];
        const v = project(...xyz, angle, ax, az, r);
        if (prev) {
          const deep=(v[2]+prev[2])/2;
          ctx.beginPath();ctx.moveTo(prev[0],prev[1]);ctx.lineTo(v[0],v[1]);
          ctx.lineWidth=deep>0 ? 1.15 : .46;
          ctx.strokeStyle=deep>0?`rgba(114,225,255,${.26+deep*.37})`:`rgba(37,88,197,${.10+(.8+deep)*.07})`;
          ctx.stroke();
        }
        prev=v;
      }
    }
    // Vertical meridians, slightly offset for a luminous woven volume.
    for (let lon=0;lon<27;lon++) {
      const t = lon/27*twopi;
      let prev = null;
      for (let k=0;k<=84;k++) {
        const phi=-Math.PI/2 + k/84*Math.PI;
        const v=project(Math.cos(phi)*Math.cos(t),Math.sin(phi),Math.cos(phi)*Math.sin(t),angle,ax,az,r);
        if(prev){const deep=(v[2]+prev[2])/2;ctx.beginPath();ctx.moveTo(prev[0],prev[1]);ctx.lineTo(v[0],v[1]);ctx.lineWidth=deep>0?.83:.42;ctx.strokeStyle=deep>0?`rgba(65,138,255,${.21+deep*.2})`:'rgba(48,90,155,.08)';ctx.stroke()}
        prev=v;
      }
    }
    // Two anomalous flowing ribbons are the visual signature of this studio concept.
    for(let ribbon=0;ribbon<2;ribbon++){
      const phase=ribbon*Math.PI;
      ctx.save();ctx.shadowBlur=12;ctx.shadowColor=ribbon?'#4a8aff':'#82faff';
      let prev=null;
      for(let i=0;i<=195;i++){
        const t=i/195*twopi*2.5;
        const phi=Math.sin(t*1.15+phase+turn*2)*.53;
        const theta=t+phase+turn*.9;
        const radiusScale=1.015+.026*Math.sin(t*5+phase+turn*3);
        const v=project(Math.cos(phi)*Math.cos(theta)*radiusScale,Math.sin(phi)*radiusScale,Math.cos(phi)*Math.sin(theta)*radiusScale,angle,ax,az,r);
        if(prev){ctx.beginPath();ctx.moveTo(prev[0],prev[1]);ctx.lineTo(v[0],v[1]);ctx.strokeStyle=ribbon?'rgba(65,119,255,.48)':'rgba(139,246,255,.73)';ctx.lineWidth=1.8;ctx.stroke()}
        prev=v;
      }
      ctx.restore();
    }
    // Spark points have deterministic positions to avoid frame flicker.
    stars.forEach((s,i)=>{
      const theta=i*2.39996+angle*.47, phi=Math.asin((i*2/75)-1);
      const v=project(Math.cos(phi)*Math.cos(theta),Math.sin(phi),Math.cos(phi)*Math.sin(theta),angle,ax,az,r);
      if(v[2]<-.25)return;
      const glow=.5+.5*Math.sin(time*.0011+s.seed*7);
      ctx.beginPath();ctx.arc(v[0],v[1],(i%12===0?2:0.95)+glow*.4,0,twopi);
      ctx.fillStyle=`rgba(188,248,255,${.28+glow*.6})`;
      ctx.shadowBlur= i%12===0 ? 16 : 3;ctx.shadowColor='#7acaff';ctx.fill();
    });ctx.shadowBlur=0;
    // Center focal pulse.
    const cr=4+Math.sin(time*.0018)*1.3;
    ctx.beginPath();ctx.arc(w/2,h/2,cr,0,twopi);ctx.fillStyle='rgba(187,252,255,.88)';ctx.shadowBlur=25;ctx.shadowColor='#6deaff';ctx.fill();ctx.shadowBlur=0;
  };
  const frame = (time) => {
    if (!visible || !running || reducedMotion.matches) return;
    const limit = coarse.matches ? 33.3 : 20;
    if(time-last>=limit){last=time;render(time)}
    requestAnimationFrame(frame);
  };
  const stageResizeObserver = new ResizeObserver(resize);
  stageResizeObserver.observe(stage);
  resize();
  reducedMotion.addEventListener?.('change', () => {
    if (reducedMotion.matches) render(performance.now());
    else if (visible && running) requestAnimationFrame(frame);
  });
  render(0);
  if (!reducedMotion.matches && running) requestAnimationFrame(frame);
})();
