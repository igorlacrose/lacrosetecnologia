import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudAccess} from '../src/cloud-auth.js';

const tenant='12345678-1234-4234-8234-123456789abc';
const uid='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const jwt=['h',Buffer.from(JSON.stringify({aal:'aal2',sub:uid,role:'authenticated'})).toString('base64url'),'sig'].join('.');
const ok=body=>({ok:true,status:200,json:async()=>body});

test('paginação percorre mais de 250 snapshots sem perder histórico antigo',async()=>{
 const rows=Array.from({length:512},(_,i)=>({id:uid,tenant_id:tenant,
  fingerprint:i.toString(16).padStart(64,'a'.charCodeAt(0).toString(16).slice(0,1)).slice(-64),
  snapshot:{fingerprint:i.toString(16).padStart(64,'0'),total:i+1}})).map((x,i)=>({...x,fingerprint:i.toString(16).padStart(64,'0')}));
 const calls=[];
 const client=new CloudAccess(async(url)=>{
  if(url.includes('grant_type=password'))return ok({access_token:jwt,refresh_token:'stub',expires_in:3600,user:{id:uid,email:'teste@example.invalid'}});
  if(url.includes('lkz_isp_aggregate_snapshots')){
   const parsed=new URL(url);
   const offset=Number(parsed.searchParams.get('offset')||0),limit=Number(parsed.searchParams.get('limit'));
   assert.equal(limit,250);
   calls.push(offset);
   return ok(rows.slice(offset,offset+limit));
  }
  throw Error('unexpected '+url);
 });
 await client.signIn('teste@example.invalid','senha-teste');
 const items=await client.listAggregateSnapshots(tenant);
 assert.equal(items.length,512);
 assert.deepEqual(calls,[0,250,500]);
 assert.equal(items[0].fingerprint,'0'.repeat(64));
 assert.equal(items.at(-1).fingerprint,(511).toString(16).padStart(64,'0'));
});
