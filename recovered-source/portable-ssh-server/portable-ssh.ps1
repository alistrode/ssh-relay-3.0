[CmdletBinding()]
param(
    [switch]$SkipFirewall,
    [string]$ListenAddress = '0.0.0.0',
    [switch]$Restart,
    [switch]$NoConnectionBundle
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtime = Join-Path $root 'runtime\OpenSSH-Win64'
$sshd = Join-Path $runtime 'sshd.exe'
$sshKeygen = Join-Path $runtime 'ssh-keygen.exe'
$sftpServer = Join-Path $runtime 'sftp-server.exe'
$hostKey = Join-Path $root 'ssh_host_ed25519_key'
$clientKey = Join-Path $root 'codex_client_ed25519'
$authorizedKeys = Join-Path $root 'authorized_keys'
$configPath = Join-Path $root 'sshd_config'
$logPath = Join-Path $root 'sshd.log'
$pidPath = Join-Path $root 'sshd.pid'
$port = 22222
$sshUser = $env:USERNAME

function Invoke-Keygen([string[]]$Arguments) {
    $process = Start-Process -FilePath $sshKeygen -ArgumentList $Arguments -NoNewWindow -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw 'SSH key generation failed.' }
}

if (-not (Test-Path -LiteralPath $sshd)) {
    throw "Portable SSH runtime is missing: $sshd"
}

Write-Host '============================================' -ForegroundColor Cyan
Write-Host ' Portable SSH Server - One Folder Edition' -ForegroundColor Cyan
Write-Host '============================================' -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $hostKey)) {
    Write-Host '[1/4] Creating the server key...' -ForegroundColor Yellow
    Invoke-Keygen @('-q', '-t', 'ed25519', '-N', '""', '-f', ('"' + $hostKey + '"'))
} else {
    Write-Host '[1/4] Server key is ready.' -ForegroundColor Green
}

if (-not (Test-Path -LiteralPath $clientKey)) {
    Write-Host '[2/4] Creating the Codex connection key...' -ForegroundColor Yellow
    Invoke-Keygen @('-q', '-t', 'ed25519', '-N', '""', '-C', 'mcp-ssh-manager', '-f', ('"' + $clientKey + '"'))
} else {
    Write-Host '[2/4] Codex connection key is ready.' -ForegroundColor Green
}

$publicKey = (Get-Content -Raw -LiteralPath "$clientKey.pub").Trim()
[IO.File]::WriteAllText($authorizedKeys, $publicKey + "`r`n", [Text.ASCIIEncoding]::new())

$hostKeyConfig = $hostKey.Replace('\', '/')
$authorizedKeysConfig = $authorizedKeys.Replace('\', '/')
$sftpConfig = $sftpServer.Replace('\', '/')
$config = @"
Port $port
ListenAddress $ListenAddress
HostKey "$hostKeyConfig"
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
AuthorizedKeysFile "$authorizedKeysConfig"
StrictModes no
AllowUsers $sshUser
Subsystem sftp "$sftpConfig"
LogLevel INFO
"@
[IO.File]::WriteAllText($configPath, $config, [Text.UTF8Encoding]::new($false))

Write-Host '[3/4] Opening the private firewall port...' -ForegroundColor Yellow
if ($SkipFirewall) {
    Write-Host '[3/4] Firewall change skipped for local validation.' -ForegroundColor DarkGray
} elseif (-not (Get-NetFirewallRule -Name 'Portable-MCP-SSH' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name 'Portable-MCP-SSH' -DisplayName 'Portable MCP SSH Server' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort $port | Out-Null
}

$running = $null
if (Test-Path -LiteralPath $pidPath) {
    $oldPid = (Get-Content -Raw -LiteralPath $pidPath).Trim()
    if ($oldPid -match '^\d+$') { $running = Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue }
}
if ($Restart -and $running) {
    Stop-Process -Id $running.Id -Force -ErrorAction SilentlyContinue
    $running.WaitForExit(5000) | Out-Null
    $running = $null
}
if (-not $running) {
    Write-Host '[4/4] Starting the portable SSH process...' -ForegroundColor Yellow
    $process = Start-Process -FilePath $sshd -ArgumentList @('-D', '-f', ('"' + $configPath + '"'), '-E', ('"' + $logPath + '"')) -WorkingDirectory $root -WindowStyle Hidden -PassThru
    [IO.File]::WriteAllText($pidPath, $process.Id.ToString(), [Text.ASCIIEncoding]::new())
    Start-Sleep -Milliseconds 800
    if ($process.HasExited) {
        $details = if (Test-Path -LiteralPath $logPath) { (Get-Content -LiteralPath $logPath -Tail 40) -join "`n" } else { 'No sshd log was created.' }
        throw "Portable SSH exited during startup.`n$details"
    }
} else {
    Write-Host '[4/4] Portable SSH is already running.' -ForegroundColor Green
}

if (-not $NoConnectionBundle) {
    $hostAddress = $null
    try { $hostAddress = (Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 5).ToString().Trim() } catch {}
    if ([string]::IsNullOrWhiteSpace($hostAddress)) {
        $hostAddress = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
            Select-Object -ExpandProperty IPAddress -First 1
    }
    $privateKey = Get-Content -Raw -LiteralPath $clientKey

    Write-Host ''
    Write-Host '========== MCP_SSH_CONNECT_INFO_BEGIN ==========' -ForegroundColor Cyan
    Write-Host 'NAME=win10_portable'
    Write-Host "HOST=$hostAddress"
    Write-Host "PORT=$port"
    Write-Host "USER=$sshUser"
    Write-Host 'PRIVATE_KEY_BEGIN'
    Write-Host $privateKey.TrimEnd()
    Write-Host 'PRIVATE_KEY_END'
    Write-Host '========== MCP_SSH_CONNECT_INFO_END ==========' -ForegroundColor Cyan
    Write-Host ''
    Write-Host 'Portable SSH is running. Copy the complete block above.' -ForegroundColor Green
}
