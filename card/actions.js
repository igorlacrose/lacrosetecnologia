(()=>{
'use strict';
const personal=document.body.dataset.card==='igor';
const url='https://lacrosetecnologia.com.br/'+(personal?'igor/':'card/');
const toast=document.querySelector('#toast');
const dialog=document.querySelector('#qr-modal');
let timer;
const note=message=>{clearTimeout(timer);toast.textContent=message;toast.classList.add('show');timer=setTimeout(()=>toast.classList.remove('show'),2600)};
const vcardEscape=value=>String(value).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const lines=['BEGIN:VCARD','VERSION:3.0'];
if(personal){lines.push('FN:Igor Lacrose','N:Lacrose;Igor;;;','ORG:Lacrose Tecnologia','TITLE:Empresário - Consultor de Tecnologia',
  'TEL;TYPE=WORK:+5573981097097','TEL;TYPE=WORK:+5573982455573',
  'NOTE:'+vcardEscape('Contatos comerciais - Lacrose Tecnologia: (73) 98109-7097; Bahia Nexos Telecom: (73) 98245-5573.'));
}else{lines.push('FN:Lacrose Tecnologia','N:Lacrose Tecnologia;;;;','ORG:Lacrose Tecnologia','TEL;TYPE=WORK:+5573981097097');}
lines.push('URL:'+url,'END:VCARD','');
function downloadContact(){
 const data=lines.join('\r\n'); const href=URL.createObjectURL(new Blob([data],{type:'text/vcard;charset=utf-8'}));
 const a=document.createElement('a');a.href=href;a.download=personal?'Igor-Lacrose.vcf':'Lacrose-Tecnologia.vcf';document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(href),1300);note('Contato pronto para salvar.');
}
async function share(){const data={title:personal?'Igor Lacrose | Cartão executivo':'Lacrose Tecnologia | Cartão digital',url};
 try{if(navigator.share){await navigator.share(data);return;}}catch(e){if(e?.name==='AbortError')return;}
 try{await navigator.clipboard.writeText(url);note('Link do cartão copiado.');}catch{note('Endereço do cartão: '+url);}
}
document.querySelectorAll('[data-action]').forEach(btn=>btn.addEventListener('click',()=>{
 if(btn.dataset.action==='save')downloadContact();
 if(btn.dataset.action==='share')void share();
 if(btn.dataset.action==='qr')dialog.showModal();
}));
document.querySelector('#close-qr')?.addEventListener('click',()=>dialog.close());
if(!personal&&'serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/card/sw.js',{scope:'/card/',updateViaCache:'none'}).then(reg=>reg.update()).catch(()=>{}));}
})();
