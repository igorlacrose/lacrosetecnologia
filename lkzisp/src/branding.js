/** White Label: apenas PRÉVIA volátil, sem upload à internet.
 * Não confundir com configurações multiempresa aprovadas no servidor.
 */
export const newBrand=()=>({name:'LKZ ISP Intelligence',primary:'#086bca',domain:'',logo:null,icon:null,icon512:null});
export function validateBrandName(value){
 const s=String(value||'').trim();
 if(s.length<2||s.length>50||/[<>\u0000-\u001F]/.test(s))throw new Error('Nome comercial inválido (2 a 50 caracteres).');
 return s;
}
export function validateHexColor(v){
 if(!/^#[0-9a-fA-F]{6}$/.test(String(v)))throw new Error('Cor principal inválida.');
 return v.toLowerCase();
}
export function validateDomain(v){
 const s=String(v||'').trim().toLowerCase();
 if(!s)return '';
 if(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(s)||s==='localhost'||s.endsWith('.localhost')||s.length>150||s.includes('..')||!s.includes('.')||!s.split('.').every(part=>part.length>0&&part.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part)))throw new Error('Informe somente um domínio válido (ex.: sistema.empresa.com.br).');
 return s;
}
function previewCanvas(bitmap,size,fill=.85){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
 const ctx=canvas.getContext('2d',{alpha:true});
 if(!ctx)throw new Error('O navegador não suporta a prévia de logo.');
 const scale=Math.min((size*fill)/bitmap.width,(size*fill)/bitmap.height);
 const w=bitmap.width*scale,h=bitmap.height*scale;
 ctx.drawImage(bitmap,(size-w)/2,(size-h)/2,w,h);
 return canvas.toDataURL('image/png'); // imagem re-encodada: não preservar conteúdo EXIF
}
export async function prepareBrandImage(file){
 if(!file || file.size>2*1024*1024||file.size<20)throw new Error('Logo deve ter até 2 MB.');
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Envie apenas PNG, JPEG ou WebP. SVG não é permitido.');
 const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());
 const png=bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10';
 const jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
 if(!((file.type==='image/png'&&png)||(file.type==='image/jpeg'&&jpg)||(file.type==='image/webp'&&webp)))throw new Error('Arquivo não corresponde ao formato declarado.');
 let bitmap;
 try{bitmap=await createImageBitmap(file);if(bitmap.width<16||bitmap.height<16||bitmap.width>4096||bitmap.height>4096||bitmap.width*bitmap.height>8000000)throw new Error('Dimensões da logo fora do limite seguro.');
  return {logo:previewCanvas(bitmap,320),icon:previewCanvas(bitmap,192,.68),icon512:previewCanvas(bitmap,512,.68)};
 }finally{bitmap?.close();}
}
export function applyBrandPreview(brand){
 if(typeof document==='undefined')return;
 document.documentElement.style.setProperty('--lkz-accent',validateHexColor(brand.primary));
 document.title=brand.name+' · LKZ ISP';
 const theme=document.querySelector('meta[name="theme-color"]');if(theme)theme.setAttribute('content',brand.primary);
 const favicon=document.querySelector('link[rel="icon"]');
 if(favicon){favicon.href=brand.icon||'./assets/icon.svg';favicon.type=brand.icon?'image/png':'image/svg+xml';}
}
