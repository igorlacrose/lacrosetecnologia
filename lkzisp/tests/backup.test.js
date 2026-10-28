import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSnapshot,detectMapping} from '../src/engine.js';
import {cleanBackupSnapshot,encryptBackup,decryptBackup} from '../src/backup.js';
import {readFile} from 'node:fs/promises';
const m=detectMapping(['Status','Assunto','Setor','Cidade','Abertura','Fechamento','Prioridade']);
const snap=buildSnapshot([
 ['Aberta','RT-SEM CONEXÃO','Técnicos Jequié','Jequié',46318,null,'Normal'],
 ['Finalizada','RT - MANUNTENÇÃO DB ALTO','Técnicos Jequié','Jequié',46317,46318.5,'Alta']
],m);
snap.privatePassword='SENHA-SENSIVEL-QUE-NAO-PODE-SER-EXPORTADA';
snap.extraPii='CPF 12345678900 cliente pessoal';
test('backup criptografa e restaura apenas agregados whitelisted',async()=>{
 const pw='frase segura exclusivamente para testes 2026';
 const encrypted=await encryptBackup([snap],pw);
 const file=JSON.stringify(encrypted);
 for(const secret of ['SENHA-SENSIVEL','CPF 123','Técnicos Jequié'])assert.equal(file.includes(secret),false);
 const [restored]=await decryptBackup(file,pw);
 assert.equal(restored.total,2);
 assert.equal(restored.privatePassword,undefined);
 assert.equal(restored.extraPii,undefined);
 assert.equal(restored.subjects['DB alto'].total,1);
 assert.equal(restored.sectors['Técnicos Jequié'].total,2);
 assert.equal(restored.pending,1);
 await assert.rejects(()=>decryptBackup(file,'senha errada com bastante tamanho'));
 const tampered=JSON.parse(file);tampered.ciphertext=tampered.ciphertext.slice(0,-4)+'AAAA';
 await assert.rejects(()=>decryptBackup(JSON.stringify(tampered),pw));
});
test('rejeita snapshots com categorias pessoais, CPFs ou contagens alteradas',async()=>{
 assert.throws(()=>cleanBackupSnapshot({...snap,sectors:{...snap.sectors,'João Silva CPF 123':{total:1,pending:1,finalized:0}}}));
 assert.throws(()=>cleanBackupSnapshot({...snap,finalized:4000}));
 await assert.rejects(()=>encryptBackup([snap],'curta'));
});
test('rodapé centralizado e visível e servidor permite backup.js sem liberar sql',async()=>{
 const css=await readFile(new URL('../styles.css',import.meta.url),'utf8');
 const app=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(css,/\.lkz-footer\{position:sticky;bottom:0/);
 assert.match(app,/Desenvolvido por Lacrose Tecnologia/);
 assert.match(app,/backup-finish/);
 assert.match(server,/\/src\/backup\.js/);
 assert.doesNotMatch(server,/\/backend\/001_schema_rls\.sql'/);
});
