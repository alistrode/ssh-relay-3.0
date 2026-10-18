'use strict';
// Portable first-run setup. HTTPS/CA policy stays intact; no global installation.
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto'),net=require('node:net');
const {pipeline}=require('node:stream/promises');
const {spawn}=require('node:child_process');
const {HttpsProxyAgent}=require('https-proxy-agent');
const extract=require('extract-zip');
const meta=require('../../assets/electron-runtime-inputs.json');
const root=path.resolve(__dirname,'../..'),index=process.argv.indexOf('--role');
const role=index<0?'near':process.argv[index+1];
if(!['near','far'].includes(role))throw new Error('Invalid role');
const input=meta.archives.find(x=>x.platform===process.platform&&x.architecture===process.arch);
if(!input)throw new Error('Unsupported platform');
const destination=path.join(root,'runtime-electron');
const executable=path.join(destination,process.platform==='win32'?'electron.exe':'electron');
const marker=path.join(destination,'runtime-verified.json');
const stage=path.join(root,'.electron-setup');
const statusFile=path.join(root,'.runtime-setup-status.json');
const ready=()=>{try{return fs.existsSync(executable)&&fs.existsSync(marker)&&JSON.parse(fs.readFileSync(marker)).archiveSha256===input.sha256;}catch{return false;}};
function status(phase,error){fs.writeFileSync(statusFile,JSON.stringify({phase,error:error||null,time:new Date().toISOString(),version:meta.version})+'\n',{mode:0o600});}
function download(url,file,redirects=0){return new Promise((resolve,reject)=>{
  if(redirects>7)return reject(new Error('redirect_limit'));
  const parsed=new URL(url);if(parsed.protocol!=='https:')return reject(new Error('https_required'));
  const proxy=process.env.https_proxy||process.env.HTTPS_PROXY;
  const request=https.get(parsed,{agent:proxy?new HttpsProxyAgent(proxy):undefined,timeout:15000},response=>{
    if([301,302,303,307,308].includes(response.statusCode)){
      response.resume();return download(new URL(response.headers.location,url).href,file,redirects+1).then(resolve,reject);
    }
    if(response.statusCode!==200){response.resume();return reject(new Error('download_http_'+response.statusCode));}
    const output=fs.createWriteStream(file,{flags:'w',mode:0o600});
    pipeline(response,output).then(resolve,reject);
  });
  request.on('timeout',()=>request.destroy(new Error('download_timeout')));request.on('error',reject);
});}
function digest(file){return new Promise((resolve,reject)=>{const h=crypto.createHash('sha256'),stream=fs.createReadStream(file);stream.on('data',b=>h.update(b));stream.on('error',reject);stream.on('end',()=>resolve(h.digest('hex')));});}
function launch(){
  const args=[path.join(root,'desktop-package'),'--role',role,...(process.argv.includes('--background')?['--background']:[])];
  const child=spawn(executable,args,{detached:true,stdio:'ignore',windowsHide:true});child.on('error',()=>status('launch_failed','desktop_start_failed'));child.unref();
}
(async()=>{
  if(ready()){launch();return;}
  const canonical=fs.realpathSync(root),port=50000+crypto.createHash('sha256').update(process.platform==='win32'?canonical.toLowerCase():canonical).digest().readUInt32BE(0)%10000;
  const lock=net.createServer(socket=>socket.destroy());
  const acquired=await new Promise(resolve=>{lock.once('error',()=>resolve(false));lock.listen(port,'127.0.0.1',()=>resolve(true));});
  if(!acquired){
    const deadline=Date.now()+15*60*1000;while(Date.now()<deadline){await new Promise(r=>setTimeout(r,1000));if(ready()){launch();return;}}
    throw new Error('runtime_setup_wait_timeout');
  }
  try{
    if(ready()){launch();return;}
    fs.mkdirSync(stage,{recursive:true,mode:0o700});
    const zip=path.join(stage,input.file);
    let valid=fs.existsSync(zip)&&await digest(zip)===input.sha256;
    if(!valid){
      status('downloading');let last;
      for(const url of input.urls){try{await download(url,zip);if(await digest(zip)!==input.sha256)throw new Error('runtime_checksum_mismatch');valid=true;break;}catch(error){last=error;fs.rmSync(zip,{force:true});}}
      if(!valid)throw last;
    }
    status('extracting');const unpack=path.join(stage,'unpacked');fs.rmSync(unpack,{recursive:true,force:true});fs.mkdirSync(unpack,{recursive:true});
    await extract(zip,{dir:unpack});
    const bin=path.join(unpack,process.platform==='win32'?'electron.exe':'electron');if(!fs.existsSync(bin))throw new Error('runtime_missing_executable');
    fs.writeFileSync(path.join(unpack,'runtime-verified.json'),JSON.stringify({version:meta.version,archiveSha256:input.sha256})+'\n');
    // The owned destination holds runtime only, never application state or credentials.
    fs.rmSync(destination,{recursive:true,force:true});fs.renameSync(unpack,destination);
    fs.rmSync(zip,{force:true});status('ready');launch();
  }finally{lock.close();}
})().catch(error=>{status('failed',String(error.code||error.message).slice(0,120));process.exitCode=1;});
