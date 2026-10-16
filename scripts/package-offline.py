#!/usr/bin/env python3
"""Build full offline apps locally; publish lossless <90 MiB GitHub parts."""
from pathlib import Path
import hashlib,json,zipfile,stat,os
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'deliverables'
CACHE=Path(os.environ.get('ELECTRON_ARCHIVE_CACHE','/workspace/rororororo-private/paired-debug/electron-cache'))
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def main():
 meta=json.loads((ROOT/'assets/electron-runtime-inputs.json').read_text());manifest={'version':meta['version'],'offline':True,'archives':[]}
 parts=OUT/'offline-parts';parts.mkdir(exist_ok=True)
 for platform,upstream in [('windows','win32'),('linux','linux')]:
  item=next(x for x in meta['archives'] if x['platform']==upstream)
  inputs=list(CACHE.rglob(item['file']));assert inputs,'Missing official runtime archive'
  archive=inputs[0];assert digest(archive)==item['sha256']
  target=OUT/f'paired-{platform}-x64-offline.zip'
  with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as out:
   with zipfile.ZipFile(OUT/f'paired-{platform}-x64.zip') as app:
    for entry in app.infolist():
     data=app.read(entry.filename)
     if entry.filename=='README.txt': data=('完整离线版：已内置下文提及的全部 Node/Electron 组件；首次启动无需下载。完整解压并保留整个目录。实际公网连接需要网络。\n\n').encode()+data
     out.writestr(entry,data)
   with zipfile.ZipFile(archive) as runtime:
    for entry in runtime.infolist():
     data=runtime.read(entry.filename);entry.filename='runtime-electron/'+entry.filename;out.writestr(entry,data)
   out.writestr('runtime-electron/runtime-verified.json',json.dumps({'version':meta['version'],'archiveSha256':item['sha256']})+'\n')
  record={'platform':platform,'file':target.name,'bytes':target.stat().st_size,'sha256':digest(target),'electronArchiveSha256':item['sha256'],'parts':[]}
  with target.open('rb') as f:
   i=1
   while True:
    b=f.read(90*1024*1024)
    if not b:break
    p=parts/(target.name+f'.part{i:02d}');p.write_bytes(b)
    record['parts'].append({'file':p.name,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()});i+=1
  # Verify published bytes reconstruct exactly the full local offline ZIP.
  h=hashlib.sha256()
  for p in record['parts']:
   with (parts/p['file']).open('rb') as f:
    for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
  assert h.hexdigest()==record['sha256']
  if platform=='windows':
   expression="(Get-FileHash -LiteralPath '"+target.name+"' -Algorithm SHA256).Hash -eq '"+record['sha256']+"'"
   command='@echo off\r\ncd /d "%~dp0"\r\ncopy /b '+ '+'.join('"'+p['file']+'"' for p in record['parts'])+' "'+target.name+'"\r\nif errorlevel 1 exit /b 1\r\npowershell -NoProfile -Command "if ('+expression+") { Write-Host 'SHA256 OK. Extract the complete ZIP, then open SSH-Relay-Near or Far.' } else { Write-Error 'SHA256 mismatch'; exit 1 }"+'"\r\nif errorlevel 1 exit /b 1\r\npause\r\n'
   (parts/'ASSEMBLE-WINDOWS.cmd').write_bytes(command.encode())
  else:
   command='#!/bin/sh\nset -eu\ncd "$(dirname "$0")"\ncat '+' '.join("'"+p['file']+"'" for p in record['parts'])+" > '"+target.name+"'\nprintf '%s\\n' '"+record['sha256']+'  '+target.name+"' | sha256sum -c -\nprintf '%s\\n' 'Extract the complete ZIP, then open SSH-Relay-Near or Far.'\n"
   (parts/'ASSEMBLE-LINUX.sh').write_text(command);(parts/'ASSEMBLE-LINUX.sh').chmod(0o755)
  manifest['archives'].append(record);print(target.name,record['bytes'],record['sha256'],flush=True)
 (parts/'MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n')
 (parts/'README.md').write_text('''# 完整离线运行包\n\n完整应用与官方 Node/Electron 均已上传；GitHub 单文件限制要求将完整 ZIP 无损分卷，每卷最多 90 MiB。下载本目录对应平台的全部 .part 文件和 ASSEMBLE 脚本到同一目录。Windows 双击 ASSEMBLE-WINDOWS.cmd；Linux 执行 sh ASSEMBLE-LINUX.sh。脚本本地合并并校验完整 SHA-256，不下载、不安装、不修改环境配置。解压生成的完整 ZIP，保留整个应用目录，运行 SSH-Relay-Near 或 SSH-Relay-Far。Linux 保留执行权限。\n\n无需 Node、npm、账号或付费。离线启动界面无需下载组件；实际公网连接仍需可访问公共 WSS 中继。MANIFEST.json 记录各分卷及完整 ZIP 的大小和 SHA-256。源码另见 ../source.zip。不要把运行后生成的私密状态、密钥、配对码、报告或日志上传。\n''')
if __name__=='__main__':main()
