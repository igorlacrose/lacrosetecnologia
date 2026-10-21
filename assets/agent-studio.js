/* Lacrose Agent Studio: apenas microinterações visuais.
 * Não modifica app.js, estado comercial, endpoint nem payloads do lead.
 */
(()=>{
  'use strict';
  const root=document.getElementById('agente');
  if(!root || !root.classList.contains('agent-studio')) return;
  const avatar=document.getElementById('agentStudioMascot');
  const head=avatar?.querySelector('.mascot-head');
  const note=root.querySelector('.agent-studio-reply-note');
  const messages=document.getElementById('agentMessages');
  const fields=document.getElementById('leadFields');
  const start=document.getElementById('agentStudioStart');
  const input=document.getElementById('agentInput');
  const quick=document.getElementById('quickStarts');
  const form=document.getElementById('agentForm');
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
  let raf=0;
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const eye=(x,y)=>{
    if(!avatar) return;
    avatar.style.setProperty('--eye-x',`${x.toFixed(1)}px`);
    avatar.style.setProperty('--eye-y',`${y.toFixed(1)}px`);
    avatar.style.setProperty('--bot-x',`${(-y*1.1).toFixed(1)}deg`);
    avatar.style.setProperty('--bot-y',`${(x*1.25).toFixed(1)}deg`);
  };
  const pointerMove=e=>{
    if(reduce.matches || !head) return;
    if(raf) return;
    const {clientX,clientY}=e;
    raf=requestAnimationFrame(()=>{
      raf=0;
      const box=avatar.getBoundingClientRect();
      const cx=box.left+box.width/2;
      const cy=box.top+box.height/2;
      const dx=clamp((clientX-cx)/220,-1,1);
      const dy=clamp((clientY-cy)/200,-1,1);
      eye(dx*3.7,dy*3.3);
    });
  };
  if(avatar){
    root.addEventListener('pointermove',pointerMove,{passive:true});
    root.addEventListener('pointerleave',()=>{
      if(raf) cancelAnimationFrame(raf);
      raf=0;eye(0,0);
    });
  }
  const flash=el=>{
    if(!el || reduce.matches) return;
    el.classList.remove('agent-studio-newinfo');
    void el.offsetWidth;
    el.classList.add('agent-studio-newinfo');
    window.setTimeout(()=>el.classList.remove('agent-studio-newinfo'),1000);
  };
  let lastMessageCount=0;
  if(messages){
    lastMessageCount=messages.children.length;
    new MutationObserver(()=>{
      const count=messages.children.length;
      if(count>lastMessageCount){
        const newest=messages.lastElementChild;
        flash(newest);
      }
      lastMessageCount=count;
      const thinking=!!messages.querySelector('.typing');
      avatar?.classList.toggle('is-thinking',thinking);
    }).observe(messages,{childList:true,subtree:true});
  }
  if(fields){
    fields.querySelectorAll('dd').forEach(node=>{
      new MutationObserver(()=>flash(node.parentElement)).observe(node,{childList:true,characterData:true,subtree:true});
    });
  }
  start?.addEventListener('click',()=>{
    if(quick && getComputedStyle(quick).display!=='none'){
      const first=quick.querySelector('button');
      first?.focus({preventScroll:true});
      first?.scrollIntoView({behavior:reduce.matches?'instant':'smooth',block:'center'});
    }else{
      input?.focus({preventScroll:true});
      input?.scrollIntoView({behavior:reduce.matches?'instant':'smooth',block:'center'});
    }
    flash(form);
  });
  if(note){
    const options=document.getElementById('contextReplies');
    if(options){
      new MutationObserver(()=>{
        const visible=!options.hidden;
        note.hidden=visible;
      }).observe(options,{attributes:true,attributeFilter:['hidden']});
    }
  }
})();
