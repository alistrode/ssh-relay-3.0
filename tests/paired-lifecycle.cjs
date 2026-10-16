'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {save,load,privateDirectory}=require('../src/paired-store.cjs');
const base=process.argv[2];if(!base||!path.isAbsolute(base))throw new Error('Explicit absolute private state directory required');
privateDirectory(base);
const children=new Map(),results=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const now=()=>Date.now();
function state(name){return load(path.join(base,name,'status.json'),{});}
async function until(check,timeout=150000){const start=now();while(now()-start<timeout){const value=check();if(value)return value;await wait(500);}throw new Error('Acceptance condition timed out');}
function launch(name,role){const fd=fs.openSync(path.join(base,name+'.log'),'a',0o600);const child=spawn(process.execPath,[path.resolve(__dirname,'../src/paired-agent.cjs'),'--role',role,'--state-dir',path.join(base,name),'--control-file',path.join(base,name+'-control.json'),...(role==='near'?['--allow-cloud-self-test']:[])],{stdio:['ignore',fd,fd]});fs.closeSync(fd);children.set(name,child);return child;}
function control(name,value){save(path.join(base,name+'-control.json'),value);}
async function stop(name){const p=children.get(name);if(!p||p.exitCode!==null)return;control(name,{action:'quit'});await until(()=>p.exitCode!==null,10000);}
async function pair(name){control('far',{action:'pair'});const offer=await until(()=>load(path.join(base,'far','pairing-private.json'),null));control(name,{action:'pair',code:offer.code});await until(()=>state(name).connected===true);await until(()=>!fs.existsSync(path.join(base,'far','pairing-private.json')));}
async function result(name,fn){const start=now();await fn();const value={name,passed:true,milliseconds:now()-start};results.push(value);console.log(JSON.stringify(value));save(path.join(base,'results.json'),{cloudSelfTest:true,results});}
(async()=>{try{
launch('far','far');launch('near1','near');launch('near2','near');await until(()=>['listening','connected'].includes(state('far').phase));
await result('first-pair-and-pinned-real-ssh',()=>pair('near1'));
await result('second-independent-pair-does-not-reset-first',async()=>{const first=state('near1').lastVerifiedAt;await pair('near2');await until(()=>state('near1').connected&&state('near1').lastVerifiedAt>first);assert.notEqual(state('near1').selected,state('near2').selected);});
await result('duplicate-manager-refused',async()=>{const fd=fs.openSync(path.join(base,'duplicate.log'),'a',0o600);const p=spawn(process.execPath,[path.resolve(__dirname,'../src/paired-agent.cjs'),'--role','near','--state-dir',path.join(base,'near1')],{stdio:['ignore',fd,fd]});fs.closeSync(fd);await until(()=>p.exitCode!==null,10000);assert.notEqual(p.exitCode,0);assert.equal(state('near1').connected,true);});
await result('near-restart-keeps-pair-and-host-identity',async()=>{const id=state('near1').selected,fp=state('near1').fingerprint;await stop('near1');launch('near1','near');await until(()=>state('near1').connected&&state('near1').lastVerifiedAt>now()-5000);assert.equal(state('near1').selected,id);assert.equal(state('near1').fingerprint,fp);});
await result('remote-worker-crash-automatically-recovers-both-nears',async()=>{const before=state('far').workerPid,start=now();process.kill(before,'SIGKILL');await until(()=>state('far').workerPid!==before&&['listening','connected'].includes(state('far').phase));for(const name of ['near1','near2'])await until(()=>state(name).connected&&state(name).lastVerifiedAt>start);});
await result('remote-manager-restart-restores-all-paired-links',async()=>{const start=now();await stop('far');launch('far','far');await until(()=>['listening','connected'].includes(state('far').phase));for(const name of ['near1','near2'])await until(()=>state(name).connected&&state(name).lastVerifiedAt>start);});
await result('revoke-all-removes-old-access-and-repairs',async()=>{const old=state('far').fingerprint;control('far',{action:'revoke-all'});await until(()=>['listening','connected'].includes(state('far').phase)&&state('far').fingerprint!==old);await until(()=>!state('near1').connected&&!state('near2').connected);assert.equal(load(path.join(base,'far','paired-links-private.json'),[]).length,0);await pair('near1');assert.notEqual(state('near1').fingerprint,old);});
save(path.join(base,'results.json'),{passed:true,cloudSelfTest:true,results});
}finally{for(const name of ['near1','near2','far'])await stop(name).catch(()=>{});}})().catch(error=>{save(path.join(base,'results.json'),{passed:false,cloudSelfTest:true,results,error:error.message});console.error(error.message);process.exitCode=1;});
