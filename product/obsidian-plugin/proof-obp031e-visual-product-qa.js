const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { createHash } = require("crypto");

const ROOT = __dirname;
const CONNECTOR_DIR = fs.existsSync(path.join(ROOT, "symbiot-connector-service"))
  ? path.join(ROOT, "symbiot-connector-service")
  : path.join(ROOT, "connector-service");
const DESKTOP_DIR = fs.existsSync(path.join(ROOT, "symbiot-desktop-shell"))
  ? path.join(ROOT, "symbiot-desktop-shell")
  : path.join(ROOT, "desktop-shell");
const OUT_DIR = path.join(ROOT, "runtime_logs");
const PACKAGE_KIND = fs.existsSync(path.join(ROOT, "symbiot-connector-service")) ? "SOURCE" : "RELEASE";
const OUT_FILE = path.join(OUT_DIR, "SYM_OBSIDIAN_PLUGIN_OBP031E_VISUAL_PRODUCT_QA_PROOF_2026-07-22.json");
const SCREENSHOT_FILE = path.join(OUT_DIR, `SYM_OBSIDIAN_PLUGIN_OBP031E_DESKTOP_VISUAL_${PACKAGE_KIND}_2026-07-22.png`);
const PORT = Number(process.env.SYMBIOT_OBP031E_PROOF_PORT || Math.floor(18000 + Math.random() * 1200));
const BASE_URL = `http://127.0.0.1:${PORT}`;

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function hasNoSecretLeak(values) {
  return !values.some((value) => /(?:sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_\-$]{12,}|AIza[0-9A-Za-z_-]{12,}|postgresql:\/\/[^:\s]+:[^@\s]+@)/i.test(String(value || "")));
}

function nodeExecutable() {
  if (process.env.SYMBIOT_NODE_EXE && fs.existsSync(process.env.SYMBIOT_NODE_EXE)) return process.env.SYMBIOT_NODE_EXE;
  if (process.execPath && fs.existsSync(process.execPath)) return process.execPath;
  return "node";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function pngDimensions(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return { width: 0, height: 0 };
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function electronCommand() {
  const command = path.join(DESKTOP_DIR, "node_modules", ".bin", "electron.cmd");
  if (!fs.existsSync(command)) throw new Error(`electron_not_found: ${command}`);
  return command;
}

function electronVersion(command) {
  try {
    return execFileSync("cmd.exe", ["/c", command, "--version"], { cwd: DESKTOP_DIR, encoding: "utf8", timeout: 15000 }).trim();
  } catch (_) {
    return "";
  }
}

function runElectronVisualCapture(command) {
  return new Promise((resolve) => {
    const child = spawn("cmd.exe", ["/c", command, DESKTOP_DIR], {
      cwd: DESKTOP_DIR,
      env: {
        ...process.env,
        SYMBIOT_CONNECTOR_PORT: String(PORT),
        SYMBIOT_CONNECTOR_DIR: CONNECTOR_DIR,
        SYMBIOT_NODE_EXE: nodeExecutable(),
        SYMBIOT_APP_URL: `${BASE_URL}/app?shell=desktop&visual-proof=1`,
        SYMBIOT_VISUAL_PROOF_OUTPUT: SCREENSHOT_FILE,
        SYMBIOT_VISUAL_PROOF_INTERACTIVE: "1"
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ status: null, timeout: true, stdout, stderr });
    }, 45000);
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

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (fs.existsSync(SCREENSHOT_FILE)) fs.rmSync(SCREENSHOT_FILE, { force: true });
  if (fs.existsSync(`${SCREENSHOT_FILE}.error.json`)) fs.rmSync(`${SCREENSHOT_FILE}.error.json`, { force: true });

  const serverPath = path.join(CONNECTOR_DIR, "server.js");
  const desktopMainPath = path.join(DESKTOP_DIR, "main.js");
  const desktopPackagePath = path.join(DESKTOP_DIR, "package.json");
  const electronCmd = electronCommand();
  const tempDataDir = path.join(OUT_DIR, "obp031e_temp_connector");
  fs.mkdirSync(tempDataDir, { recursive: true });

  const proof = {
    id: "OBP-031E",
    date: "2026-07-22",
    project: "SYM-SaaS / Symbiot Visual Product QA",
    gate: "Visual Product QA for Windows Desktop HARNES shell",
    status: "YELLOW_NOT_RUN",
    proofPort: PORT,
    files: {
      server: serverPath,
      desktopMain: desktopMainPath,
      desktopPackage: desktopPackagePath,
      screenshot: SCREENSHOT_FILE,
      electronCmd
    },
    fileHashes: {},
    checks: {},
    boundaries: [
      "This proof captures the real Electron desktop shell screenshot and checks product-visible HARNES layout evidence.",
      "It does not replace Dmitry's manual client-machine acceptance.",
      "It does not prove signed installer, marketplace publication, production remote relay or full Windows Agent.",
      "Readiness must not be changed by this proof alone."
    ]
  };

  const server = spawn(nodeExecutable(), [serverPath], {
    cwd: CONNECTOR_DIR,
    env: {
      ...process.env,
      SYMBIOT_CONNECTOR_PORT: String(PORT),
      SYMBIOT_CONNECTOR_DATA_DIR: tempDataDir,
      SYMBIOT_LLM_LIVE_ENABLED: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverStdout = "";
  let serverStderr = "";
  server.stdout.on("data", (chunk) => { serverStdout += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverStderr += chunk.toString(); });

  try {
    const desktopMain = read(desktopMainPath);
    const desktopPackage = JSON.parse(read(desktopPackagePath));
    const appHtml = await (async () => {
      const healthy = await waitForHealth();
      if (!healthy) throw new Error("connector_health_timeout");
      return request("GET", `${BASE_URL}/app?shell=desktop`);
    })();

    const capture = await runElectronVisualCapture(electronCmd);
    const screenshotExists = fs.existsSync(SCREENSHOT_FILE);
    const dimensions = screenshotExists ? pngDimensions(SCREENSHOT_FILE) : { width: 0, height: 0 };
    const screenshotBytes = screenshotExists ? fs.statSync(SCREENSHOT_FILE).size : 0;
    const captureError = fs.existsSync(`${SCREENSHOT_FILE}.error.json`) ? read(`${SCREENSHOT_FILE}.error.json`) : "";

    proof.fileHashes = {
      server: sha256(read(serverPath)),
      desktopMain: sha256(desktopMain),
      desktopPackage: sha256(read(desktopPackagePath)),
      screenshot: screenshotExists ? sha256(fs.readFileSync(SCREENSHOT_FILE)) : null
    };
    proof.electronVersion = electronVersion(electronCmd);
    proof.capture = capture;
    proof.captureError = captureError;
    proof.screenshot = {
      path: SCREENSHOT_FILE,
      exists: screenshotExists,
      bytes: screenshotBytes,
      width: dimensions.width,
      height: dimensions.height
    };

    proof.checks.visualProofModeExists = desktopMain.includes("SYMBIOT_VISUAL_PROOF_OUTPUT") && desktopMain.includes("capturePage()");
    proof.checks.interactiveVisualProofModeExists = desktopMain.includes("SYMBIOT_VISUAL_PROOF_INTERACTIVE") && desktopMain.includes("data-visual-proof-actions");
    proof.checks.desktopSecurityBaselineKept = desktopMain.includes("contextIsolation: true") && desktopMain.includes("nodeIntegration: false") && desktopMain.includes("sandbox: true");
    proof.checks.electronRuntimeAvailable = /^v\d+\./.test(proof.electronVersion);
    proof.checks.desktopCaptureSucceeded = capture.status === 0 && !capture.timeout && screenshotExists && !captureError;
    proof.checks.screenshotHasDesktopSize = dimensions.width >= 1200 && dimensions.height >= 800;
    proof.checks.screenshotIsNotTriviallyBlank = screenshotBytes > 50000;
    proof.checks.htmlHasHarnesShell = appHtml.ok && appHtml.text.includes('data-symbiot-app-shell="harnes-desktop-browser-gui"');
    proof.checks.htmlHasLeftTools = ["Чат", "LLM Hub", "Контекст / RAG", "Зрение", "Рабочие файлы", "Evidence", "Мобильный доступ", "Windows Agent", "Admin Sync"].every((part) => appHtml.text.includes(part));
    proof.checks.htmlHasCenterChatAndOutput = ["СИМБИОТ", "id=\"prompt\"", "id=\"llmGrid\"", "＋ окно"].every((part) => appHtml.text.includes(part));
    proof.checks.htmlHasRightPreviewControls = ["id=\"preview\"", "previewToggle", "themeToggle"].every((part) => appHtml.text.includes(part));
    proof.checks.threeWindowLimitPresent = appHtml.text.includes("Math.min(3") && appHtml.text.includes("setPanes(3)") && appHtml.text.includes("slice(0, 3)");
    proof.checks.mobileQrPresent = appHtml.text.includes("/mobile/qr.svg?token=");
    proof.checks.noSecretLeak = hasNoSecretLeak([desktopMain, appHtml.text, capture.stdout, capture.stderr, captureError]);
    proof.checks.packageScriptRegistered = desktopPackage.scripts && desktopPackage.scripts.check === "node --check main.js";

    proof.serverOutput = { stdout: serverStdout.slice(-1000), stderr: serverStderr.slice(-1000) };
    proof.status = Object.values(proof.checks).every(Boolean)
      ? "PASS_WITH_CONDITIONS_VISUAL_PRODUCT_QA_YELLOW"
      : "YELLOW_VISUAL_PRODUCT_QA_INCOMPLETE";
  } finally {
    server.kill();
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(proof, null, 2), "utf8");
  console.log(JSON.stringify(proof, null, 2));
  if (!Object.values(proof.checks).every(Boolean)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
