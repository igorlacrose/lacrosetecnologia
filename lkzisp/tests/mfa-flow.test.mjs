import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const js=readFileSync(new URL('../portal.js',import.meta.url),'utf8');
const tokenFor=aal=>'header.'+Buffer.from(JSON.stringify({aal})).toString('base64url')+'.signature';
function harness(){
  const elements=new Map(),calls=[];
  function elem(id){
    if(!elements.has(id))elements.set(id,{
      id,hidden:false,disabled:false,value:'',textContent:'',listeners:new Map(),
      addEventListener(event,fn){this.listeners.set(event,fn)},
      replaceChildren(){this.children=[]},appendChild(node){(this.children??=[]).push(node)},
    });
    return elements.get(id);
  }
  const document={
    getElementById:elem,
    createElement:id=>elem('dynamic-'+Math.random()),
    querySelectorAll:()=>[...elements.values()].filter(x=>x.id!=='message'),
  };
  for(const id of ['loginForm','signup','recover','enroll','mfaForm','activate','reload','signout','resetForm','message','password','code','email','mfa','authorized','loginForm','resetForm','secret','secretBox','status','memberships','newPassword'])elem(id);
  const fetch=async(url,opts)=>{
    const path=new URL(url).pathname;
    calls.push([path,opts.method||'GET']);
    let body={};
    if(path==='/auth/v1/token')body={access_token:tokenFor('aal1'),refresh_token:'refresh',expires_in:3600,user:{email:'lacrose.igor@gmail.com'}};
    else if(path==='/auth/v1/user')body={email:'lacrose.igor@gmail.com',factors:[{id:'verified-TOTP',factor_type:'totp',status:'verified'}]};
    else if(path==='/auth/v1/factors/verified-TOTP/challenge')body={id:'challenge-ok'};
    else if(path==='/auth/v1/factors/verified-TOTP/verify')body={access_token:tokenFor('aal2'),refresh_token:'refresh-2',expires_in:3600,user:{email:'lacrose.igor@gmail.com'}};
    else if(path==='/rest/v1/lkz_isp_memberships')body=[{tenant_id:'tenant-1',role:'master',sector_id:null}];
    else throw Error('Unmocked network call: '+path);
    return {ok:true,status:200,json:async()=>body};
  };
  const context={document,fetch,location:{hash:'',pathname:'/lkzisp/',search:''},
    history:{replaceState(){}},URLSearchParams,AbortSignal,Date,Buffer,JSON,atob,encodeURIComponent,
    setTimeout,console};
  vm.runInNewContext(js,context);
  const submit=async(id)=>{elem(id).listeners.get('submit')({preventDefault(){}});await until(()=>elem('message').textContent.includes('autenticador')||elem('message').textContent.includes('confirmada')||elem('message').textContent.includes('Falha'));};
  const click=async id=>{elem(id).listeners.get('click')();await new Promise(resolve=>setTimeout(resolve,30))};
  return {elem,calls,submit,click};
}
async function until(predicate){
 for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10))}
 throw Error('Expected UI state not reached');
}
test('TOTP ja verificado e recuperado do usuario, sem GET /factors nem segunda inscricao',async()=>{
  const ui=harness();ui.elem('email').value='lacrose.igor@gmail.com';ui.elem('password').value='safe-mock';
  await ui.submit('loginForm');
  assert.equal(ui.elem('enroll').hidden,true,'Nao exibir botao de criar outro TOTP');
  assert.match(ui.elem('message').textContent,/ja esta configurado/);
  assert.equal(ui.calls.filter(([p])=>p==='/auth/v1/factors').length,0);
  assert.ok(ui.calls.some(([p,m])=>p==='/auth/v1/user'&&m==='GET'));
  await ui.click('enroll');
  assert.equal(ui.calls.filter(([p,m])=>p==='/auth/v1/factors'&&m==='POST').length,0);
  ui.elem('code').value='123456';
  ui.elem('mfaForm').listeners.get('submit')({preventDefault(){}});
  await until(()=>ui.elem('status').textContent==='MFA confirmado');
  assert.ok(ui.calls.some(([p])=>p.endsWith('/challenge')));
  assert.ok(ui.calls.some(([p])=>p.endsWith('/verify')));
  assert.equal(ui.elem('authorized').hidden,false);
});
