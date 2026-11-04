const { spawnSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const root = __dirname;
const installerPath = path.join(root, "release", "SymbiotSetup.exe");
const logsDir = path.join(root, "runtime_logs");
const proofPath = path.join(logsDir, "SYM_OBSIDIAN_PLUGIN_OBP055B_DESKTOP_SHORTCUT_REPAIR_PROOF_2026-07-31.json");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "symbiot-installer-proof-"));
const appDir = path.join(tempRoot, "app");
const vaultDir = path.join(tempRoot, "client-vault");
const obsidianDir = path.join(vaultDir, ".obsidian");
const proofScreenshot = path.join(tempRoot, "desktop-proof.png");
const proofState = path.join(tempRoot, "desktop-proof-state.json");
const bootState = path.join(tempRoot, "desktop-boot.json");
const existingNote = path.join(vaultDir, "existing-client-note.md");
const existingCanvas = path.join(vaultDir, "existing-client-map.canvas");
const existingPluginDir = path.join(obsidianDir, "plugins", "calendar");
const installerLog = path.join(tempRoot, "installer.log");
const proofPort = Number(process.env.SYMBIOT_OBP055_PROOF_PORT || Math.floor(19000 + Math.random() * 1000));
const missionProofPort = proofPort + 1;
const proofBaseUrl = `http://127.0.0.1:${missionProofPort}`;
let standaloneConnector = null;

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout || 180000,
    env: { ...process.env, ...(options.env || {}) }
  });
  if (result.status !== 0) {
    throw new Error(
      `${options.label || command} failed (${result.status})\nSTDOUT:\n${result.stdout || ""}\nSTDERR:\n${result.stderr || ""}`
    );
  }
  return result;
}

function waitForFile(filePath, timeoutMs = 60000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${filePath}`));
      }
    }, 250);
  });
}

async function request(method, route, body) {
  const response = await fetch(`${proofBaseUrl}${route}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await response.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch (_) {
    json = { raw };
  }
  return { ok: response.ok, status: response.status, json, raw };
}

async function waitForHealth(timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const health = await request("GET", "/health");
      if (health.ok && health.json && health.json.ok) return;
    } catch (_) {
      // Installed connector is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("installed_connector_health_timeout");
}

function stopConnector() {
  if (standaloneConnector && standaloneConnector.exitCode === null) {
    standaloneConnector.kill();
    standaloneConnector = null;
  }
  const pidFile = path.join(appDir, "connector-service", "symbiot-connector-service.pid");
  if (!fs.existsSync(pidFile)) return;
  const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
  if (!Number.isFinite(pid) || pid <= 0) return;
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000
  });
}

async function main() {
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(existingPluginDir, { recursive: true });
  fs.writeFileSync(existingNote, "# Existing client note\nDo not modify.\n", "utf8");
  fs.writeFileSync(existingCanvas, JSON.stringify({ nodes: [], edges: [] }), "utf8");
  fs.writeFileSync(path.join(existingPluginDir, "manifest.json"), JSON.stringify({ id: "calendar", name: "Calendar" }), "utf8");
  fs.writeFileSync(path.join(obsidianDir, "community-plugins.json"), JSON.stringify(["calendar"]), "utf8");
  fs.writeFileSync(path.join(obsidianDir, "app.json"), JSON.stringify({ safeMode: true, legacySetting: "preserve" }), "utf8");

  const originalNoteHash = sha256(existingNote);
  const originalCanvasHash = sha256(existingCanvas);

  assert(fs.existsSync(installerPath), "SymbiotSetup.exe is missing");
  run(installerPath, [
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    "/NOICONS",
    `/DIR=${appDir}`,
    `/VAULTPATH=${vaultDir}`,
    "/FULLBACKUP=0",
    `/LOG=${installerLog}`
  ], { label: "silent installer", timeout: 300000 });

  const installedPlugin = path.join(obsidianDir, "plugins", "symbiot-obsidian-plugin");
  const installedManifest = JSON.parse(fs.readFileSync(path.join(installedPlugin, "manifest.json"), "utf8"));
  const enabledPlugins = JSON.parse(fs.readFileSync(path.join(obsidianDir, "community-plugins.json"), "utf8"));
  const appSettings = JSON.parse(fs.readFileSync(path.join(obsidianDir, "app.json"), "utf8"));
  const installState = JSON.parse(fs.readFileSync(path.join(appDir, "install-state.json"), "utf8"));

  assert(installedManifest.id === "symbiot-obsidian-plugin", "plugin manifest mismatch");
  assert(enabledPlugins.includes("calendar"), "existing plugin was not preserved");
  assert(enabledPlugins.includes("symbiot-obsidian-plugin"), "Symbiot plugin was not enabled");
  assert(appSettings.legacySetting === "preserve", "existing Obsidian settings were not preserved");
  assert(appSettings.safeMode === false, "community plugins mode was not enabled");
  assert(sha256(existingNote) === originalNoteHash, "existing markdown changed");
  assert(sha256(existingCanvas) === originalCanvasHash, "existing canvas changed");
  assert(fs.existsSync(installState.backupPath), "backup was not created");

  const electronExe = path.join(appDir, "desktop-shell", "node_modules", "electron", "dist", "electron.exe");
  const desktopLauncher = path.join(appDir, "START_SYMBIOT_DESKTOP.vbs");
  assert(fs.existsSync(desktopLauncher), "installed desktop launcher is missing");
  const desktopProcess = spawn("wscript.exe", [desktopLauncher], {
    cwd: appDir,
    windowsHide: true,
    env: {
      ...process.env,
      SYMBIOT_CONNECTOR_PORT: String(proofPort),
      SYMBIOT_VISUAL_PROOF_OUTPUT: proofScreenshot,
      SYMBIOT_VISUAL_PROOF_INTERACTIVE: "1",
      SYMBIOT_DESKTOP_PROOF_STATE_OUTPUT: proofState,
      SYMBIOT_DESKTOP_BOOT_STATUS_OUTPUT: bootState
    },
    stdio: "ignore"
  });

  await waitForFile(proofScreenshot, 90000);
  await waitForFile(proofState, 30000);
  if (desktopProcess.exitCode === null && desktopProcess.signalCode === null) {
    await new Promise((resolve) => desktopProcess.once("exit", resolve));
  }
  const visualState = JSON.parse(fs.readFileSync(proofState, "utf8"));
  assert(String(visualState.shell || "").includes("desktop"), "installed desktop did not open desktop shell");
  assert(visualState.hasSymbiot, "installed desktop did not render Symbiot");
  assert(visualState.hasLlmHub && visualState.hasContextRag && visualState.hasFiles, "installed desktop tools are incomplete");
  assert(visualState.hasVision && visualState.hasMobile && visualState.hasWindowsAgent, "installed desktop capability rail is incomplete");
  assert(fs.statSync(proofScreenshot).size > 20000, "installed desktop screenshot is blank or too small");

  standaloneConnector = spawn(electronExe, [path.join(appDir, "connector-service", "server.js")], {
    cwd: path.join(appDir, "connector-service"),
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      SYMBIOT_CONNECTOR_PORT: String(missionProofPort),
      SYMBIOT_CONNECTOR_DATA_DIR: path.join(tempRoot, "connector-data")
    },
    stdio: "ignore"
  });
  await waitForHealth();
  const app = await request("GET", "/app?shell=desktop");
  const tokenMatch = app.raw.match(/const token = ("[^"]+");/);
  assert(app.ok && tokenMatch, "installed desktop session token was not issued");
  const token = JSON.parse(tokenMatch[1]);
  const intake = await request("POST", "/app/mission/intake", {
    token,
    source: "proof-obp055-installed-mission-loop",
    missionText: "Подготовь план запуска новой услуги для малого бизнеса. Результат сохрани в Obsidian в папку 02_Missions. Укажи допущения, источники и следующий шаг."
  });
  assert(intake.ok && intake.json.status === "ready_for_approval", "installed mission intake did not reach approval gate");
  const baseFolder = intake.json.artifactBundle.baseFolder;
  const missionFolder = path.join(vaultDir, ...baseFolder.split("/"));
  assert(!fs.existsSync(missionFolder), "mission files were written before explicit confirmation");
  const confirm = await request("POST", "/app/mission/confirm", {
    token,
    source: "proof-obp055-installed-mission-loop",
    intakeId: intake.json.id,
    approved: true,
    executeLlm: false,
    live: false
  });
  assert(confirm.ok && confirm.json.fullMissionLoop.status === "completed_yellow", "installed mission confirmation did not complete");
  const expectedMissionFiles = [
    "00_Паспорт_миссии.md",
    "01_Маршрут_миссии.canvas",
    "03_AI_Команда.md",
    "04_Результат.md",
    "05_Evidence.md",
    "06_Execution_Trace.md",
    "07_Pre_LLM_Trace.md",
    "08_Граф_связей.md",
    "symbiot-mission-manifest.json"
  ];
  assert(expectedMissionFiles.every((fileName) => fs.existsSync(path.join(missionFolder, fileName))), "installed mission bundle is incomplete");
  const installedPassport = fs.readFileSync(path.join(missionFolder, "00_Паспорт_миссии.md"), "utf8");
  const installedMissionManifest = JSON.parse(fs.readFileSync(path.join(missionFolder, "symbiot-mission-manifest.json"), "utf8"));
  assert(installedPassport.includes("status: completed_yellow"), "installed passport was not completed");
  assert(installedMissionManifest.intakeId === intake.json.id && installedMissionManifest.status === "completed_yellow", "installed manifest does not match the approved intake");

  stopConnector();
  const uninstaller = path.join(appDir, "unins000.exe");
  assert(fs.existsSync(uninstaller), "uninstaller is missing");
  run(uninstaller, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"], {
    label: "silent uninstaller",
    timeout: 180000
  });

  const remainingPlugins = JSON.parse(fs.readFileSync(path.join(obsidianDir, "community-plugins.json"), "utf8"));
  assert(!remainingPlugins.includes("symbiot-obsidian-plugin"), "Symbiot plugin remained enabled after uninstall");
  assert(remainingPlugins.includes("calendar"), "existing plugin was removed by uninstall");
  assert(!fs.existsSync(installedPlugin), "Symbiot plugin files remained after uninstall");
  assert(sha256(existingNote) === originalNoteHash, "existing markdown changed after uninstall");
  assert(sha256(existingCanvas) === originalCanvasHash, "existing canvas changed after uninstall");

  const installerBytes = fs.readFileSync(installerPath);
  const proof = {
    ok: true,
    id: "OBP-055B",
    gate: "Installed Desktop Shortcut Repair",
    status: "PASS_WITH_CONDITIONS_DESKTOP_SHORTCUT_REPAIR_YELLOW",
    checkedAt: new Date().toISOString(),
    installer: {
      path: installerPath,
      bytes: installerBytes.length,
      sha256: crypto.createHash("sha256").update(installerBytes).digest("hex"),
      signed: false
    },
    install: {
      oneExecutable: true,
      silentInstallPassed: true,
      vaultAutoPluginInstallPassed: true,
      existingPluginPreserved: true,
      existingSettingsPreserved: true,
      markdownPreserved: true,
      canvasPreserved: true,
      backupCreated: true
    },
    runtime: {
      desktopStartedFromInstalledFiles: true,
      desktopStartedFromUserLauncher: true,
      connectorStartedWithoutSystemNodeRequirement: true,
      visualProofPassed: true,
      explicitApprovalButtonsPresent: app.raw.includes("Скорректировать") && app.raw.includes("Подтвердить и запустить"),
      noVaultWriteBeforeConfirmation: true,
      missionApprovalLoopPassed: true,
      missionFileCount: expectedMissionFiles.length,
      missionBaseFolder: baseFolder,
      screenshotBytes: fs.statSync(proofScreenshot).size,
      state: visualState
    },
    uninstall: {
      passed: true,
      existingVaultContentPreserved: true,
      existingPluginPreserved: true,
      symbiotPluginRemoved: true
    },
    conditions: [
      "Installer is not digitally signed because no code-signing certificate is configured.",
      "Manual acceptance on a separate client Windows machine remains required before GREEN."
    ],
    tempRoot
  };
  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
}

main().catch((error) => {
  stopConnector();
  fs.mkdirSync(logsDir, { recursive: true });
  const failed = {
    ok: false,
    status: "FAIL",
    checkedAt: new Date().toISOString(),
    error: error.stack || error.message,
    tempRoot
  };
  fs.writeFileSync(proofPath, `${JSON.stringify(failed, null, 2)}\n`, "utf8");
  process.stderr.write(`${JSON.stringify(failed, null, 2)}\n`);
  process.exit(1);
});
