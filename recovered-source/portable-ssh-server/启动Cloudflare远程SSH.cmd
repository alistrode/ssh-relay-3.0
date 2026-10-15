@echo off
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -WorkingDirectory '%~dp0' -Verb RunAs"
  exit /b
)

title Portable SSH over Cloudflare
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-cloudflare-ssh.ps1"
echo.
pause
endlocal

