const fs=require('fs'), path=require('path');
const BASE='/mnt/c/Users/User123/Documents/Sixth';
function makeEl(){const el={className:'',textContent:'',innerHTML:'',scrollTop:0,scrollHeight:0,style:{},children:[],classList:{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},contains(c){return this._s.has(c)}},setAttribute(){},getAttribute(){return null},appendChild(c){this.children.push(c)},addEventListener(){},focus(){}};return el;}
const els={termShellBody:makeEl(),termInput:makeEl(),termPrompt:makeEl(),termShell:makeEl()};
global.document={readyState:'complete',getElementById:(id)=>els[id]||null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>makeEl()};
global.localStorage={_s:{},getItem(k){return k in this._s?this._s[k]:null},setItem(k,v){this._s[k]=String(v)},removeItem(k){delete this._s[k]}};
global.window=global;global.navigator={};global.crypto=require('crypto').webcrypto;
require(path.join(BASE,'js','terminal.js'));
const api=global.CyberTerm||global.CyberTerminal||global.SandboxTerm;
if(!api){console.error('NO API');process.exit(1);}
function buff(){return els.termShellBody.children.map(c=>c.textContent||'').join('\n');}
const cmds=new Set();
for(const f of ['index.html','offensive.html','defensive.html','recon.html','tools.html','careers.html','about.html','lab.html']){
  const p=path.join(BASE,f);if(!fs.existsSync(p))continue;
  const src=fs.readFileSync(p,'utf8');
  for(const m of src.matchAll(/data-run="([^"]*)"/g)){for(const x of m[1].split('&&')){const t=x.trim();if(t)cmds.add(t);}}
}
for(const c of ['hydra -l webadmin -P /opt/lab/wordlists/passwords.txt ssh://lab-web-01','hashcat -m 0 /opt/lab/hashes.txt','john /opt/lab/hashes.txt','gobuster dir -u http://lab-web-01 -w /opt/lab/wordlists/directory.txt','nikto -h http://lab-web-01','searchsploit samba 3','tcpdump -i eth0 -c 2','ps aux','missions','flag FLAG{lab-web-01}','score','help']){cmds.add(c);}
let fails=0;
for(const c of cmds){
  const before=buff();
  let e=null;try{api.run(c);}catch(x){e=x;}
  const added=buff().slice(before.length);
  const nf=/command not found|perintah tidak dikenal|CMD tidak dikenal/.test(added);
  if(e||(e&&false)){}
  if(e){fails++;console.log('THROW ',c,'->',e.message);}
  else if(nf){fails++;console.log('NOTFOUND',c,'(',JSON.stringify(added.slice(0,80)),')');}
  else if(!added.length){fails++;console.log('EMPTY  ',c);}
}
console.log(`FULL: ${cmds.size} cmds, ${fails} failures`);
process.exit(fails?1:0);
