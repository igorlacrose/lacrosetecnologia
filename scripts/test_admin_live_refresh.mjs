import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../admin/app.js',import.meta.url),'utf8');
const begin=source.indexOf('function threadStampKey(');
const end=source.indexOf('function startConversationPolling(',begin);
assert.ok(begin>=0&&end>begin,'Sincronização automática não encontrada');
const snippet=source.slice(begin,end);

function harness({remote,selected=false,filterActive=false,visible=true,view='conversations',error=null,count=null,dialogActive=false}={}){
  let requests=0,reloads=0,renders=0,reopens=0;
  const initial=[{id:'t1',last:'2026-11-11T10:00:00Z',folder:'active'}];
  const recent=remote??[{id:'t1',last_message_at:'2026-11-11T10:00:00Z',started_at:'2026-11-11T09:00:00Z'}];
  const root={isConnected:true};
  const filter={value:'',dispatchEvent:()=>{}};
  const pane={querySelector:(selector)=>{
    if(selector==='[data-message-select]:checked')return selected?{}:null;
    if(selector==='[data-folder][aria-pressed="true"]')return {dataset:{folder:'active'}};
    return null;
  }};
  const app={hidden:false};
  const elements={app,chatWorkspace:root,messagePane:pane,threadFilter:filter};
  const ctx={
    user:{id:'test-admin'},endingForIdle:false,currentView:view,conversationPollBusy:false,
    state:{threads:initial,loadMeta:{counts:{conversations:1}}},conversationFocus:'t1',conversationFolder:'active',
    activeDialogCancel:dialogActive?()=>{}:null,
    document:{visibilityState:visible?'visible':'hidden',activeElement:filterActive?filter:null},
    el:id=>elements[id]||null,
    sb:{from:table=>{
      assert.equal(table,'conversations');
      return {select:fields=>{
        assert.equal(fields,'id,last_message_at,started_at');
        return {order:(field)=>({
          limit:async()=>{requests++;return {data:recent,error,count};}
        })};
      }};
    }},
    loadCommercial:async()=>{
      reloads++;
      ctx.state.threads=recent.map(r=>({id:r.id,last:r.last_message_at||r.started_at,folder:'active'}));
    },
    conversations:folder=>{assert.equal(folder,'active');renders++;},
    openThread:async(id,folder)=>{assert.equal(id,'t1');assert.equal(folder,'active');reopens++;},
    Event:class{constructor(type){this.type=type;}},
    console:{warn:()=>{}}
  };
  vm.createContext(ctx);
  vm.runInContext(snippet+'\nthis.handlers={refreshLiveConversations,threadStampKey};',ctx,{timeout:2000});
  return {
    run:()=>ctx.handlers.refreshLiveConversations(),
    report:()=>({requests,reloads,renders,reopens,busy:ctx.conversationPollBusy}),
    setSelected:value=>{selected=value;}
  };
}

test('sem mudança no atendimento não redesenha a conversa',async()=>{
  const x=harness();
  await x.run();
  assert.deepEqual(x.report(),{requests:1,reloads:0,renders:0,reopens:0,busy:false});
});

test('nova mensagem atualiza a lista e a conversa aberta',async()=>{
  const x=harness({remote:[{id:'t1',last_message_at:'2026-11-11T10:01:00Z',started_at:'2026-11-11T09:00:00Z'}]});
  await x.run();
  assert.deepEqual(x.report(),{requests:1,reloads:1,renders:1,reopens:1,busy:false});
});

test('não interrompe seleção em andamento',async()=>{
  const x=harness({selected:true});
  await x.run();
  assert.equal(x.report().requests,0);
  assert.equal(x.report().renders,0);
});

test('não interrompe busca ativa',async()=>{
  const x=harness({filterActive:true});
  await x.run();
  assert.equal(x.report().requests,0);
});

test('não consulta o banco com guia oculta ou fora dos atendimentos',async()=>{
  const hidden=harness({visible:false});
  const overview=harness({view:'overview'});
  await hidden.run();
  await overview.run();
  assert.equal(hidden.report().requests,0);
  assert.equal(overview.report().requests,0);
});

test('não altera a interface quando a consulta retorna erro',async()=>{
  const x=harness({error:{code:'42501'}});
  await x.run();
  assert.equal(x.report().requests,1);
  assert.equal(x.report().reloads,0);
  assert.equal(x.report().renders,0);
  assert.equal(x.report().busy,false);
});

test('mudança no total detecta registros após o primeiro lote de 100',async()=>{
  const x=harness({count:101});
  await x.run();
  assert.equal(x.report().requests,1);
  assert.equal(x.report().reloads,1);
});

test('não redesenha atendimento enquanto existe modal de confirmação/vínculo',async()=>{
  const x=harness({dialogActive:true});
  await x.run();
  assert.equal(x.report().requests,0);
  assert.equal(x.report().renders,0);
});
