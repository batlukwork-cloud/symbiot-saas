@echo off
setlocal
cd /d "%~dp0"
echo Starting Symbiot Connector Service and opening http://127.0.0.1:8787/app
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js LTS, then run this file again.
  pause
  exit /b 1
)
start "Symbiot Connector" /min node server.js
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8787/app"
endlocal
