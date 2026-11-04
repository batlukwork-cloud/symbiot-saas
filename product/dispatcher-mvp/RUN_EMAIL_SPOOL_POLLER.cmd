@echo off
setlocal
set "NODE_EXE=node"
set "SCRIPT_DIR=%~dp0"
"%NODE_EXE%" "%SCRIPT_DIR%01_CONNECTOR_SERVICE\email_spool_poller.js"
