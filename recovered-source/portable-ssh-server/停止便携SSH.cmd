@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$p='%~dp0sshd.pid'; if(Test-Path -LiteralPath $p){$id=[int](Get-Content -Raw -LiteralPath $p); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue}; Write-Host 'Portable SSH stopped.'"
pause
endlocal
