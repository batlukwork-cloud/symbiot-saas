$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PidFile = Join-Path $Root "runtime_logs\g3_local_demo_pids.json"

if (-not (Test-Path $PidFile)) {
  Write-Host "No G3 local demo PID file found."
  exit 0
}

$state = Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json
$portPids = @()
foreach ($port in @($state.backend_port, $state.frontend_port, 8020, 3020)) {
  if ($port) {
    $portPids += Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess
  }
}

foreach ($processId in @($state.backend_pid, $state.frontend_pid, $state.backend_port_pid, $state.frontend_port_pid) + $portPids) {
  if ($processId) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
      Stop-Process -Id $processId -Force
      Write-Host "Stopped process $processId"
    }
  }
}

Remove-Item -LiteralPath $PidFile -Force
Write-Host "G3 local demo stopped."
