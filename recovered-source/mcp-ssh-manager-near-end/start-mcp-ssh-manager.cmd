@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-mcp-ssh-manager.ps1" %*
if errorlevel 1 (
  echo.
  echo MCP SSH Manager failed to start. Review the message above.
  pause
)
endlocal
