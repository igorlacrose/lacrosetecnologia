'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const browser=read('assets/oca-turnstile.js');
const page=read('index.html');
const app=read('app.js');
const api=read('supabase/functions/oca-interpret/index.ts');
const sql=read('supabase/sql/oca_ai_monthly_budget.sql');
const rollback=read('supabase/sql/oca_ai_monthly_budget_rollback.sql');

function widgetHarness({sitekey='0x4AAAAAAATEST_PUBLIC_KEY',onExecute=true}={}){
  const events=[];
  const widget={dataset:{sitekey},hidden:true,isConnected:true,replaceChildren:()=>events.push('clear')};
  let callbacks=null;
  const turnstile={
    render:(node,options)=>{
      assert.equal(node,widget);
      callbacks=options;
      events.push('render');
      return 'widget-test';
    },
    execute:(id)=>{
      assert.equal(id,'widget-test');
      events.push('execute');
      if(onExecute)callbacks.callback('test_server_verification_token_123456');
    },
    remove:(id)=>{
      assert.equal(id,'widget-test');
      events.push('remove');
    }
  };
  const window={
    document:{getElementById:id=>id==='ocaAiTurnstile'?widget:null},
    turnstile,setTimeout,clearTimeout
  };
  const module={exports:{}};
  vm.runInNewContext(browser,{window,module},{timeout:2000});
  return {api:module.exports,widget,events,callback:()=>callbacks};
}

test('IA sem sitekey permanece indisponível e sem chamada ao widget',async()=>{
  const h=widgetHarness({sitekey:''});
  assert.equal(h.api.available(),false);
  assert.equal(await h.api.acquire(),null);
  assert.deepEqual(h.events,[]);
});

test('widget aprovado retorna token único, declara action e não fica exibido',async()=>{
  const h=widgetHarness();
  assert.equal(h.api.available(),true);
  const token=await h.api.acquire();
  assert.equal(token,'test_server_verification_token_123456');
  assert.equal(h.callback().action,'oca_interpret');
  assert.equal(h.callback().execution,'execute');
  assert.equal(h.callback().appearance,'interaction-only');
  assert.equal(h.widget.hidden,true);
  assert.deepEqual(h.events,['render','execute','remove','clear']);
});

test('cancelamento em andamento não entrega token para cobrança',async()=>{
  const h=widgetHarness({onExecute:false});
  const pending=h.api.acquire();
  // O widget é renderizado de forma síncrona ao completar o await de load().
  await Promise.resolve();
  h.api.cancel();
  assert.equal(await pending,null);
  assert.equal(h.widget.hidden,true);
  assert.ok(h.events.includes('remove'));
});

test('scripts estão em ordem, sitekey não contém segredo, CSP protege o widget',()=>{
  assert.match(page,/id="ocaAiTurnstile" data-sitekey=""[^>]*hidden/);
  assert.ok(page.indexOf('assets/oca-turnstile.js')<page.indexOf('app.js?v='));
  assert.match(page,/script-src[^"]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(page,/frame-src https:\/\/challenges\.cloudflare\.com/);
  assert.doesNotMatch(page+/apiSecret|turnstileSecret|TURNSTILE_SECRET_KEY/i);
  assert.match(app,/!OCA_TURNSTILE\?\.available\(\)/);
  assert.match(app,/const challenge=await OCA_TURNSTILE\?\.acquire\(\)/);
  assert.match(app,/turnstileToken:challenge/);
  assert.match(app,/OCA_TURNSTILE\?\.cancel\(\)/);
});

test('o servidor valida o desafio antes de reservar e pagar',()=>{
  assert.match(api,/Deno\.env\.get\("TURNSTILE_SECRET_KEY"\)/);
  assert.match(api,/typeof turnstileToken!=="string"||turnstileToken\.length<20/);
  assert.match(api,/turnstileToken\.length>2048/);
  const verify=api.indexOf('https://challenges.cloudflare.com/turnstile/v0/siteverify');
  const checks=api.indexOf('result?.success!==true');
  const reserve=api.indexOf('sb.rpc("oca_ai_reserve_monthly"');
  const spend=api.indexOf('fetch("https://api.openai.com/v1/responses"');
  assert.ok(verify>0&&checks>verify&&reserve>checks&&spend>reserve);
  assert.match(api,/result\?\.action!=="oca_interpret"/);
  assert.match(api,/www\.lacrosetecnologia\.com\.br/);
  assert.match(api,/Date\.now\(\)-challengeAt>300000/);
  assert.match(api,/p_token_hash:await sha\(pepper\+":turnstile:"\+turnstileToken\)/);
  assert.doesNotMatch(api,/console\.log\(.*(?:turnstileToken|apiKey|questionText)/);
});

test('uma reserva mensal não aceita o mesmo desafio duas vezes',()=>{
  assert.match(sql,/CREATE TABLE IF NOT EXISTS lkz_adm_private\.oca_ai_token_claims/);
  assert.match(sql,/token_hash text PRIMARY KEY/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/p_token_hash text/);
  assert.match(sql,/ON CONFLICT \(token_hash\) DO NOTHING/);
  assert.match(sql,/IF NOT FOUND THEN\s+RETURN false/);
  assert.match(sql,/ON CONFLICT \(tenant_slug,month_utc\) DO UPDATE/);
  assert.match(sql,/p_limit_micro_usd-EXCLUDED\.reserved_micro_usd/);
  assert.match(sql,/RETURN true/);
  assert.match(sql,/public\.oca_ai_reserve_monthly\(integer,integer,text\)/);
  assert.match(rollback,/DROP FUNCTION IF EXISTS public\.oca_ai_reserve_monthly\(integer,integer,text\)/);
  assert.doesNotMatch(rollback,/DROP TABLE|TRUNCATE TABLE|DELETE FROM/i);
});

test('modelo não autoriza preço, venda, ou alteração comercial',()=>{
  assert.match(api,/const IDS=\[/);
  assert.match(api,/model:MODEL/);
  assert.match(api,/store:false/);
  assert.match(api,/type:"json_schema"/);
  assert.match(api,/max_output_tokens:120/);
  assert.doesNotMatch(api,/executeSale|activateProduct|sendInvoice|writePrice/i);
});
