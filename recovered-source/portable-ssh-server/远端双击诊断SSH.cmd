@echo off
setlocal
cd /d "%~dp0"
title Portable SSH Diagnostics
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnose-portable-ssh.ps1"
echo.
echo The complete diagnostic report has been copied to the clipboard.
echo Paste it back into Codex.
pause
endlocal

