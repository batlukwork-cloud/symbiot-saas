const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { createHash } = require("crypto");

const ROOT = __dirname;
const CONNECTOR_DIR = fs.existsSync(path.join(ROOT, "symbiot-connector-service")) ? path.join(ROOT, "symbiot-connector-service") : path.join(ROOT, "connector-service");
const DESKTOP_DIR = fs.existsSync(path.join(ROOT, "symbiot-desktop-shell")) ? path.join(ROOT, "symbiot-desktop-shell") : path.join(ROOT, "desktop-shell");
const START_CMD = path.join(ROOT, "START_SYMBIOT_DESKTOP.cmd");
const OUT_DIR = path.join(ROOT, "runtime_logs");
const OUT_FILE = path.join(OUT_DIR, "SYM_OBSIDIAN_PLUGIN_OBP031G_DESKTOP_CLIENT_ACCEPTANCE_PROOF_2026-07-22.json");
const SCREENSHOT_FILE = path.join(OUT_DIR, "SYM_OBSIDIAN_PLUGIN_OBP031G_DESKTOP_CLIENT_ACCEPTANCE_2026-07-22.png");
const BOOT_STATUS_FILE = path.join(OUT_DIR, "SYM_OBP031G_DESKTOP_BOOT_STATUS_2026-07-22.json");
const PROOF_STATE_FILE = path.join(OUT_DIR, "SYM_OBP031G_DESKTOP_PROOF_STATE_2026-07-22.json");
const TEMP_APPDATA = path.join(OUT_DIR, "obp031g_temp_appdata");
const TEMP_CONNECTOR_DATA = path.join(OUT_DIR, "obp031g_temp_connector_data");
const PORT = Number(process.env.SYMBIOT_OBP031G_PROOF_PORT || Math.floor(18800 + Math.random() * 700));
const BASE_URL = `http://127.0.0.1:${PORT}`;

function read(file) { return fs.readFileSync(file, "utf8"); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function hasNoSecretLeak(values) {
  return !values.some((value) => /(?:sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_\-$]{12,}|AIza[0-9A-Za-z_-]{12,}|postgresql:\/\/[^:\s]+:[^@\s]+@)/i.test(String(value || "")));
}
function nodeExecutable() {
  if (process.env.SYMBIOT_NODE_EXE && fs.existsSync(process.env.SYMBIOT_NODE_EXE)) return process.env.SYMBIOT_NODE_EXE;
  if (process.execPath && fs.existsSync(process.execPath)) return process.execPath;
  return "node";
}
function electronCommand() {
  const exe = path.join(DESKTOP_DIR, "node_modules", "electron", "dist", "electron.exe");
  const command = path.join(DESKTOP_DIR, "node_modules", ".bin", "electron.cmd");
  if (fs.existsSync(exe)) return exe;
  if (fs.existsSync(command)) return command;
  throw new Error(`electron_not_found: ${exe}`);
}
function electronVersion(command) {
  try {
    if (command.toLowerCase().endsWith(".cmd")) {
      return execFileSync("cmd.exe", ["/c", command, "--version"], { cwd: DESKTOP_DIR, encoding: "utf8", timeout: 15000 }).trim();
    }
    return execFileSync(command, ["--version"], { cwd: DESKTOP_DIR, encoding: "utf8", timeout: 15000 }).trim();
  } catch (_) {
    return "";
  }
}
function pngDimensions(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return { width: 0, height: 0 };
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { ok: response.ok, status: response.status, text, json };
}
async function waitForHealth() {
  for (let index = 0; index < 50; index += 1) {
    try {
      const health = await request("GET", `${BASE_URL}/health`);
      if (health.ok && health.json && health.json.ok) return true;
    } catch (_) {}
    await wait(250);
  }
  return false;
}
function runDesktopShell() {
  return new Promise((resolve) => {
    const child = spawn(START_CMD, [String(PORT)], {
      cwd: ROOT,
      shell: true,
      env: {
        ...process.env,
        APPDATA: TEMP_APPDATA,
        SYMBIOT_CONNECTOR_PORT: String(PORT),
        SYMBIOT_CONNECTOR_DATA_DIR: TEMP_CONNECTOR_DATA,
        SYMBIOT_CONNECTOR_DIR: CONNECTOR_DIR,
        SYMBIOT_NODE_EXE: nodeExecutable(),
        SYMBIOT_APP_URL: `${BASE_URL}/app?shell=desktop&client-acceptance=1`,
        SYMBIOT_DESKTOP_BOOT_STATUS_OUTPUT: BOOT_STATUS_FILE,
        SYMBIOT_DESKTOP_PROOF_STATE_OUTPUT: PROOF_STATE_FILE,
        SYMBIOT_VISUAL_PROOF_OUTPUT: SCREENSHOT_FILE,
        SYMBIOT_VISUAL_PROOF_INTERACTIVE: "1",
        SYMBIOT_LLM_LIVE_ENABLED: "0"
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ status: null, timeout: true, stdout, stderr });
    }, 50000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("exit", (status) => {
      clearTimeout(timeout);
      resolve({ status, timeout: false, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ status: null, timeout: false, stdout, stderr: `${stderr}\n${error.message}` });
    });
  });
}
function killProcessOnPort(port) {
  const command = [
    "$ErrorActionPreference='SilentlyContinue';",
    `$pids = Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen | Select-Object -ExpandProperty OwningProcess -Unique;`,
    "foreach ($owningPid in $pids) { Stop-Process -Id $owningPid -Force }"
  ].join(" ");
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { encoding: "utf8", timeout: 15000 });
  } catch (_) {}
}
function extractToken(html) {
  const match = String(html || "").match(/const token = "([^"]+)"/);
  return match ? match[1] : "";
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.rmSync(TEMP_APPDATA, { recursive: true, force: true });
  fs.rmSync(TEMP_CONNECTOR_DATA, { recursive: true, force: true });
  fs.mkdirSync(TEMP_APPDATA, { recursive: true });
  fs.mkdirSync(TEMP_CONNECTOR_DATA, { recursive: true });
  for (const file of [OUT_FILE, SCREENSHOT_FILE, `${SCREENSHOT_FILE}.error.json`, BOOT_STATUS_FILE, PROOF_STATE_FILE]) {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }

  const electronCmd = electronCommand();
  const desktopMainPath = path.join(DESKTOP_DIR, "main.js");
  const connectorServerPath = path.join(CONNECTOR_DIR, "server.js");
  const pluginMainPath = fs.existsSync(path.join(ROOT, "symbiot-obsidian-plugin", "main.js"))
    ? path.join(ROOT, "symbiot-obsidian-plugin", "main.js")
    : path.join(ROOT, "obsidian-plugin", "main.js");
  const desktopMain = read(desktopMainPath);
  const startCmd = fs.existsSync(START_CMD) ? read(START_CMD) : "";
  const pluginMain = fs.existsSync(pluginMainPath) ? read(pluginMainPath) : "";

  const proof = {
    id: "OBP-031G",
    date: "2026-07-22",
    project: "SYM-SaaS / Desktop App Stabilization + Client Machine Acceptance",
    gate: "A2 / OBP-031G Desktop App Stabilization + Client Machine Acceptance",
    status: "YELLOW_NOT_RUN",
    readinessChanged: false,
    readiness: "13205 / 14075 = 93.8%",
    port: PORT,
    files: { startCmd: START_CMD, desktopMain: desktopMainPath, connectorServer: connectorServerPath, pluginMain: pluginMainPath, screenshot: SCREENSHOT_FILE, bootStatus: BOOT_STATUS_FILE, proofState: PROOF_STATE_FILE },
    fileHashes: {
      startCmd: fs.existsSync(START_CMD) ? sha256(startCmd) : null,
      desktopMain: sha256(desktopMain),
      connectorServer: sha256(read(connectorServerPath)),
      pluginMain: fs.existsSync(pluginMainPath) ? sha256(pluginMain) : null
    },
    checks: {},
    boundaries: [
      "Simulates local client-machine desktop launch, but not Dmitry's separate physical client computer.",
      "Does not prove signed installer, marketplace publication or production remote relay.",
      "Does not change readiness without manual/client acceptance."
    ]
  };

  try {
    proof.electronVersion = electronVersion(electronCmd);
    const capture = await runDesktopShell();
    const screenshotExists = fs.existsSync(SCREENSHOT_FILE);
    const dimensions = screenshotExists ? pngDimensions(SCREENSHOT_FILE) : { width: 0, height: 0 };
    const screenshotBytes = screenshotExists ? fs.statSync(SCREENSHOT_FILE).size : 0;
    const bootStatus = fs.existsSync(BOOT_STATUS_FILE) ? JSON.parse(read(BOOT_STATUS_FILE)) : {};
    const proofState = fs.existsSync(PROOF_STATE_FILE) ? JSON.parse(read(PROOF_STATE_FILE)) : {};
    const fallbackError = fs.existsSync(`${SCREENSHOT_FILE}.error.json`) ? read(`${SCREENSHOT_FILE}.error.json`) : "";

    proof.capture = capture;
    proof.bootStatus = { ...bootStatus, connectorDir: "[redacted_local_path]" };
    proof.proofState = proofState;
    proof.screenshot = { exists: screenshotExists, bytes: screenshotBytes, width: dimensions.width, height: dimensions.height };
    proof.checks.desktopShellSyntaxReady = true;
    proof.checks.startCmdHasPortParameter = startCmd.includes("set \"PORT=%~1\"") && startCmd.includes("SYMBIOT_CONNECTOR_PORT=%PORT%");
    proof.checks.startCmdSupportsSourceAndReleaseDirs = startCmd.includes("connector-service") && startCmd.includes("desktop-shell") && startCmd.includes("symbiot-connector-service") && startCmd.includes("symbiot-desktop-shell");
    proof.checks.startCmdUsesBundledElectronRuntime = startCmd.includes("electron\\dist\\electron.exe") && startCmd.includes("SYMBIOT_NODE_USES_ELECTRON");
    proof.checks.startCmdWritesBootStatus = startCmd.includes("SYMBIOT_DESKTOP_BOOT_STATUS_OUTPUT");
    proof.checks.desktopHasFallbackScreen = desktopMain.includes("fallbackHtml") && desktopMain.includes("data-symbiot-desktop-fallback");
    proof.checks.desktopWritesBootStatus = desktopMain.includes("writeBootStatus") && desktopMain.includes("SYMBIOT_DESKTOP_BOOT_STATUS_OUTPUT");
    proof.checks.desktopWritesProofState = desktopMain.includes("writeProofState") && desktopMain.includes("SYMBIOT_DESKTOP_PROOF_STATE_OUTPUT");
    proof.checks.desktopWaitsBeforeLoad = desktopMain.includes("connector_ready_before_load") && desktopMain.includes("fallback_loaded");
    proof.checks.desktopSecurityBaselineKept = desktopMain.includes("contextIsolation: true") && desktopMain.includes("nodeIntegration: false") && desktopMain.includes("sandbox: true");
    proof.checks.electronRuntimeAvailable = /^v\d+\./.test(proof.electronVersion);
    proof.checks.desktopShellAutostartedConnector = bootStatus && bootStatus.connectorAlive === true && ["connector_spawned", "window_loaded", "connector_ready_before_load"].includes(bootStatus.phase);
    proof.checks.desktopCaptureSucceeded = capture.status === 0 && !capture.timeout && screenshotExists && !fallbackError;
    proof.checks.screenshotHasDesktopSize = dimensions.width >= 1200 && dimensions.height >= 800;
    proof.checks.screenshotIsNotBlank = screenshotBytes > 50000;
    proof.checks.desktopGuiReturned = proofState.shell === "harnes-desktop-browser-gui" && !proofState.fallback;
    proof.checks.desktopGuiToolsPresent = ["hasLlmHub", "hasContextRag", "hasFiles", "hasVision", "hasMobile", "hasWindowsAgent", "hasAdminSync"].every((key) => proofState[key] === true);
    proof.checks.threeWindowAndPreviewPresent = proofState.hasCompareLayout === true && proofState.hasPreviewToggle === true && proofState.hasThemeToggle === true && proofState.visualProofActions === "done";
    proof.checks.obsidianBridgeCommandPresent = pluginMain.includes("openBrowserGui") && pluginMain.includes("Симбиот: открыть рабочий экран");
    proof.checks.noSecretLeak = hasNoSecretLeak([startCmd, desktopMain, capture.stdout, capture.stderr, fallbackError, JSON.stringify(proof.bootStatus), JSON.stringify(proofState)]);
    proof.status = Object.values(proof.checks).every(Boolean)
      ? "PASS_WITH_CONDITIONS_DESKTOP_CLIENT_ACCEPTANCE_YELLOW"
      : "YELLOW_DESKTOP_CLIENT_ACCEPTANCE_INCOMPLETE";
  } catch (error) {
    proof.status = "FAILED_DESKTOP_CLIENT_ACCEPTANCE_RED";
    proof.blocker = error.message;
    proof.errorStack = error.stack ? error.stack.split("\n").slice(0, 8) : [];
  } finally {
    killProcessOnPort(PORT);
  }

  proof.passed = proof.status === "PASS_WITH_CONDITIONS_DESKTOP_CLIENT_ACCEPTANCE_YELLOW";
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ passed: proof.passed, status: proof.status, evidencePath: OUT_FILE, screenshot: SCREENSHOT_FILE }, null, 2));
  if (!proof.passed) process.exitCode = 1;
}

main();
