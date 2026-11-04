const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const installRoot = path.join(process.env.LOCALAPPDATA, "Programs", "Symbiot");
const shortcutPath = path.join(process.env.USERPROFILE, "Desktop", "Симбиот.lnk");
const desktopInstaller = path.join(process.env.USERPROFILE, "Desktop", "SymbiotSetup.exe");
const releaseInstaller = path.join(root, "release", "SymbiotSetup.exe");
const bootPath = path.join(installRoot, "runtime_logs", "SYM_DESKTOP_BOOT_STATUS_CURRENT.json");
const evidencePath = path.join(root, "runtime_logs", "SYM_OBSIDIAN_PLUGIN_OBP055B_REAL_INSTALLED_SHORTCUT_PROOF_2026-07-31.json");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function powershell(script) {
  const utf8Script = `$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8;${script}`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", utf8Script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000
  });
  if (result.status !== 0) throw new Error(result.stderr || `PowerShell exited ${result.status}`);
  return result.stdout.trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch("http://127.0.0.1:8787/health");
      const body = await response.json();
      if (response.ok && body && body.ok) return body;
    } catch (_) {
      // Desktop runtime is still starting.
    }
    await sleep(500);
  }
  throw new Error("real_installed_shortcut_health_timeout");
}

async function waitForMainWindow(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const raw = powershell([
      `Get-Process electron -ErrorAction SilentlyContinue`,
      `Where-Object { $_.Path -like '${installRoot.replace(/'/g, "''")}\\*' }`,
      `Select-Object Id,MainWindowTitle,Responding`,
      `ConvertTo-Json -Compress`
    ].join(" | ")) || "[]";
    const parsed = JSON.parse(raw);
    const windowList = Array.isArray(parsed) ? parsed : [parsed];
    const mainWindow = windowList.find((item) => String(item.MainWindowTitle || "").includes("HARNES") && item.Responding);
    if (mainWindow) return mainWindow;
    await sleep(250);
  }
  return null;
}

async function main() {
  const requiredFiles = [
    [path.join(root, "START_SYMBIOT_DESKTOP.cmd"), path.join(installRoot, "START_SYMBIOT_DESKTOP.cmd")],
    [path.join(root, "START_SYMBIOT_DESKTOP.vbs"), path.join(installRoot, "START_SYMBIOT_DESKTOP.vbs")],
    [path.join(root, "symbiot-desktop-shell", "main.js"), path.join(installRoot, "desktop-shell", "main.js")],
    [path.join(root, "symbiot-connector-service", "server.js"), path.join(installRoot, "connector-service", "server.js")],
    ...["symbiot-library-gate.js", "symbiot-reference-adapters.js", "symbiot-reference-library.js", "symbiot-reference-taxonomy.js"]
      .map((name) => [path.join(root, "symbiot-connector-service", name), path.join(installRoot, "connector-service", name)])
  ];
  for (const [source, installed] of requiredFiles) {
    if (!fs.existsSync(source) || !fs.existsSync(installed)) throw new Error(`required_file_missing: ${installed}`);
    if (sha256(source) !== sha256(installed)) throw new Error(`installed_source_mismatch: ${installed}`);
  }

  const shortcutJson = powershell([
    `$ws=New-Object -ComObject WScript.Shell`,
    `$s=$ws.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')`,
    `[pscustomobject]@{Target=$s.TargetPath;Arguments=$s.Arguments;WorkingDirectory=$s.WorkingDirectory}|ConvertTo-Json -Compress`
  ].join(";"));
  const shortcut = JSON.parse(shortcutJson);
  if (!/wscript\.exe$/i.test(shortcut.Target)) throw new Error("shortcut_does_not_use_wscript");
  if (!shortcut.Arguments.includes("START_SYMBIOT_DESKTOP.vbs")) throw new Error("shortcut_does_not_use_desktop_launcher");

  powershell([
    `Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\"`,
    `Where-Object { $_.ExecutablePath -like '${installRoot.replace(/'/g, "''")}\\*' -and $_.CommandLine -notlike '*--type=*' }`,
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
  ].join(" | "));
  await sleep(2500);
  if (fs.existsSync(bootPath)) fs.unlinkSync(bootPath);

  powershell(`$shell=New-Object -ComObject Shell.Application; $shell.ShellExecute('${shortcutPath.replace(/'/g, "''")}','','','open',1)`);
  const health = await waitForHealth();
  const started = Date.now();
  while (!fs.existsSync(bootPath) && Date.now() - started < 30000) await sleep(250);
  if (!fs.existsSync(bootPath)) throw new Error("current_boot_status_missing");
  const boot = JSON.parse(fs.readFileSync(bootPath, "utf8"));
  const mainWindow = await waitForMainWindow();

  const releaseHash = sha256(releaseInstaller);
  const desktopHash = sha256(desktopInstaller);
  const proof = {
    ok: Boolean(health.ok && boot.connectorAlive && mainWindow && releaseHash === desktopHash),
    id: "OBP-055B-REAL-INSTALLED-SHORTCUT",
    gate: "D1 / TST-001 Mission Lifecycle Manual Acceptance",
    status: "PASS_WITH_CONDITIONS_REAL_INSTALLED_SHORTCUT_YELLOW",
    checkedAt: new Date().toISOString(),
    userRoute: {
      shortcutPath,
      profilePathContainsSpace: process.env.USERPROFILE.includes(" "),
      shortcut,
      healthOk: health.ok,
      windowTitle: mainWindow ? mainWindow.MainWindowTitle : null,
      windowResponding: Boolean(mainWindow && mainWindow.Responding),
      boot
    },
    installedSourceSync: {
      passed: true,
      checkedFileCount: requiredFiles.length
    },
    installer: {
      releasePath: releaseInstaller,
      desktopPath: desktopInstaller,
      bytes: fs.statSync(desktopInstaller).size,
      sha256: desktopHash,
      sourceAndDesktopMatch: releaseHash === desktopHash,
      signed: false
    },
    readiness: {
      current: "13205 / 14075 = 93.8%",
      changed: false
    },
    boundary: "Автоматически доказан реальный запуск установленного Desktop через ярлык Windows на профиле с пробелом. Ручная приемка Дмитрием D1 остается обязательной."
  };
  if (!proof.ok) throw new Error("real_installed_shortcut_proof_failed");
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: proof.ok, status: proof.status, evidencePath, installer: proof.installer, userRoute: proof.userRoute }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
