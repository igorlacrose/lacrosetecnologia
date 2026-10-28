import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const code=readFileSync(new URL('../portal-mfa-v2.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

function jwt(aal='aal1'){
  return ['test',Buffer.from(JSON.stringify({sub:'user1',aal,role:'authenticated'})).toString('base64url'),'signature'].join('.');
}
function setup(factorResponse,opts={}){
  const ids=['loginForm','email','password','signup','recover','message','status',
    'mfa','authorized','resetForm','signout','secret','secretBox','enroll','mfaForm',
    'code','activate','reload','memberships','newPassword'];
  class El {
    constructor(id){this.id=id;this.listeners={};this.hidden=['mfa','authorized','resetForm','secretBox','signout','activate'].includes(id);this.textContent='';this.value='';this.disabled=false;this.children=[];}
    addEventListener(name,fn){this.listeners[name]=fn}
    replaceChildren(...children){this.children=children}
    appendChild(el){this.children.push(el)}
  }
  const elems=Object.fromEntries(ids.map(id=>[id,new El(id)]));
  elems.email.value='lacrose.igor@gmail.com';
  elems.password.value='test-password';
  const paths=[],responses=[];
  const mockFetch=async (url,request={})=>{
    const p=String(url).replace(/^https:\/\/[^/]+/,'');
    paths.push({path:p,method:request.method||'GET'});
    let body={};let status=200;
    if(p.includes('grant_type=password')) body={access_token:jwt('aal1'),refresh_token:'refresh',expires_in:3600,user:{email:'lacrose.igor@gmail.com'}};
    else if(p==='/auth/v1/user'){
      body={id:'user1',email:'lacrose.igor@gmail.com',...(factorResponse===null?{}:{factors:factorResponse})};
    }
    else if(p.endsWith('/challenge'))body={id:'challenge-1'};
    else if(p.endsWith('/verify'))body={access_token:jwt('aal2'),refresh_token:'refresh2',expires_in:3600,user:{email:'lacrose.igor@gmail.com'}};
    else if(p.startsWith('/rest/v1/lkz_isp_memberships'))body=[{tenant_id:'tenant1',role:'master',sector_id:null}];
    else if(p==='/auth/v1/factors'&&request.method==='POST'){
      if(opts.conflict){status=422;body={error_code:'mfa_factor_name_conflict',msg:'duplicate'}}
      else body={id:'new-id',totp:{secret:'NEW-SECRET'}};
    } else throw Error('Unexpected request '+p);
    responses.push({path:p,status});
    return {ok:status===200,status,json:async()=>body};
  };
  const buttons=ids.map(id=>elems[id]);
  runInNewContext(code,{
    document:{
      getElementById:id=>elems[id],
      querySelectorAll:query=>query==='button'?buttons:[],
      createElement:()=>new El('p')
    },
    location:{hash:'',pathname:'/lkzisp/',search:''},
    history:{replaceState:()=>{}},
    URLSearchParams,AbortSignal,TextDecoder,
    fetch:mockFetch,atob,Date,JSON,Error,encodeURIComponent,
    console:{log:()=>{}}
  });
  async function act(id,name='click'){
    assert.ok(elems[id].listeners[name]);
    elems[id].listeners[name]({preventDefault(){}});
    for(let i=0;i<30;i++){
      await new Promise(resolve=>setImmediate(resolve));
      if(!buttons.some(button=>button.disabled))break;
    }
  }
  return {elems,paths,responses,act};
}
test('MFA verificado: mostra desafio, nao oferece nem recria fator',async()=>{
  const h=setup([{id:'existing-id',factor_type:'totp',status:'verified',friendly_name:'LKZ ISP Intelligence'}]);
  await h.act('loginForm','submit');
  assert.equal(h.elems.enroll.hidden,true);
  assert.equal(h.elems.mfa.hidden,false);
  assert.match(h.elems.message.textContent,/Autenticador já cadastrado/);
  await h.act('enroll');
  assert.equal(h.paths.filter(x=>x.path==='/auth/v1/factors'&&x.method==='POST').length,0);
  assert.match(h.elems.message.textContent,/já está ativo/);
  h.elems.code.value='123456';
  await h.act('mfaForm','submit');
  assert.ok(h.paths.some(x=>x.path.endsWith('/existing-id/challenge')));
  assert.ok(h.paths.some(x=>x.path.endsWith('/existing-id/verify')));
  assert.equal(h.elems.authorized.hidden,false);
  assert.equal(h.elems.mfa.hidden,true);
});
test('Primeira configuracao: permite TOTP apenas se resposta autenticada provar lista vazia',async()=>{
  const h=setup([]);
  await h.act('loginForm','submit');
  assert.equal(h.elems.enroll.hidden,false);
  await h.act('enroll');
  assert.equal(h.paths.filter(x=>x.path==='/auth/v1/factors'&&x.method==='POST').length,1);
  assert.equal(h.elems.secret.textContent,'NEW-SECRET');
});
test('Resposta de fatores ausente bloqueia cadastro inseguro',async()=>{
  const h=setup(null);
  await h.act('loginForm','submit');
  assert.match(h.elems.message.textContent,/Não foi possível verificar/);
  await h.act('enroll');
  assert.equal(h.paths.filter(x=>x.path==='/auth/v1/factors'&&x.method==='POST').length,0);
});
test('Conflito 422 mostra instrucoes e nao expõe erro bruto',async()=>{
  const h=setup([],{conflict:true});
  await h.act('loginForm','submit');
  await h.act('enroll');
  assert.match(h.elems.message.textContent,/já foi cadastrado/);
  assert.doesNotMatch(h.elems.message.textContent,/HTTP 422/);
});
test('Portal carrega arquivo novo e sem segredos privados ou persistencia de token',()=>{
  assert.match(html,/src="\.\/portal-mfa-v2\.js"/);
  assert.doesNotMatch(code,/localStorage|sessionStorage|indexedDB|sb_secret_|service_role/i);
  assert.doesNotMatch(code,/innerHTML|document\.write/);
  assert.match(code,/\/auth\/v1\/user/);
  assert.doesNotMatch(code,/api\('\/auth\/v1\/factors'\)/);
});
