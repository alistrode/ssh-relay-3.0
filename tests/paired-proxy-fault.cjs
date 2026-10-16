'use strict';
// App-scoped forwarding proxy: stays on the normal managed HTTPS proxy path.
// It closes only this test near's connections; no route/system proxy is changed.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {save,load,privateDirectory}=require('../src/paired-store.cjs');
const base=process.argv[2];if(!base||!path.isAbsolute(base))throw new Error('Private directory required');privateDirectory(base);
const upstream=new URL(process.env.https_proxy||process.env.HTTPS_PROXY||'');
if(upstream.protocol!=='http:')throw new Error('This test requires the existing HTTP CONNECT sidecar proxy');
const clients=new Set(),processes=[];let blocked=false;
const proxy=net.createServer(incoming=>{
  if(blocked){incoming.destroy();return;}
  const outgoing=net.connect(Number(upstream.port)||80,upstream.hostname);
  clients.add(incoming);clients.add(outgoing);
  for(const s of [incoming,outgoing]){s.on('error',()=>{incoming.destroy();outgoing.destroy();});s.on('close',()=>clients.delete(s));}
  incoming.pipe(outgoing);outgoing.pipe(incoming);
});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=150000){const start=Date.now();while(Date.now()-start<timeout){if(fn())return;await wait(500);}throw new Error('Recovery timeout');}
const state=name=>load(path.join(base,name,'status.json'),{});
const control=(name,msg)=>save(path.join(base,name+'-control.json'),msg);
function launch(name,role,port){const fd=fs.openSync(path.join(base,name+'.log'),'a',0o600);const p=spawn(process.execPath,[path.resolve(__dirname,'../src/paired-agent.cjs'),'--role',role,'--state-dir',path.join(base,name),'--control-file',path.join(base,name+'-control.json'),...(role==='near'?['--allow-cloud-self-test']:[])],{stdio:['ignore',fd,fd],env:{...process.env,...(port?{https_proxy:'http://127.0.0.1:'+port}:{})}});fs.closeSync(fd);processes.push({name,p});}
(async()=>{try{
await new Promise(r=>proxy.listen(0,'127.0.0.1',r));launch('far','far');launch('near','near',proxy.address().port);await until(()=>state('far').phase==='listening');control('far',{action:'pair'});await until(()=>fs.existsSync(path.join(base,'far','pairing-private.json')));control('near',{action:'pair',code:load(path.join(base,'far','pairing-private.json')).code});await until(()=>state('near').connected);const selected=state('near').selected,fp=state('near').fingerprint,start=Date.now();blocked=true;for(const socket of clients)socket.destroy();await until(()=>!state('near').connected,60000);await wait(12000);blocked=false;await until(()=>state('near').connected&&state('near').lastVerifiedAt>start);assert.equal(state('near').selected,selected);assert.equal(state('near').fingerprint,fp);const traces=fs.readFileSync(path.join(base,'near','near-manager-events.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));assert.ok(traces.some(x=>x.event==='mqtt_retry_scheduled'));const result={passed:true,cloudSelfTest:true,normalProxyPreserved:true,onlyTestNearAffected:true,outageMs:12000,recoveryMs:Date.now()-start,pairingPreserved:true};save(path.join(base,'results.json'),result);console.log(JSON.stringify(result));
}finally{for(const {name}of processes)control(name,{action:'quit'});await wait(3000);for(const{p}of processes)if(p.exitCode===null)p.kill();for(const s of clients)s.destroy();proxy.close();}})().catch(e=>{console.error(e.message);save(path.join(base,'results.json'),{passed:false,error:e.message});process.exitCode=1});
