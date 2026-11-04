@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0"
set "CONNECTOR_DIR=%ROOT%symbiot-connector-service"
set "DESKTOP_DIR=%ROOT%symbiot-desktop-shell"
if not exist "%CONNECTOR_DIR%\server.js" set "CONNECTOR_DIR=%ROOT%connector-service"
if not exist "%DESKTOP_DIR%\main.js" set "DESKTOP_DIR=%ROOT%desktop-shell"
set "RUNTIME_LOGS=%ROOT%runtime_logs"
set "PORT=%~1"
if "%PORT%"=="" if defined SYMBIOT_CONNECTOR_PORT set "PORT=%SYMBIOT_CONNECTOR_PORT%"
if "%PORT%"=="" set "PORT=8787"
set "ELECTRON_EXE=%DESKTOP_DIR%\node_modules\electron\dist\electron.exe"
set "ELECTRON_CMD=%DESKTOP_DIR%\node_modules\.bin\electron.cmd"

where node >nul 2>nul
if errorlevel 1 (
  if exist "%ELECTRON_EXE%" (
    set "SYMBIOT_NODE_EXE=%ELECTRON_EXE%"
    set "SYMBIOT_NODE_USES_ELECTRON=1"
  ) else (
    echo [Симбиот] Node.js не найден и desktop runtime не установлен.
    echo [Симбиот] Запустите пакет с установленным runtime или установите Node.js LTS.
    pause
    exit /b 1
  )
  goto :node_ready
)

for /f "delims=" %%N in ('where node') do (
  set "SYMBIOT_NODE_EXE=%%N"
  goto :node_found
)
:node_found
:node_ready

if not exist "%CONNECTOR_DIR%\server.js" (
  echo [Симбиот] Не найден connector service: %CONNECTOR_DIR%\server.js
  pause
  exit /b 1
)

if not exist "%DESKTOP_DIR%\main.js" (
  echo [Симбиот] Не найден desktop shell: %DESKTOP_DIR%\main.js
  pause
  exit /b 1
)

cd /d "%DESKTOP_DIR%"

if not exist "%ELECTRON_EXE%" if not exist "%ELECTRON_CMD%" (
  echo [Симбиот] Первый запуск: устанавливаю desktop runtime...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [Симбиот] Не удалось установить desktop runtime.
    pause
    exit /b 1
  )
)

if not exist "%RUNTIME_LOGS%" mkdir "%RUNTIME_LOGS%"

set "SYMBIOT_CONNECTOR_DIR=%CONNECTOR_DIR%"
set "SYMBIOT_CONNECTOR_PORT=%PORT%"
if not defined SYMBIOT_APP_URL set "SYMBIOT_APP_URL=http://127.0.0.1:%PORT%/app?shell=desktop"
if not defined SYMBIOT_DESKTOP_BOOT_STATUS_OUTPUT set "SYMBIOT_DESKTOP_BOOT_STATUS_OUTPUT=%RUNTIME_LOGS%\SYM_DESKTOP_BOOT_STATUS_CURRENT.json"

echo [Симбиот] Запускаю desktop GUI на http://127.0.0.1:%PORT%/app
if exist "%ELECTRON_EXE%" (
  call "%ELECTRON_EXE%" "%DESKTOP_DIR%"
) else (
  call "%ELECTRON_CMD%" "%DESKTOP_DIR%"
)

endlocal
