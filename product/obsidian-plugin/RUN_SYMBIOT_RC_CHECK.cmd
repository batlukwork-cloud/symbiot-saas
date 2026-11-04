@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0"
set "SCRIPT=%ROOT%RUN_SYMBIOT_RC_CHECK.ps1"

if not exist "%SCRIPT%" (
  echo [Симбиот] Не найден RUN_SYMBIOT_RC_CHECK.ps1
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
if errorlevel 1 (
  echo.
  echo [Симбиот] Release Candidate check завершился с ошибками. Отчет лежит в runtime_logs.
  pause
  exit /b 1
)

echo.
echo [Симбиот] Release Candidate check пройден. Отчет лежит в runtime_logs.
pause
endlocal
