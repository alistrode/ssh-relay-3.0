[CmdletBinding()]
param(
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverEntry = Join-Path $projectRoot 'src\index.js'
$sshConfig = Join-Path $env:USERPROFILE '.codex\ssh-config.toml'

Set-Location -LiteralPath $projectRoot

Write-Host '============================================' -ForegroundColor Cyan
Write-Host ' MCP SSH Manager - One-click Start' -ForegroundColor Cyan
Write-Host '============================================' -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 18 or newer is required.'
}

if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
    throw 'Codex CLI is required.'
}

if (-not $SkipInstall -and -not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
    Write-Host '[1/3] Installing locked dependencies...' -ForegroundColor Yellow
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
} else {
    Write-Host '[1/3] Dependencies are ready.' -ForegroundColor Green
}

$sshConfigDir = Split-Path -Parent $sshConfig
if (-not (Test-Path -LiteralPath $sshConfigDir)) {
    New-Item -ItemType Directory -Path $sshConfigDir -Force | Out-Null
}
if (-not (Test-Path -LiteralPath $sshConfig)) {
    @'
# MCP SSH Manager server definitions.
# Add one or more [ssh_servers.NAME] sections here.
'@ | Set-Content -LiteralPath $sshConfig -Encoding UTF8
}

$registered = codex mcp get mcp-ssh-manager 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host '[2/3] Registering MCP server with Codex...' -ForegroundColor Yellow
    $nodePath = (Get-Command node).Source
    codex mcp add mcp-ssh-manager --env "SSH_CONFIG_PATH=$sshConfig" -- $nodePath $serverEntry
    if ($LASTEXITCODE -ne 0) { throw 'Codex MCP registration failed.' }
} else {
    Write-Host '[2/3] Codex MCP registration is ready.' -ForegroundColor Green
}

Write-Host '[3/3] Starting the MCP SSH Manager interface...' -ForegroundColor Green
Write-Host "Server config: $sshConfig" -ForegroundColor DarkGray
Write-Host 'Use Ctrl+C to exit the interface.' -ForegroundColor DarkGray

$gitBashUi = 'C:\Program Files\Git\git-bash.exe'
if (Test-Path -LiteralPath $gitBashUi) {
    $drive = $projectRoot.Substring(0, 1).ToLowerInvariant()
    $rest = $projectRoot.Substring(2).Replace('\', '/')
    $cliScript = "/$drive$rest/cli/ssh-manager"
    $bashCommand = "'$cliScript' --interactive; exec bash"
    Start-Process -FilePath $gitBashUi -ArgumentList @('-c', $bashCommand)
    Write-Host 'MCP SSH Manager is running in the Git Bash window.' -ForegroundColor Cyan
} else {
    node (Join-Path $projectRoot 'cli\ssh-manager.js') --interactive
}
