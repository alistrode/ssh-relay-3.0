"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), cp = require("node:child_process");
const root = path.resolve(__dirname, "..");
function execQuote(s) {
  return ('"' + s.replace(/[\\"`$]/g, "\\$&") + '"').replace(/\\/g, "\\\\").replace(/%/g,"%%");
}
function linuxEntry() {
  return `[Desktop Entry]\nVersion=1.0\nType=Application\nName=SSH Remote\nName[zh_CN]=SSH 远端\nComment=Start the bundled public SSH relay\nExec=/bin/sh ${execQuote(path.join(root,"START-REMOTE.sh"))}\nIcon=${path.join(root,"assets/relay.svg")}\nTerminal=true\nCategories=Network;\nStartupNotify=false\n`;
}
function install() {
  if (process.platform === "win32") {
    const literal = s => "'" + s.replace(/'/g,"''") + "'";
    const script = "$w=New-Object -ComObject WScript.Shell;$d=[Environment]::GetFolderPath('Desktop');$s=$w.CreateShortcut((Join-Path $d 'SSH Remote.lnk'));$s.TargetPath="+literal(path.join(root,"START-REMOTE.cmd"))+";$s.WorkingDirectory="+literal(root)+";$s.IconLocation="+literal(path.join(root,"assets/relay.ico")+",0")+";$s.Description='Public SSH remote';$s.Save()";
    const r=cp.spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(script,"utf16le").toString("base64")],{windowsHide:true,encoding:"utf8"});
    if(r.error||r.status!==0) throw new Error("Desktop shortcut could not be created; use START-REMOTE.cmd.");
  } else if (process.platform === "linux") {
    const explicit=process.argv.indexOf("--desktop-dir");
    const xdg=cp.spawnSync("xdg-user-dir",["DESKTOP"],{encoding:"utf8"});
    const desktop=explicit>=0 ? path.resolve(process.argv[explicit+1]) : (xdg.status===0&&xdg.stdout.trim()?xdg.stdout.trim():path.join(os.homedir(),"Desktop"));
    fs.mkdirSync(desktop,{recursive:true});
    const file=path.join(desktop,"SSH-Remote.desktop");
    fs.writeFileSync(file,linuxEntry(),{mode:0o755});fs.chmodSync(file,0o755);
    // Some desktops require the user's explicit "Allow Launching" action.
  }
  console.log("Desktop shortcut ready. Keep the extracted application folder in place.");
}
if(require.main===module)try{install();}catch(e){console.error(e.message);}
module.exports={execQuote,linuxEntry};
