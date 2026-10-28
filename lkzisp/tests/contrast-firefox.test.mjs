import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');

function luminance(hex){
 const full=hex.length===4?'#'+[...hex.slice(1)].map(c=>c+c).join(''):hex;
 const values=[1,3,5].map(i=>parseInt(full.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
 return values[0]*.2126+values[1]*.7152+values[2]*.0722;
}
function contrast(foreground,background){
 const x=luminance(foreground),y=luminance(background);
 return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
test('contraste WCAG AA de textos regulares nos elementos criticos',()=>{
 const pairs=[
  ['texto principal','#12283e','#eef3f8'],
  ['rotulos de formulario','#253b51','#fff'],
  ['texto secundario em cartao','#415972','#fff'],
  ['texto de aviso','#593409','#fff1d7'],
  ['botao primario','#fff','#075baa'],
  ['status nao autenticado','#6b3c00','#ffe6b9'],
  ['rodape','#07519b','#fff'],
  ['links no menu escuro','#e0ebf8','#0c2037'],
  ['observacoes de rodape','#455d75','#fff']
 ];
 for (const [name,fg,bg] of pairs) {
  assert.ok(css.includes(fg) && css.includes(bg),name+' precisa existir na folha de estilos');
  assert.ok(contrast(fg,bg)>=4.5,name+' abaixo de WCAG AA: '+contrast(fg,bg).toFixed(2));
 }
});
test('fontes em Firefox Android nao ficam limitadas a peso fino',()=>{
 assert.match(css,/font-family:Roboto,"Noto Sans",system-ui/);
 assert.match(css,/font-synthesis:weight/);
 assert.match(css,/\.page-head h1\{color:#12283e;font-weight:800/);
 assert.match(css,/@media\(max-width:760px\)/);
 assert.match(css,/\.field input,\.field select,form input,form select\{font-size:16px/);
});
test('inputs e avisos nao usam texto claro sobre fundo claro',()=>{
 assert.match(css,/\.notice\.warning\{background:#fff1d7;border-color:#bd842d;color:#593409\}/);
 assert.match(css,/\.field input,\.field select,\.field textarea/);
 assert.match(css,/color:#12283e;\s*background:#fff;/);
 assert.match(css,/input:autofill,input:-webkit-autofill/);
});
test('PWA evita reutilizar CSS de versao anterior',()=>{
 assert.match(html,/styles\.css\?v=134/);
 assert.match(sw,/lkz-isp-static-v134/);
 assert.match(sw,/styles\.css\?v=134/);
 assert.match(sw,/staticURLs\.has\(req\.url\)/);
 assert.doesNotMatch(sw,/supabase\.co/);
});
