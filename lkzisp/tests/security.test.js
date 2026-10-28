import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { win32, posix, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAllSnapshots,saveSnapshot,deleteSnapshots } from '../src/db.js';

const here=dirname(fileURLToPath(import.meta.url));
test('importações ficam apenas na memória da sessão',async()=>{
  const sample=Object.freeze({total:123, subjects:{'DB alto':{total:2}}});
  const rec=await saveSnapshot(sample);
  assert.equal((await getAllSnapshots()).length,1);
  assert.notEqual(rec,sample);
  rec.subjects['DB alto'].total=999;
  assert.equal((await getAllSnapshots())[0].subjects['DB alto'].total,2);
  // Nenhum teste escreve IndexedDB ou localStorage.
  assert.equal(typeof globalThis.indexedDB,'undefined');
});
test('estático SW permite apenas lista de arquivos públicos',async()=>{
  const sw=await readFile(join(here,'../sw.js'),'utf8');
  assert.match(sw,/staticURLs\.has\(req\.url\)/);
  assert.doesNotMatch(sw,/c\.put\(req,r\.clone\(\)\)/);
  assert.doesNotMatch(sw,/api\/|supabase|postgrest/i);
});
test('checagem relativa funciona também com caminhos Windows',()=>{
  for(const api of [win32,posix]){
    const base=api===win32?'C:\\LKZ ISP': '/lkz/isp';
    const good=api.resolve(base,'src','engine.js');
    const bad=api.resolve(base,'..','secret.xlsx');
    const relGood=api.relative(base,good);const relBad=api.relative(base,bad);
    assert.equal(relGood.startsWith('..'),false);
    assert.equal(relBad.startsWith('..'),true);
  }
});
