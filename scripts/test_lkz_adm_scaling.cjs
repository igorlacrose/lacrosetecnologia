'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createHash,webcrypto}=require('node:crypto');
const source=fs.readFileSync('admin/app.js','utf8');
const start=source.indexOf('const LIST_BATCH_SIZE=');
const end=source.indexOf('async function loadCommercial(){',start);
assert.ok(start>=0&&end>start,'Carregador paginado não encontrado');
const triageStart=source.indexOf('function ocaInternalTriage(');
const triageEnd=source.indexOf('function openTriageAction(',triageStart);
assert.ok(triageStart>=0&&triageEnd>triageStart,'Triagem OCA não encontrada');

async function checkPaging(numRecords){
  const values=Array.from({length:numRecords},(_,i)=>({id:String(i+1)}));
  const calls=[];
  const sb={
    from(table){
      assert.equal(table,'leads');
      return {
        select(fields,options){
          assert.equal(fields,'*');
          return {
            order(){return this},
            async range(first,last){
              calls.push([first,last,options.count]);
              return {data:values.slice(first,last+1),count:options.count==='exact'?values.length:null,error:null};
            }
          };
        }
      };
    }
  };
  const ctx=vm.createContext({sb,Number,Date,String});
  vm.runInContext(source.slice(start,end),ctx,{timeout:3000});
  const fn=vm.runInContext('loadPaged',ctx);
  const response=await fn('leads','*','updated_at');
  assert.equal(response.count,numRecords);
  assert.equal(response.loaded,Math.min(numRecords,3000));
  assert.equal(response.partial,numRecords>3000);
  assert.equal(calls.length,Math.ceil(Math.min(numRecords||1,3000)/200));
  assert.equal(calls[0][2],'exact');
  for(let i=1;i<calls.length;i++){
    assert.equal(calls[i][0],calls[i-1][1]+1);
  }
}

async function main(){
  await checkPaging(0);
  await checkPaging(17);
  await checkPaging(205);
  await checkPaging(3002);
  console.log('OK: paginacao e corte de 3000 com aviso de parcialidade');

  const scope=vm.createContext({Date,Set,Number});
  vm.runInContext(source.slice(triageStart,triageEnd),scope,{timeout:3000});
  const fn=vm.runInContext('ocaInternalTriage',scope);
  const dataset={
    leads:[
      {id:'a',name:'Revisao',status:'human_review',contact_id:'client1',updated_at:'2026-11-11T14:00:00Z'},
      {id:'b',name:'Sem contato',status:'new',contact_id:null,updated_at:'2026-11-11T14:00:00Z'},
      {id:'c',name:'Qualificado',status:'qualified',contact_id:'client2',updated_at:'2026-11-11T14:00:00Z'},
      {id:'d',name:'Com retorno',status:'qualified',contact_id:'client3',updated_at:'2026-11-11T14:00:00Z'},
      {id:'e',name:'Encerrado',status:'won',contact_id:'client4',updated_at:'2026-11-11T14:00:00Z'}
    ],
    followups:[{lead_id:'d',status:'pending'}]
  };
  const actions=fn(dataset,Date.parse('2026-11-12T18:00:00Z'));
  assert.equal(actions.length,3);
  assert.deepEqual(actions.map(a=>a.action).join(','),'review,identify,schedule');
  assert.ok(!actions.some(a=>a.id==='d'||a.id==='e'));
  console.log('OK: triagem prioriza revisao, identidade e retorno sem duplicidade');
  const metricsStart=source.indexOf('function executiveMetrics(');
  const metricsEnd=source.indexOf('function overview(',metricsStart);
  const stagesStart=source.indexOf('const crmStages=');
  const stagesEnd=source.indexOf('function openOpportunity(',stagesStart);
  const metrics=vm.runInNewContext(
    source.slice(stagesStart,stagesEnd)+source.slice(metricsStart,metricsEnd)+'executiveMetrics');
  const report=metrics({
    leads:['new','proposal','won','lost','lost','archived'].map(status=>({status})),
    loadMeta:{partial:true}
  });
  assert.equal(report.open,2);
  assert.equal(report.decided,3);
  assert.equal(report.winRate,1/3);
  assert.equal(report.archived,1);
  assert.equal(report.partial,true);
  assert.equal(report.pipeline.reduce((sum,[,count])=>sum+count,0),3);
  assert.equal(metrics({leads:[]}).winRate,null);
  console.log('OK: funil executivo, taxa de fechamento e amostra parcial');
  const fluxSource=fs.readFileSync('admin/flux-preview.js','utf8');
  const readFlux=vm.runInNewContext(fluxSource+'\nreadFluxBackup',{TextEncoder});
  const income={id:'b',date:'2026-11-13',type:'income',description:'Venda',category:'Caixa',cents:5000};
  const expense={...income,id:'a',type:'expense',cents:1200};
  const checksum=createHash('sha256').update(JSON.stringify([expense,income])).digest('hex');
  const backup={format:'lacrose-flux-local',version:2,transactions:[income,expense],checksum};
  const file=payload=>({size:100,text:async()=>JSON.stringify(payload)});
  const summary=await readFlux(file(backup),webcrypto.subtle);
  assert.equal(summary.count,2);
  assert.equal(summary.totals.income,5000);
  assert.equal(summary.categories.get('Caixa').expense,1200);
  await assert.rejects(readFlux(file({...backup,checksum:'0'}),webcrypto.subtle),/checksum/);
  await assert.rejects(readFlux(file({...backup,transactions:[income,income]}),webcrypto.subtle),/repetidos/);
  await assert.rejects(readFlux(file({...backup,transactions:[{...income,date:'2026-02-30'}]}),webcrypto.subtle),/inválidos/);
  await assert.rejects(readFlux({size:11*1024*1024},webcrypto.subtle),/10 MB/);
  console.log('OK: conferência de backup FluX, categorias, checksum e rejeição de dados inválidos');
  assert.ok(source.includes('const ADMIN_IDLE_MS=30*60*1000'));
  assert.ok(source.includes('function dataScopeNotice()'));
  console.log('OK: hardening 30 min e aviso de carga parcial');
}
main().catch(e=>{console.error(e);process.exitCode=1});
