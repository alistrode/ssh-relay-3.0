@echo off
cd /d "%~dp0"
copy /b "paired-windows-x64-offline.zip.part01"+"paired-windows-x64-offline.zip.part02"+"paired-windows-x64-offline.zip.part03" "paired-windows-x64-offline.zip"
if errorlevel 1 exit /b 1
powershell -NoProfile -Command "if ((Get-FileHash -LiteralPath 'paired-windows-x64-offline.zip' -Algorithm SHA256).Hash -eq '91710e7aa29765e4e74492e8b335910d9e1eb9322b7cdfb8e1191648708937b4') { Write-Host 'SHA256 OK. Extract the complete ZIP, then open SSH-Relay-Near or Far.' } else { Write-Error 'SHA256 mismatch'; exit 1 }"
if errorlevel 1 exit /b 1
pause
