[CmdletBinding()]
param(
    [switch]$SkipCodexWrite,
    [switch]$NoUi
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtime = Join-Path $root 'runtime'
$cloudflared = Join-Path $runtime 'cloudflared.exe'
$ssh = Join-Path $runtime 'OpenSSH-Win64\ssh.exe'
$dataDir = Join-Path $root 'data'
$keyPath = Join-Path $dataDir 'win10_cloudflare_ed25519'
$proxyPidPath = Join-Path $dataDir 'cloudflared-access.pid'
$proxyLog = Join-Path $dataDir 'cloudflared-access.log'
$connectionPath = Join-Path $dataDir 'connection.txt'

function Show-Result([string]$Message, [string]$Type = 'Information') {
    if ($NoUi) {
        Write-Host "[$Type] $Message"
    } else {
        [System.Windows.MessageBox]::Show($Message, 'MCP SSH Manager - Cloudflare', 'OK', $Type) | Out-Null
    }
}

function Fail([string]$Message) {
    Show-Result $Message 'Error'
    throw $Message
}

function Read-Field([string]$Bundle, [string]$Name) {
    $match = [regex]::Match($Bundle, "(?m)^$([regex]::Escape($Name))=(.+)$")
    if (-not $match.Success) { Fail "连接信息缺少字段：$Name" }
    return $match.Groups[1].Value.Trim()
}

try {
    if (-not (Test-Path -LiteralPath $cloudflared)) { Fail '本地包缺少 cloudflared.exe。' }
    if (-not (Test-Path -LiteralPath $ssh)) { Fail '本地包缺少 ssh.exe。' }
    $bundle = Get-Clipboard -Raw
    if ($bundle -notmatch 'MCP_CLOUDFLARE_SSH_BEGIN') {
        Fail '剪贴板中没有 Cloudflare SSH 连接包。请先复制远端打印的完整内容。'
    }

    $name = Read-Field $bundle 'NAME'
    $hostname = Read-Field $bundle 'HOSTNAME'
    $sshUser = Read-Field $bundle 'USER'
    $portText = Read-Field $bundle 'LOCAL_PORT'
    $keyMatch = [regex]::Match($bundle, '(?s)PRIVATE_KEY_BEGIN\s*\r?\n(.*?)\r?\nPRIVATE_KEY_END')
    if (-not $keyMatch.Success) { Fail '连接包中没有完整私钥。' }
    $privateKey = $keyMatch.Groups[1].Value.Trim() + "`n"
    if ($hostname -notmatch '^[-a-z0-9]+\.trycloudflare\.com$') { Fail 'Cloudflare 域名格式无效。' }
    if ($sshUser -notmatch '^[A-Za-z_][A-Za-z0-9_.-]*$') { Fail '远端用户名格式无效。' }
    $localPort = 0
    if (-not [int]::TryParse($portText, [ref]$localPort) -or $localPort -lt 1024 -or $localPort -gt 65535) {
        Fail '本地代理端口无效。'
    }

    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    if (Test-Path -LiteralPath $keyPath) {
        & icacls.exe $keyPath /inheritance:r /grant:r "$env:USERNAME`:F" '*S-1-5-18:F' | Out-Null
    }
    [IO.File]::WriteAllText($keyPath, $privateKey, [Text.UTF8Encoding]::new($false))
    & icacls.exe $keyPath /inheritance:r /grant:r "$env:USERNAME`:F" '*S-1-5-18:F' | Out-Null
    [IO.File]::WriteAllText($connectionPath, $bundle, [Text.UTF8Encoding]::new($false))

    if (Test-Path -LiteralPath $proxyPidPath) {
        $oldPid = (Get-Content -Raw -LiteralPath $proxyPidPath).Trim()
        if ($oldPid -match '^\d+$') {
            $oldProxy = Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue
            if ($oldProxy) { Stop-Process -Id $oldProxy.Id -Force -ErrorAction SilentlyContinue }
        }
    }
    [IO.File]::WriteAllText($proxyLog, '', [Text.UTF8Encoding]::new($false))
    $proxyArgs = @(
        'access', 'tcp', '--hostname', $hostname, '--url', "127.0.0.1:$localPort",
        '--loglevel', 'info', '--logfile', ('"' + $proxyLog + '"')
    )
    $proxy = Start-Process -FilePath $cloudflared -ArgumentList $proxyArgs -WorkingDirectory $root -WindowStyle Hidden -PassThru
    [IO.File]::WriteAllText($proxyPidPath, $proxy.Id.ToString(), [Text.ASCIIEncoding]::new())

    $listening = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 300
        if ($proxy.HasExited) {
            $details = if (Test-Path -LiteralPath $proxyLog) { (Get-Content -LiteralPath $proxyLog -Tail 50) -join "`n" } else { '没有代理日志。' }
            Fail "Cloudflare 本地代理启动失败。`n$details"
        }
        if (Get-NetTCPConnection -State Listen -LocalPort $localPort -ErrorAction SilentlyContinue) { $listening = $true; break }
    }
    if (-not $listening) { Fail 'Cloudflare 本地代理未在规定时间内开始监听。' }

    $loginOutput = & $ssh -F NUL -o BatchMode=yes -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o ConnectTimeout=20 -i $keyPath -p $localPort "$sshUser@127.0.0.1" 'whoami & hostname' 2>&1
    if ($LASTEXITCODE -ne 0) { Fail ("Cloudflare 隧道已建立，但 SSH 登录失败。`n" + ($loginOutput -join "`n")) }

    if (-not $SkipCodexWrite) {
        $codexDir = Join-Path $env:USERPROFILE '.codex'
        New-Item -ItemType Directory -Path $codexDir -Force | Out-Null
        $sshConfigPath = Join-Path $codexDir 'ssh-config.toml'
        $keyForToml = $keyPath.Replace('\', '/')
        $sectionName = ($name -replace '[^A-Za-z0-9_-]', '_')
        $section = @"
[ssh_servers.$sectionName]
host = "127.0.0.1"
user = "$sshUser"
key_path = "$keyForToml"
port = $localPort
platform = "windows"
description = "Windows 10 through Cloudflare Tunnel ($hostname)"
mode = "unrestricted"
"@
        $existing = if (Test-Path -LiteralPath $sshConfigPath) { Get-Content -Raw -LiteralPath $sshConfigPath } else { '' }
        $escapedSection = [regex]::Escape($sectionName)
        $existing = [regex]::Replace($existing, "(?ms)^\[ssh_servers\.$escapedSection\]\s*.*?(?=^\[|\z)", '')
        [IO.File]::WriteAllText($sshConfigPath, ($existing.TrimEnd() + "`r`n`r`n" + $section.Trim() + "`r`n"), [Text.UTF8Encoding]::new($false))

        $projectRoot = Split-Path -Parent $root
        $serverEntry = Join-Path $projectRoot 'src\index.js'
        $nodePath = (Get-Command node -ErrorAction Stop).Source
        $codexPath = (Get-Command codex -ErrorAction Stop).Source
        & $codexPath mcp get mcp-ssh-manager *> $null
        if ($LASTEXITCODE -ne 0) {
            & $codexPath mcp add mcp-ssh-manager --env "SSH_CONFIG_PATH=$sshConfigPath" -- $nodePath $serverEntry *> $null
            if ($LASTEXITCODE -ne 0) { Fail 'Codex MCP 注册失败。' }
        }
    }

    $verified = ($loginOutput -join "`n").Trim()
    Show-Result "Cloudflare SSH 已连接成功。`n`n$verified`n`n重新打开 Codex 对话后即可使用服务器：$name"
} catch {
    if ($_.Exception.Message -notlike '连接信息*' -and $_.Exception.Message -notlike 'Cloudflare*' -and $_.Exception.Message -notlike '本地包*') {
        Show-Result $_.Exception.Message 'Error'
    }
    exit 1
}
