@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$p='%~dp0data\cloudflared-access.pid'; if(Test-Path -LiteralPath $p){$proxyPid=[int](Get-Content -Raw -LiteralPath $p); Stop-Process -Id $proxyPid -Force -ErrorAction SilentlyContinue}; Write-Host 'Local Cloudflare proxy stopped.'"
pause
endlocal
