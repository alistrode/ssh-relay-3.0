#!/usr/bin/env python3
"""Portable preview: included Node bootstrap, checksum-verified Electron on first run."""
from pathlib import Path
import hashlib, json, subprocess, tempfile, zipfile, tarfile, io, stat, struct
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'deliverables'
def shortcut(relative):
    value=struct.pack('<I',76)+bytes.fromhex('0114020000000000c000000000000046')
    value+=struct.pack('<IIQQQIiIHHII',0xD8,0x20,0,0,0,0,0,1,0,0,0,0)
    for text in [relative,'.','assets\\relay.ico']: value+=struct.pack('<H',len(text))+text.encode('utf-16le')
    return value+struct.pack('<I',0)
def main():
    OUT.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='paired-package-') as tmp:
        stage=Path(tmp)
        esbuild=str(ROOT/'node_modules/.bin/esbuild')
        flags=['--bundle','--platform=node','--target=node22','--legal-comments=external','--external:cpu-features','--external:./crypto/build/Release/sshcrypto.node']
        subprocess.run([esbuild,*['src/'+x for x in ['start.cjs','near.cjs','paired-agent.cjs']],*flags,'--minify','--outdir='+str(stage/'src'),'--out-extension:.js=.cjs'],cwd=ROOT,check=True)
        for source,name in [('main.cjs','main.cjs'),('bootstrap.cjs','bootstrap.cjs')]:
            subprocess.run([esbuild,'src/desktop/'+source,*flags,'--external:electron','--outfile='+str(stage/'src/desktop'/name)],cwd=ROOT,check=True)
        files={str(p.relative_to(stage)):p.read_bytes() for p in stage.rglob('*') if p.is_file()}
        for name in ['src/desktop/preload.cjs','src/desktop/index.html','src/desktop/style.css','src/desktop/renderer.js','desktop-package/package.json','assets/paired.png','assets/relay.ico','assets/electron-runtime-inputs.json','docs/PAIRED-RELAY-MANUAL.md','docs/PAIRED-RELAY-REQUIREMENTS.md']:
            files[name]=(ROOT/name).read_bytes()
        for name in ['docs/PAIRED-RELAY-VALIDATION.md','docs/PAIRED-RELAY-RESULTS.json']:
            if (ROOT/name).is_file(): files[name]=(ROOT/name).read_bytes()
        for p in (ROOT/'node_modules').rglob('*'):
            if p.is_file() and p.name.upper().startswith(('LICENSE','NOTICE','COPYING')):
                files['licenses/'+str(p.relative_to(ROOT/'node_modules'))]=p.read_bytes()
        hashes={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','src','assets/electron-runtime-inputs.json'],cwd=ROOT,text=True).splitlines() if (ROOT/name).is_file()}
        files['BUILD.json']=(json.dumps({'version':'2.0.0-preview.1','applicationSourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'transport':'existing MQTT WSS + SSH protocol 2','registrationRequired':False,'selfHostedServerRequired':False,'includedRuntime':'official Node 22 bootstrap','firstRunDownload':'Electron 44.8.0, pinned official SHA-256; no global install','applicationSourceSha256':hashes},indent=2)+'\n').encode()
        for platform in ['windows','linux']:
            content=files.copy()
            with zipfile.ZipFile(OUT/('remote-'+platform+'-x64.zip')) as old:
                for name in ['runtime/'+('node.exe' if platform=='windows' else 'node'),'runtime/LICENSE']:
                    content[name]=old.read(name)
            if platform=='windows':
                for role in ['Near','Far']:
                    name='SSH-Relay-'+role+'.vbs';content[name]=(ROOT/'launchers'/name).read_bytes();content['SSH-Relay-'+role+'.lnk']=shortcut(name)
            else:
                binary=stage/'paired-launcher'
                subprocess.run(['gcc','-Os','-static','-s','-Wall','-Wextra',str(ROOT/'launchers/paired-linux.c'),'-o',str(binary)],check=True)
                for role in ['Near','Far']:content['SSH-Relay-'+role]=binary.read_bytes()
            content['README.txt']=('配对式公网 SSH — 增强预览版\n\nWindows 双击 SSH-Relay-Near.lnk（近端）或 SSH-Relay-Far.lnk（远端）；Linux 双击同名无扩展名原生程序。首次启动自动下载并校验界面组件，Windows 约 152 MiB，Linux 约 118 MiB；期间请等待，不需要注册账号、购买服务、另装 Node 或 npm。不修改系统网络配置，不全局安装 Electron。下载失败查看本目录 .runtime-setup-status.json。已内置 Node 22 用于首次准备组件；界面组件自带 Node 24。保留完整解压目录。\n\n远端生成一次性配对码，近端输入一次；以后自动连接选中的已配对电脑。关闭面板后保留托盘，显式退出停止。自启开关是用户登录后静默启动，不是登录前系统服务。Linux 桌面需支持系统托盘。\n\n不要覆盖正在运行的旧版目录；先解压到新目录。默认私密状态为用户目录 .ssh-relay-paired/near 或 far；绝不上传状态、配对码、连接报告或原始日志。每台远端最多 16 个独立配对链路。近端删除本地记忆不等于远端撤权；远端可撤销全部配对。\n\n公共中继没有 SLA；恢复连接不自动重放部署或写入。验证范围与限制见 docs/PAIRED-RELAY-MANUAL.md 及仓库的验收记录。\n').encode()
            def mode(name):return 0o755 if name in ['runtime/node','SSH-Relay-Near','SSH-Relay-Far'] else 0o644
            target=OUT/('paired-'+platform+'-x64.zip')
            with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
                for name,data in sorted(content.items()):
                    entry=zipfile.ZipInfo(name);entry.create_system=3;entry.compress_type=zipfile.ZIP_DEFLATED;entry.external_attr=(stat.S_IFREG|mode(name))<<16;z.writestr(entry,data)
            if platform=='linux':
                with tarfile.open(OUT/'paired-linux-x64.tar.gz','w:gz') as archive:
                    for name,data in sorted(content.items()):
                        entry=tarfile.TarInfo('SSH-Relay-Paired-Linux/'+name);entry.size=len(data);entry.mode=mode(name);archive.addfile(entry,io.BytesIO(data))
            print(target.name,target.stat().st_size,flush=True)
    (OUT/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in sorted(list(OUT.glob('*.zip'))+list(OUT.glob('*.tar.gz')))))
if __name__=='__main__':main()
