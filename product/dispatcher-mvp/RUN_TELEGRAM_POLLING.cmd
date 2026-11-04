@echo off
setlocal
set "NODE_EXE=node"
set "SCRIPT_DIR=%~dp0"
"%NODE_EXE%" "%SCRIPT_DIR%04_TELEGRAM_BOT\telegram_polling_adapter.js"
