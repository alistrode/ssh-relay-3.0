@echo off
setlocal
cd /d "%~dp0"
"runtime\node.exe" "app\start.cjs"
set "relay_exit=%errorlevel%"
pause
exit /b %relay_exit%
