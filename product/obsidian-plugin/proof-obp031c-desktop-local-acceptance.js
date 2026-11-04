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
const START_CMD = path.join(ROOT, "START_SYMBIOT_DESKTOP.cmd");
const OUT_DIR = path.join(ROOT, "runtime_logs");
const OUT_FILE = path.join(OUT_DIR, "SYM_OBSIDIAN_PLUGIN_OBP031C_DESKTOP_LOCAL_ACCEPTANCE_PROOF_2026-07-22.json");
const PORT = Number(process.env.SYMBIOT_OBP031C_PROOF_PORT || 18789);
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

async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { ok: response.ok, status: response.status, headers: Object.fromEntries(response.headers.entries()), text, json };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth() {
  for (let index = 0; index < 40; index += 1) {
    try {
      const health = await request("GET", `${BASE_URL}/health`);
      if (health.ok && health.json && health.json.ok) return health;
    } catch (_) {}
    await wait(250);
  }
  throw new Error("connector_health_timeout");
}

function extractToken(html) {
  const match = String(html || "").match(/const token = "([^"]+)"/);
  return match ? match[1] : "";
}

function electronVersion(electronCmd) {
  try {
    return execFileSync("cmd.exe", ["/c", electronCmd, "--version"], { cwd: DESKTOP_DIR, encoding: "utf8", timeout: 15000 }).trim();
  } catch (error) {
    return "";
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const serverPath = path.join(CONNECTOR_DIR, "server.js");
  const connectorPackagePath = path.join(CONNECTOR_DIR, "package.json");
  const desktopMainPath = path.join(DESKTOP_DIR, "main.js");
  const desktopPackagePath = path.join(DESKTOP_DIR, "package.json");
  const electronCmd = path.join(DESKTOP_DIR, "node_modules", ".bin", "electron.cmd");
  const tempDataDir = path.join(OUT_DIR, "obp031c_temp_connector");
  fs.mkdirSync(tempDataDir, { recursive: true });

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

  let stdout = "";
  let stderr = "";
  let spawnError = null;
  server.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  server.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  server.on("error", (error) => { spawnError = error; });

  const proof = {
    id: "OBP-031C",
    date: "2026-07-22",
    project: "SYM-SaaS / Symbiot Desktop Shell Packaging",
    gate: "Desktop Shell Packaging + Local Acceptance",
    status: "YELLOW_NOT_RUN",
    baseUrl: BASE_URL,
    files: {
      startCmd: START_CMD,
      server: serverPath,
      desktopMain: desktopMainPath,
      desktopPackage: desktopPackagePath,
      electronCmd
    },
    fileHashes: {},
    checks: {},
    boundaries: [
      "This proof checks local desktop packaging and runtime acceptance without opening a visible manual GUI session.",
      "Manual Windows client-machine acceptance is still required before release GREEN.",
      "Signed installer, marketplace publication and production remote relay remain YELLOW/RED.",
      "Readiness must not be changed by this proof alone."
    ]
  };

  try {
    const startCmd = fs.existsSync(START_CMD) ? read(START_CMD) : "";
    const desktopMain = fs.existsSync(desktopMainPath) ? read(desktopMainPath) : "";
    const connectorPackage = JSON.parse(read(connectorPackagePath));
    proof.fileHashes = {
      startCmd: fs.existsSync(START_CMD) ? sha256(startCmd) : null,
      server: sha256(read(serverPath)),
      desktopMain: fs.existsSync(desktopMainPath) ? sha256(desktopMain) : null,
      desktopPackage: fs.existsSync(desktopPackagePath) ? sha256(read(desktopPackagePath)) : null
    };

    proof.electronVersion = fs.existsSync(electronCmd) ? electronVersion(electronCmd) : "";
    proof.checks.startCmdPresent = fs.existsSync(START_CMD);
    proof.checks.startCmdUsesDesktopShell = startCmd.includes("symbiot-desktop-shell") || startCmd.includes("desktop-shell");
    proof.checks.startCmdFindsNode = startCmd.includes("where node") && startCmd.includes("SYMBIOT_NODE_EXE");
    proof.checks.startCmdInstallsElectronIfMissing = startCmd.includes("npm install --no-audit --no-fund");
    proof.checks.startCmdSetsConnectorEnv = startCmd.includes("SYMBIOT_CONNECTOR_DIR") && startCmd.includes("SYMBIOT_APP_URL");
    proof.checks.desktopShellUsesNodeExe = desktopMain.includes("NODE_EXE") && desktopMain.includes("spawn(NODE_EXE");
    proof.checks.desktopShellWaitsForHealth = desktopMain.includes("waitForConnectorReady") && desktopMain.includes("/health");
    proof.checks.desktopShellSecurityBaseline = desktopMain.includes("contextIsolation: true") && desktopMain.includes("nodeIntegration: false") && desktopMain.includes("sandbox: true");
    proof.checks.electronRuntimeBundled = fs.existsSync(electronCmd) && /^v\d+\./.test(proof.electronVersion);
    proof.checks.packageScriptRegistered = connectorPackage.scripts && connectorPackage.scripts["proof:desktop-local"] === "node ../proof-obp031c-desktop-local-acceptance.js";

    await wait(250);
    if (spawnError) throw spawnError;
    await waitForHealth();

    const appHtml = await request("GET", `${BASE_URL}/app?shell=desktop`);
    const token = extractToken(appHtml.text);
    const stateUnauthorized = await request("GET", `${BASE_URL}/app/state`);
    const state = token ? await request("GET", `${BASE_URL}/app/state?token=${encodeURIComponent(token)}`) : { ok: false, status: 0, json: null, text: "" };
    const runtime = token ? await request("POST", `${BASE_URL}/app/agent-runtime/run`, {
      source: "obp031c-proof",
      token,
      approved: true,
      task: "OBP-031C proof: desktop shell packaging local acceptance."
    }) : { ok: false, status: 0, json: null, text: "" };
    const qrMatch = appHtml.text.match(/<img src="([^"]*\/mobile\/qr\.svg\?token=[^"]+)"/);
    const qr = qrMatch ? await request("GET", qrMatch[1].replace(/&amp;/g, "&")) : { ok: false, status: 0, text: "" };

    proof.checks.desktopAppRouteReturned = appHtml.ok && appHtml.text.includes('data-symbiot-app-shell="harnes-desktop-browser-gui"');
    proof.checks.desktopAppHasCoreUi = ["LLM Hub", "Windows Agent", "СИМБИОТ", "＋ окно", "themeToggle", "previewToggle"].every((part) => appHtml.text.includes(part));
    proof.checks.stateRequiresSession = stateUnauthorized.status === 401;
    proof.checks.stateWithSessionOk = state.ok && state.json && state.json.shell && state.json.shell.targetForm && state.json.shell.targetForm.windows === "desktop_gui_shell";
    proof.checks.runtimeViaDesktopSession = runtime.ok && runtime.json && runtime.json.run && runtime.json.run.status === "completed_yellow";
    proof.checks.mobileQrStillWorks = Boolean(qrMatch) && qr.ok && /<svg[\s>]/i.test(qr.text);
    proof.checks.noSecretLeak = hasNoSecretLeak([startCmd, appHtml.text, state.text, runtime.text, qr.text]);

    proof.runtimeStatus = runtime.json && runtime.json.run ? runtime.json.run.status : null;
    proof.serverOutput = { stdout: stdout.slice(-1000), stderr: stderr.slice(-1000) };
    proof.status = Object.values(proof.checks).every(Boolean)
      ? "PASS_WITH_CONDITIONS_DESKTOP_LOCAL_ACCEPTANCE_YELLOW"
      : "YELLOW_DESKTOP_LOCAL_ACCEPTANCE_INCOMPLETE";
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
