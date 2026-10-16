'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {save,load,privateDirectory}=require('../src/paired-store.cjs');
const root=process.argv[2];if(!root||!path.isAbsolute(root))throw new Error('Private directory required');privateDirectory(root);
const state=()=>load(path.join(root,'status.json'),{}),control=msg=>save(path.join(root,'control.json'),msg);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+60000;while(Date.now()<end){if(fn())return;await wait(250);}throw new Error('Worker recovery timed out');}
const fd=fs.openSync(path.join(root,'manager.log'),'a',0o600);
const child=spawn(process.execPath,[path.resolve(__dirname,'../src/paired-agent.cjs'),'--role','far','--state-dir',root,'--control-file',path.join(root,'control.json')],{stdio:['ignore',fd,fd]});fs.closeSync(fd);
(async()=>{try{
await until(()=>['listening','connected'].includes(state().phase));
for(let i=0;i<4;i++){const pid=state().workerPid;process.kill(pid,'SIGKILL');await until(()=>state().workerPid!==pid&&['listening','connected'].includes(state().phase));}
const rows=fs.readFileSync(path.join(root,'far-manager-events.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));const delays=rows.filter(x=>x.event==='worker_exit').slice(-4).map(x=>x.delayMs);
assert.equal(delays.length,4);assert.ok(delays[3]>=3200&&delays[3]<=4000,'Brief broker readiness must not reset escalating crash backoff');
const result={passed:true,cloudSelfTest:true,crashes:4,retryDelaysMs:delays,stableResetWindowMs:60000};save(path.join(root,'results.json'),result);console.log(JSON.stringify(result));
}finally{control({action:'quit'});await wait(3000);if(child.exitCode===null)child.kill();}})().catch(error=>{console.error(error.message);save(path.join(root,'results.json'),{passed:false,error:error.message});process.exitCode=1});
