[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtime = Join-Path $root 'runtime\OpenSSH-Win64'
$sshd = Join-Path $runtime 'sshd.exe'
$ssh = Join-Path $runtime 'ssh.exe'
$sshKeygen = Join-Path $runtime 'ssh-keygen.exe'
$configPath = Join-Path $root 'sshd_config'
$clientKey = Join-Path $root 'codex_client_ed25519'
$clientPub = "$clientKey.pub"
$authorizedKeys = Join-Path $root 'authorized_keys'
$logPath = Join-Path $root 'sshd.log'
$pidPath = Join-Path $root 'sshd.pid'
$reportPath = Join-Path $root 'diagnostic-result.txt'
$port = 22222
$report = [Collections.Generic.List[string]]::new()

function Emit([object]$Value = '') {
    $text = if ($null -eq $Value) { '' } else { $Value | Out-String -Width 240 }
    $text = $text.TrimEnd("`r", "`n")
    $report.Add($text)
    Write-Host $text
}

function Section([string]$Title) {
    Emit ''
    Emit ("========== " + $Title + " ==========")
}

function Read-SshBanner([string]$Address, [int]$TargetPort) {
    $tcp = [Net.Sockets.TcpClient]::new()
    try {
        $connect = $tcp.ConnectAsync($Address, $TargetPort)
        if (-not $connect.Wait(5000)) { return 'TCP_CONNECT_TIMEOUT' }
        $stream = $tcp.GetStream()
        $stream.ReadTimeout = 5000
        $buffer = New-Object byte[] 256
        try {
            $count = $stream.Read($buffer, 0, $buffer.Length)
            if ($count -le 0) { return 'TCP_CONNECTED_BUT_CLOSED_WITHOUT_SSH_BANNER' }
            return ([Text.Encoding]::ASCII.GetString($buffer, 0, $count)).Trim()
        } catch {
            return 'TCP_CONNECTED_BUT_NO_SSH_BANNER_IN_5_SECONDS'
        }
    } catch {
        return ('TCP_CONNECT_FAILED: ' + $_.Exception.Message)
    } finally {
        $tcp.Dispose()
    }
}

Emit 'MCP PORTABLE SSH DIAGNOSTIC REPORT'
Emit ("Generated: " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'))
Emit ("Folder: " + $root)

Section 'WINDOWS AND USER'
Emit ([pscustomobject]@{
    ComputerName = $env:COMPUTERNAME
    User = "$env:USERDOMAIN\$env:USERNAME"
    IsAdministrator = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    OS = (Get-CimInstance Win32_OperatingSystem).Caption
    OSVersion = [Environment]::OSVersion.VersionString
    Architecture = $env:PROCESSOR_ARCHITECTURE
})

Section 'PORTABLE FILES'
Emit ([pscustomobject]@{
    SshdExe = Test-Path -LiteralPath $sshd
    SshExe = Test-Path -LiteralPath $ssh
    Config = Test-Path -LiteralPath $configPath
    HostKey = Test-Path -LiteralPath (Join-Path $root 'ssh_host_ed25519_key')
    ClientKey = Test-Path -LiteralPath $clientKey
    AuthorizedKeys = Test-Path -LiteralPath $authorizedKeys
    Log = Test-Path -LiteralPath $logPath
})
if (Test-Path -LiteralPath $sshd) { Emit (& $sshd -V 2>&1) }
if (Test-Path -LiteralPath $clientPub) { Emit ('Client key fingerprint: ' + (& $sshKeygen -lf $clientPub 2>&1)) }

Section 'CONFIG VALIDATION'
if ((Test-Path -LiteralPath $sshd) -and (Test-Path -LiteralPath $configPath)) {
    $validation = & $sshd -t -f $configPath 2>&1
    $validationExit = $LASTEXITCODE
    Emit ("sshd -t exit code: $validationExit")
    if ($validation) { Emit $validation } else { Emit 'Configuration syntax accepted.' }
} else {
    Emit 'Cannot validate: sshd.exe or sshd_config is missing.'
}

Section 'PROCESS AND LISTENER'
$pidFromFile = $null
if (Test-Path -LiteralPath $pidPath) { $pidFromFile = (Get-Content -Raw -LiteralPath $pidPath).Trim() }
Emit ("PID file value: " + $(if ($pidFromFile) { $pidFromFile } else { '<missing>' }))
Emit (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'sshd.exe' } | Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine)
Emit (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object State, LocalAddress, LocalPort, RemoteAddress, RemotePort, OwningProcess)

Section 'SSH BANNER TESTS'
$loopbackBanner = Read-SshBanner '127.0.0.1' $port
Emit ("127.0.0.1:$port => $loopbackBanner")
$lanAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -InterfaceOperationalStatus Up -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -ExpandProperty IPAddress -Unique)
foreach ($address in $lanAddresses) {
    Emit ("$address`:$port => " + (Read-SshBanner $address $port))
}

Section 'REAL LOCAL SSH LOGIN'
if ((Test-Path -LiteralPath $ssh) -and (Test-Path -LiteralPath $clientKey)) {
    $loginOutput = & $ssh -F NUL -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o ConnectTimeout=8 -i $clientKey -p $port "$env:USERNAME@127.0.0.1" 'whoami & hostname' 2>&1
    $loginExit = $LASTEXITCODE
    Emit ("SSH login exit code: $loginExit")
    Emit $loginOutput
} else {
    Emit 'Cannot perform login: portable ssh.exe or client key is missing.'
}

Section 'NETWORK ADDRESSES AND ROUTE'
$publicIp = $null
try { $publicIp = (Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 8).ToString().Trim() } catch { Emit ('Public IP lookup failed: ' + $_.Exception.Message) }
Emit ("Public egress IP: " + $(if ($publicIp) { $publicIp } else { '<unknown>' }))
Emit (Get-NetIPConfiguration | Where-Object { $_.IPv4Address } | Select-Object InterfaceAlias, InterfaceDescription, IPv4Address, IPv4DefaultGateway, DNSServer)
Emit (Get-NetConnectionProfile | Select-Object InterfaceAlias, Name, NetworkCategory, IPv4Connectivity, IPv6Connectivity)
if ($publicIp) {
    Emit ("Public self-probe $publicIp`:$port => " + (Read-SshBanner $publicIp $port))
    Emit ("Public IP is assigned directly to this computer: " + ($lanAddresses -contains $publicIp))
}

Section 'WINDOWS FIREWALL'
$rule = Get-NetFirewallRule -Name 'Portable-MCP-SSH' -ErrorAction SilentlyContinue
if ($rule) {
    Emit ($rule | Select-Object Name, DisplayName, Enabled, Profile, Direction, Action)
    Emit ($rule | Get-NetFirewallPortFilter | Select-Object Protocol, LocalPort, RemotePort)
} else {
    Emit 'Portable-MCP-SSH firewall rule is missing.'
}

Section 'ACTIVE FIREWALL PROFILES'
Emit (Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction)

Section 'CONFIG CONTENT (NO PRIVATE KEY)'
if (Test-Path -LiteralPath $configPath) { Emit (Get-Content -Raw -LiteralPath $configPath) } else { Emit '<missing>' }

Section 'FILE PERMISSIONS'
if (Test-Path -LiteralPath $authorizedKeys) { Emit (& icacls.exe $authorizedKeys 2>&1) }
if (Test-Path -LiteralPath $clientKey) { Emit (& icacls.exe $clientKey 2>&1) }

Section 'SSHD LOG'
if (Test-Path -LiteralPath $logPath) {
    try { Emit (Get-Content -LiteralPath $logPath -Tail 300 -ErrorAction Stop) } catch { Emit ('Log read failed: ' + $_.Exception.Message) }
} else {
    Emit '<missing>'
}

Section 'SUMMARY'
$listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
$localLoginOk = $loginExit -eq 0
Emit ([pscustomobject]@{
    SshdListening = [bool]$listener
    LoopbackSshBanner = $loopbackBanner
    LocalKeyLoginSucceeded = $localLoginOk
    PublicEgressIP = $publicIp
    PublicIPDirectlyAssigned = if ($publicIp) { $lanAddresses -contains $publicIp } else { $null }
    PublicProbeResult = if ($publicIp) { Read-SshBanner $publicIp $port } else { '<not tested>' }
})

$finalReport = ($report -join "`r`n") + "`r`n"
[IO.File]::WriteAllText($reportPath, $finalReport, [Text.UTF8Encoding]::new($false))
Set-Clipboard -Value $finalReport
Write-Host ''
Write-Host "Saved: $reportPath" -ForegroundColor Green
Write-Host 'The complete report is now in the clipboard.' -ForegroundColor Green
