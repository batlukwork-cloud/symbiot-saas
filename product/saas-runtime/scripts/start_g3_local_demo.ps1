param(
  [int]$BackendPort = 8020,
  [int]$FrontendPort = 3020
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$RuntimeLogs = Join-Path $Root "runtime_logs"
$PidFile = Join-Path $RuntimeLogs "g3_local_demo_pids.json"
$BackendStdout = Join-Path $RuntimeLogs "g3_local_demo_backend_stdout.log"
$BackendStderr = Join-Path $RuntimeLogs "g3_local_demo_backend_stderr.log"
$FrontendStdout = Join-Path $RuntimeLogs "g3_local_demo_frontend_stdout.log"
$FrontendStderr = Join-Path $RuntimeLogs "g3_local_demo_frontend_stderr.log"

New-Item -ItemType Directory -Force -Path $RuntimeLogs | Out-Null
Remove-Item $BackendStdout,$BackendStderr,$FrontendStdout,$FrontendStderr -ErrorAction SilentlyContinue

$Python = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
  throw "Backend Python was not found: $Python"
}

$Npm = "npm.cmd"
$BackendArgs = @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$BackendPort")
$FrontendEnv = "NEXT_PUBLIC_API_BASE=http://127.0.0.1:$BackendPort"

$backendProcess = Start-Process -FilePath $Python -ArgumentList $BackendArgs -WorkingDirectory $Backend -PassThru -WindowStyle Hidden -RedirectStandardOutput $BackendStdout -RedirectStandardError $BackendStderr

$frontendArgs = @("run", "dev", "--", "--hostname", "127.0.0.1", "--port", "$FrontendPort")
$previousApiBase = $env:NEXT_PUBLIC_API_BASE
$env:NEXT_PUBLIC_API_BASE = "http://127.0.0.1:$BackendPort"
$frontendProcess = Start-Process -FilePath $Npm -ArgumentList $frontendArgs -WorkingDirectory $Frontend -PassThru -WindowStyle Hidden -RedirectStandardOutput $FrontendStdout -RedirectStandardError $FrontendStderr
if ($null -eq $previousApiBase) {
  Remove-Item Env:\NEXT_PUBLIC_API_BASE -ErrorAction SilentlyContinue
} else {
  $env:NEXT_PUBLIC_API_BASE = $previousApiBase
}

$backendReady = $false
$frontendReady = $false
for ($i = 0; $i -lt 40; $i++) {
  try {
    $backendResponse = Invoke-WebRequest -Uri "http://127.0.0.1:$BackendPort/health" -UseBasicParsing -TimeoutSec 2
    if ($backendResponse.StatusCode -eq 200) { $backendReady = $true }
  } catch {}
  try {
    $frontendResponse = Invoke-WebRequest -Uri "http://127.0.0.1:$FrontendPort/" -UseBasicParsing -TimeoutSec 2
    if ($frontendResponse.StatusCode -eq 200) { $frontendReady = $true }
  } catch {}
  if ($backendReady -and $frontendReady) { break }
  Start-Sleep -Seconds 1
}

$backendPortPid = (Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)
$frontendPortPid = (Get-NetTCPConnection -LocalPort $FrontendPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)

if (-not ($backendReady -and $frontendReady)) {
  foreach ($processId in @($backendProcess.Id, $frontendProcess.Id, $backendPortPid, $frontendPortPid)) {
    if ($processId) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
  }
  throw "G3 local demo failed readiness check. BackendReady=$backendReady FrontendReady=$frontendReady. See logs in $RuntimeLogs"
}

$state = [ordered]@{
  mode = "local_only"
  backend_url = "http://127.0.0.1:$BackendPort"
  frontend_url = "http://127.0.0.1:$FrontendPort"
  backend_port = $BackendPort
  frontend_port = $FrontendPort
  backend_pid = $backendProcess.Id
  frontend_pid = $frontendProcess.Id
  backend_port_pid = $backendPortPid
  frontend_port_pid = $frontendPortPid
  frontend_api_env = $FrontendEnv
  backend_ready = $backendReady
  frontend_ready = $frontendReady
  backend_stdout = $BackendStdout
  backend_stderr = $BackendStderr
  frontend_stdout = $FrontendStdout
  frontend_stderr = $FrontendStderr
  started_at = (Get-Date).ToString("o")
  stop_script = (Join-Path $Root "scripts\stop_g3_local_demo.ps1")
}

$state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $PidFile -Encoding UTF8
Write-Host "G3 local demo started"
Write-Host "Backend:  http://127.0.0.1:$BackendPort"
Write-Host "Frontend: http://127.0.0.1:$FrontendPort"
Write-Host "PID file: $PidFile"
