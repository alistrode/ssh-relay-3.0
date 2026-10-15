[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtime = Join-Path $root 'runtime'
$cloudflared = Join-Path $runtime 'cloudflared.exe'
$portableSsh = Join-Path $root 'portable-ssh.ps1'
$clientKey = Join-Path $root 'codex_client_ed25519'
$tunnelLog = Join-Path $root 'cloudflared.log'
$tunnelPid = Join-Path $root 'cloudflared.pid'
$hostnameFile = Join-Path $root 'cloudflare-hostname.txt'
$connectionFile = Join-Path $root 'cloudflare-connection.txt'

if (-not (Test-Path -LiteralPath $cloudflared)) { throw "Missing cloudflared.exe: $cloudflared" }
if (-not (Test-Path -LiteralPath $portableSsh)) { throw "Missing portable-ssh.ps1: $portableSsh" }

Write-Host '=================================================' -ForegroundColor Cyan
Write-Host ' Portable SSH over Cloudflare - Remote Windows 10' -ForegroundColor Cyan
Write-Host '=================================================' -ForegroundColor Cyan

Write-Host '[1/4] Starting loopback-only portable SSH...' -ForegroundColor Yellow
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $portableSsh -SkipFirewall -ListenAddress '127.0.0.1' -Restart -NoConnectionBundle
if ($LASTEXITCODE -ne 0) { throw 'Portable SSH failed to start.' }

Write-Host '[2/4] Starting outbound Cloudflare Tunnel over HTTP/2...' -ForegroundColor Yellow
if (Test-Path -LiteralPath $tunnelPid) {
    $oldPid = (Get-Content -Raw -LiteralPath $tunnelPid).Trim()
    if ($oldPid -match '^\d+$') {
        $oldProcess = Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue
        if ($oldProcess) { Stop-Process -Id $oldProcess.Id -Force -ErrorAction SilentlyContinue }
    }
}
[IO.File]::WriteAllText($tunnelLog, '', [Text.UTF8Encoding]::new($false))
$arguments = @(
    'tunnel', '--url', 'ssh://127.0.0.1:22222', '--protocol', 'http2',
    '--no-autoupdate', '--loglevel', 'info', '--logfile', ('"' + $tunnelLog + '"')
)
$tunnel = Start-Process -FilePath $cloudflared -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -PassThru
[IO.File]::WriteAllText($tunnelPid, $tunnel.Id.ToString(), [Text.ASCIIEncoding]::new())

Write-Host '[3/4] Waiting for the Cloudflare hostname and edge connection...' -ForegroundColor Yellow
$hostname = $null
$registered = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    if ($tunnel.HasExited) {
        $details = if (Test-Path -LiteralPath $tunnelLog) { (Get-Content -LiteralPath $tunnelLog -Tail 80) -join "`n" } else { 'No Cloudflare log was created.' }
        throw "cloudflared exited during startup.`n$details"
    }
    $logText = Get-Content -Raw -LiteralPath $tunnelLog -ErrorAction SilentlyContinue
    if (-not $hostname) {
        $match = [regex]::Match($logText, 'https://([-a-z0-9]+\.trycloudflare\.com)')
        if ($match.Success) { $hostname = $match.Groups[1].Value }
    }
    if ($logText -match 'Registered tunnel connection') { $registered = $true }
    if ($hostname -and $registered) { break }
}
if (-not $hostname) { throw 'Cloudflare did not return a Quick Tunnel hostname within 60 seconds.' }
if (-not $registered) { throw 'Cloudflare hostname was created, but the edge connection did not become ready.' }

Write-Host '[4/4] Preparing the Codex connection bundle...' -ForegroundColor Yellow
$privateKey = Get-Content -Raw -LiteralPath $clientKey
$sshUser = $env:USERNAME
$bundle = @"
========== MCP_CLOUDFLARE_SSH_BEGIN ==========
NAME=win10_cloudflare
HOSTNAME=$hostname
USER=$sshUser
LOCAL_PORT=22022
PRIVATE_KEY_BEGIN
$($privateKey.TrimEnd())
PRIVATE_KEY_END
========== MCP_CLOUDFLARE_SSH_END ==========
"@
[IO.File]::WriteAllText($hostnameFile, $hostname + "`r`n", [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($connectionFile, $bundle + "`r`n", [Text.UTF8Encoding]::new($false))
Set-Clipboard -Value $bundle

Write-Host ''
Write-Host $bundle
Write-Host ''
Write-Host 'Cloudflare SSH is ready. The complete block is copied to the clipboard.' -ForegroundColor Green
Write-Host 'Keep the portable folder on this computer; the hidden SSH and tunnel processes are running.' -ForegroundColor Green
