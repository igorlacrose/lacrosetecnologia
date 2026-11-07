'use strict';
const frame=document.getElementById('demo');
const timer=document.getElementById('remaining');
const finished=document.getElementById('finished');
const dataKey='lacrose.demo.erp.state.v1';
const startKey='lacrose.demo.erp.started.v1';
const duration=5*60*1000;
let started=Number(sessionStorage.getItem(startKey));
if(!Number.isFinite(started)||started<=0){started=Date.now();sessionStorage.setItem(startKey,String(started))}
let ended=false;
function expire(){
  if(ended)return;
  ended=true;
  sessionStorage.removeItem(dataKey);
  frame.remove();
  finished.hidden=false;
  timer.textContent='Tempo encerrado';
}
function tick(){
  const remaining=Math.max(0,duration-(Date.now()-started));
  if(!remaining){expire();return}
  const seconds=Math.ceil(remaining/1000);
  timer.textContent='Tempo restante: '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
}
frame.addEventListener('load',()=>{
  tick();
  if(!ended)frame.contentWindow.postMessage({type:'lacrose-demo-init',data:sessionStorage.getItem(dataKey)},'*');
});
window.addEventListener('message',event=>{
  if(ended||Date.now()-started>=duration){tick();return}
  if(event.source!==frame.contentWindow||event.origin!=='null')return;
  const message=event.data;
  if(!message||message.type!=='lacrose-demo-save'||typeof message.data!=='string'||message.data.length>2000000)return;
  try{
    const state=JSON.parse(message.data);
    if(!state||typeof state!=='object'||Array.isArray(state))return;
    sessionStorage.setItem(dataKey,message.data);
  }catch{}
});
document.getElementById('restart').addEventListener('click',()=>{
  sessionStorage.removeItem(dataKey);
  sessionStorage.removeItem(startKey);
  location.reload();
});
window.addEventListener('focus',tick);
document.addEventListener('visibilitychange',tick);
tick();
setInterval(tick,1000);
