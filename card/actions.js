(()=>{
'use strict';
const root=document.body;
const toast=document.getElementById('toast');
const isPersonal=root.dataset.card==='personal';
const home='https://lacrosetecnologia.com.br/';
const cardUrl=home+(isPersonal?'igor/':'card/');
let timer;
function notify(message){if(!toast)return;toast.textContent=message;toast.classList.add('show');clearTimeout(timer);timer=setTimeout(()=>toast.classList.remove('show'),2600);}
function escapeVCard(value){return String(value).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');}
function saveContact(){
 const name=isPersonal?'Igor Lacrose':'Lacrose Tecnologia';
 const lines=['BEGIN:VCARD','VERSION:3.0','FN:'+escapeVCard(name)];
 if(isPersonal){
   lines.push('TITLE:Empresario e consultor de tecnologia','ORG:Lacrose Tecnologia');
   lines.push('TEL;TYPE=WORK:+5573981097097','TEL;TYPE=WORK:+5573982455573');
   lines.push('NOTE:'+escapeVCard('Contatos comerciais: Lacrose Tecnologia (73) 98109-7097; Bahia Nexos Telecom (73) 98245-5573.'));
 }else{
   lines.push('ORG:Lacrose Tecnologia','TEL;TYPE=WORK:+5573981097097','TITLE:Sites\, sistemas e automacao com IA');
 }
 lines.push('URL:'+cardUrl,'END:VCARD','');
 const url=URL.createObjectURL(new Blob([lines.join('\r\n')],{type:'text/vcard;charset=utf-8'}));
 const link=document.createElement('a');link.href=url;link.download=isPersonal?'Igor-Lacrose.vcf':'Lacrose-Tecnologia.vcf';document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);notify('Contato pronto para salvar.');
}
async function share(){
 const data={title:isPersonal?'Igor Lacrose | Cartão executivo':'Lacrose Tecnologia | Cartão digital',text:isPersonal?'Tecnologia que conecta. Soluções que impulsionam.':'Sites, sistemas e automação com IA.',url:cardUrl};
 if(navigator.share){try{await navigator.share(data);return;}catch(error){if(error?.name==='AbortError')return;}}
 if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(cardUrl);notify('Link copiado!');return;}catch(_){}}
 notify('Copie o endereço exibido no QR Code.');
}
document.querySelectorAll('[data-action]').forEach(button=>{
 button.addEventListener('click',()=>{if(button.dataset.action==='save')saveContact();if(button.dataset.action==='share')void share();});
});
if(!isPersonal&&'serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/card/sw.js',{scope:'/card/',updateViaCache:'none'}).then(reg=>reg.update()).catch(()=>{}));}
})();
