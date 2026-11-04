param(
  [int]$Port = 8787
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConnectorDir = Join-Path $Root "symbiot-connector-service"
if (-not (Test-Path -LiteralPath $ConnectorDir)) {
  $ConnectorDir = Join-Path $Root "connector-service"
}
$DesktopDir = Join-Path $Root "symbiot-desktop-shell"
if (-not (Test-Path -LiteralPath $DesktopDir)) {
  $DesktopDir = Join-Path $Root "desktop-shell"
}
$PluginDir = Join-Path $Root "symbiot-obsidian-plugin"
if (-not (Test-Path -LiteralPath $PluginDir)) {
  $PluginDir = Join-Path $Root "obsidian-plugin"
}
$RuntimeLogs = Join-Path $Root "runtime_logs"
New-Item -ItemType Directory -Force -Path $RuntimeLogs | Out-Null

$ReportJson = Join-Path $RuntimeLogs "SYM_OBSIDIAN_PLUGIN_OBP031D_RC_MANUAL_CHECK_2026-07-22.json"
$ReportMd = Join-Path $RuntimeLogs "SYM_OBSIDIAN_PLUGIN_OBP031D_RC_MANUAL_CHECK_2026-07-22.md"
$BaseUrl = "http://127.0.0.1:$Port"

function Test-HttpJson($Uri) {
  try {
    return Invoke-RestMethod -Uri $Uri -TimeoutSec 5
  } catch {
    return $null
  }
}

function Get-HttpText($Uri) {
  try {
    return (Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 8).Content
  } catch {
    return ""
  }
}

function Start-ConnectorIfNeeded {
  $health = Test-HttpJson "$BaseUrl/health"
  if ($health -and $health.ok) {
    return @{ started = $false; health = $health }
  }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    throw "Node.js не найден. Нельзя запустить connector."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $ConnectorDir "server.js"))) {
    throw "Не найден connector server.js: $ConnectorDir"
  }
  $oldPort = $env:SYMBIOT_CONNECTOR_PORT
  $env:SYMBIOT_CONNECTOR_PORT = [string]$Port
  try {
    $process = Start-Process -FilePath $node.Source -ArgumentList "server.js" -WorkingDirectory $ConnectorDir -WindowStyle Hidden -PassThru
  } finally {
    $env:SYMBIOT_CONNECTOR_PORT = $oldPort
  }
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    $health = Test-HttpJson "$BaseUrl/health"
    if ($health -and $health.ok) {
      return @{ started = $true; processId = $process.Id; health = $health }
    }
  }
  throw "Connector не ответил на /health после запуска."
}

$checks = [ordered]@{}
$checks.packageRootExists = Test-Path -LiteralPath $Root
$checks.connectorDirExists = Test-Path -LiteralPath $ConnectorDir
$checks.desktopDirExists = Test-Path -LiteralPath $DesktopDir
$checks.pluginDirExists = Test-Path -LiteralPath $PluginDir
$checks.startDesktopCmdExists = Test-Path -LiteralPath (Join-Path $Root "START_SYMBIOT_DESKTOP.cmd")
$checks.electronRuntimeExists = Test-Path -LiteralPath (Join-Path $DesktopDir "node_modules\.bin\electron.cmd")
$checks.desktopMainExists = Test-Path -LiteralPath (Join-Path $DesktopDir "main.js")
$checks.connectorServerExists = Test-Path -LiteralPath (Join-Path $ConnectorDir "server.js")

$connector = Start-ConnectorIfNeeded
$checks.connectorHealthOk = $null -ne $connector.health -and $connector.health.ok -eq $true

$appHtml = Get-HttpText "$BaseUrl/app?shell=desktop"
$checks.desktopAppReturned = $appHtml.Contains('data-symbiot-app-shell="harnes-desktop-browser-gui"')
$checks.desktopAppHasTools = $appHtml.Contains("LLM Hub") -and $appHtml.Contains("Windows Agent") -and $appHtml.Contains("Admin Sync")
$checks.desktopAppHasThreeWindowLogic = $appHtml.Contains("Math.min(3") -and $appHtml.Contains("＋ окно")
$checks.desktopAppHasThemeSwitch = $appHtml.Contains("themeToggle") -and $appHtml.Contains("светлая")
$checks.desktopAppHasPreview = $appHtml.Contains("previewToggle") -and $appHtml.Contains("Просмотр результата")
$checks.desktopAppHasFullMissionLoop = $appHtml.Contains("/app/mission/confirm") -and $appHtml.Contains("Скорректировать") -and $appHtml.Contains("Подтвердить и запустить") -and $appHtml.Contains("Gateway → Router → Role Registry → Context Builder → Role Runtime → Validator → Trace")
$checks.desktopAppShowsPreLlmRolesAndCost = $appHtml.Contains("Предварительный бюджет") -and $appHtml.Contains("Группа ролей")

$token = ""
if ($appHtml -match 'const token = "([^"]+)"') {
  $token = $Matches[1]
}
$checks.sessionTokenIssued = $token.Length -gt 20

$stateUnauthorizedOk = $false
try {
  Invoke-RestMethod -Uri "$BaseUrl/app/state" -TimeoutSec 5 | Out-Null
} catch {
  $stateUnauthorizedOk = $_.Exception.Response.StatusCode.value__ -eq 401
}
$checks.stateRequiresSession = $stateUnauthorizedOk

$state = $null
if ($token) {
  $state = Test-HttpJson "$BaseUrl/app/state?token=$([uri]::EscapeDataString($token))"
}
$checks.stateWithSessionOk = $null -ne $state -and $state.ok -eq $true -and $state.shell.mode -eq "harnes_desktop_browser_gui"

$qrOk = $false
if ($appHtml -match '<img src="([^"]*/mobile/qr\.svg\?token=[^"]+)"') {
  $qrUrl = $Matches[1].Replace("&amp;", "&")
  $qr = Get-HttpText $qrUrl
  $qrOk = $qr -match "<svg[\s>]"
}
$checks.mobileQrOk = $qrOk

$runtimeOk = $false
if ($token) {
  $body = @{
    token = $token
    source = "obp031d-rc-check"
    approved = $true
    task = "OBP-031D RC check: проверить локальный desktop release candidate."
  } | ConvertTo-Json
  try {
    $runtimeBodyUtf8 = [System.Text.Encoding]::UTF8.GetBytes($body)
    $runtime = Invoke-RestMethod -Uri "$BaseUrl/app/agent-runtime/run" -Method Post -ContentType "application/json; charset=utf-8" -Body $runtimeBodyUtf8 -TimeoutSec 10
    $runtimeOk = $runtime.run.status -eq "completed_yellow"
  } catch {
    $runtimeOk = $false
  }
}
$checks.runtimeRunOk = $runtimeOk

$fullMissionLoopOk = $false
$fullMissionDiagnostics = [ordered]@{
  status = $null
  components = ""
  states = ""
  validation = $null
  rolesCount = 0
  responseKeys = ""
  responseStatus = $null
  error = $null
}
if ($token) {
  $missionBody = @{
    token = $token
    source = "obp031d-rc-check"
    approved = $true
    executeLlm = $false
    live = $false
    missionText = "Подготовить проверяемый план клиентского теста Симбиота и сохранить результат в Obsidian."
    userFields = @{
      expectedArtifact = "план клиентского теста"
      destination = "Obsidian vault / 02_Missions"
      sources = @("D:/approved/SYMBIOT_TEST_SCOPE.md")
      acceptanceCheck = "есть результат, источники, допущения, evidence, ограничения и следующий шаг"
    }
  } | ConvertTo-Json -Depth 6
  try {
    $missionBodyUtf8 = [System.Text.Encoding]::UTF8.GetBytes($missionBody)
    $fullLoop = Invoke-RestMethod -Uri "$BaseUrl/app/mission/full-loop" -Method Post -ContentType "application/json; charset=utf-8" -Body $missionBodyUtf8 -TimeoutSec 20
    $fullMissionDiagnostics.responseKeys = @($fullLoop.PSObject.Properties.Name) -join "|"
    $fullMissionDiagnostics.responseStatus = [string]$fullLoop.status
    $components = @($fullLoop.fullMissionLoop.infrastructureTrace | ForEach-Object { $_.component })
    $states = @($fullLoop.fullMissionLoop.taskMachine.history | ForEach-Object { $_.state })
    $rolesCount = @($fullLoop.fullMissionLoop.roles).Count
    $fullMissionDiagnostics.status = [string]$fullLoop.fullMissionLoop.status
    $fullMissionDiagnostics.components = $components -join "|"
    $fullMissionDiagnostics.states = $states -join "|"
    $fullMissionDiagnostics.validation = [string]$fullLoop.fullMissionLoop.outputValidation.status
    $fullMissionDiagnostics.rolesCount = $rolesCount
    $fullMissionLoopOk = (
      $fullLoop.fullMissionLoop.status -eq "completed_yellow" -and
      ($components -join "|") -eq "Gateway|Router|Role Registry|Context Builder|Role Runtime|Validator|Trace" -and
      ($states -join "|") -eq "CREATED|ROUTING|ROLE_SELECTED|CONTEXT_BUILDING|READY_TO_RUN|EXECUTING|VALIDATING|COMPLETED" -and
      $fullLoop.fullMissionLoop.outputValidation.status -eq "passed_with_conditions" -and
      $rolesCount -ge 2 -and
      $rolesCount -le 5
    )
  } catch {
    $fullMissionDiagnostics.error = $_.Exception.Message
    $fullMissionLoopOk = $false
  }
}
$checks.fullMissionArchitectureLoopOk = $fullMissionLoopOk

$secretPattern = '(sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_\-$]{12,}|AIza[0-9A-Za-z_-]{12,}|postgresql://[^:\s]+:[^@\s]+@)'
$checks.noSecretLeakInApp = -not ($appHtml -match $secretPattern)

$manualChecklist = @(
  "1. Запустить START_SYMBIOT_DESKTOP.cmd.",
  "2. Убедиться, что открылось desktop-окно Симбиот.",
  "3. Проверить слева инструменты: LLM Hub, Context/RAG, Files, Evidence, Mobile, Windows Agent, Admin Sync.",
  "4. В центре описать тестовую миссию обычными словами.",
    "5. Нажать 'Подготовить миссию' и до LLM увидеть контракт, роли, источники, бюджет, паспорт и граф.",
    "6. Нажать 'Скорректировать' для возврата к тексту либо 'Подтвердить и запустить' для запуска показанного плана.",
    "7. Проверить в выбранном Obsidian vault папку 02_Missions: паспорт, Canvas, AI-команду, результат, Evidence, Trace и граф.",
  "7. Нажать '+ окно' до трех окон и 'Сравнить LLM'.",
  "8. Нажать верхнюю иконку результата и проверить правую панель.",
  "9. Переключить темную/светлую схему.",
  "10. Проверить QR на телефоне в локальной сети.",
  "11. Открыть Obsidian, включить Symbiot plugin и проверить connector/vault."
)

$passed = $true
foreach ($value in $checks.Values) {
  if ($value -ne $true) { $passed = $false }
}

$result = [ordered]@{
  id = "OBP-031D"
  date = "2026-07-22"
  status = if ($passed) { "PASS_WITH_CONDITIONS_RELEASE_CANDIDATE_YELLOW" } else { "YELLOW_RELEASE_CANDIDATE_CHECK_FAILED" }
  packageRoot = $Root
  baseUrl = $BaseUrl
  connectorStartedByCheck = $connector.started
  connectorProcessId = $connector.processId
  checks = $checks
  fullMissionDiagnostics = $fullMissionDiagnostics
  manualAcceptanceRequired = $true
  manualChecklist = $manualChecklist
  boundaries = @(
    "Это release candidate для локальной Windows-проверки, не market-ready GREEN.",
    "Ручная проверка Дмитрия/клиента обязательна.",
    "Signed installer, marketplace, production remote relay и full Windows Agent остаются YELLOW/RED.",
    "Readiness нельзя менять по этому check без ручной acceptance."
  )
}

$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportJson -Encoding UTF8

$md = @()
$md += "# Symbiot OBP-031D RC Check"
$md += ""
$md += "Статус: `$($result.status)`"
$md += ""
$md += "## Автопроверки"
foreach ($key in $checks.Keys) {
  $md += "- $key`: $($checks[$key])"
}
$md += ""
$md += "## Что проверить руками"
$md += $manualChecklist
$md += ""
$md += "## Ограничения"
$md += $result.boundaries
$md | Set-Content -LiteralPath $ReportMd -Encoding UTF8

Write-Host "RC check status: $($result.status)"
Write-Host "JSON: $ReportJson"
Write-Host "MD: $ReportMd"

if ($connector.started -and $connector.processId) {
  Stop-Process -Id $connector.processId -Force -ErrorAction SilentlyContinue
}

if (-not $passed) {
  exit 1
}

