const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createHash } = require("crypto");

const ROOT = __dirname;
const CONNECTOR_DIR = fs.existsSync(path.join(ROOT, "symbiot-connector-service"))
  ? path.join(ROOT, "symbiot-connector-service")
  : path.join(ROOT, "connector-service");
const DESKTOP_DIR = fs.existsSync(path.join(ROOT, "symbiot-desktop-shell"))
  ? path.join(ROOT, "symbiot-desktop-shell")
  : path.join(ROOT, "desktop-shell");
const OUT_DIR = path.join(ROOT, "runtime_logs");
const OUT_FILE = path.join(OUT_DIR, "SYM_OBSIDIAN_PLUGIN_OBP031B_HARNES_GUI_STANDARD_PROOF_2026-07-22.json");
const PORT = Number(process.env.SYMBIOT_OBP031B_PROOF_PORT || 18788);
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

function nodeExecutable() {
  if (process.env.SYMBIOT_NODE_EXE && fs.existsSync(process.env.SYMBIOT_NODE_EXE)) return process.env.SYMBIOT_NODE_EXE;
  if (process.execPath && fs.existsSync(process.execPath)) return process.execPath;
  return "node";
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

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const serverPath = path.join(CONNECTOR_DIR, "server.js");
  const desktopMainPath = path.join(DESKTOP_DIR, "main.js");
  const desktopPackagePath = path.join(DESKTOP_DIR, "package.json");
  const connectorPackagePath = path.join(CONNECTOR_DIR, "package.json");
  const tempDataDir = path.join(OUT_DIR, "obp031b_temp_connector");
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
    id: "OBP-031B",
    date: "2026-07-22",
    project: "SYM-SaaS / Symbiot HARNES GUI + Desktop Shell",
    gate: "HARNES Desktop/Browser GUI Standard",
    status: "YELLOW_NOT_RUN",
    baseUrl: BASE_URL,
    files: {
      server: serverPath,
      desktopMain: desktopMainPath,
      desktopPackage: desktopPackagePath
    },
    fileHashes: {
      server: sha256(read(serverPath)),
      desktopMain: fs.existsSync(desktopMainPath) ? sha256(read(desktopMainPath)) : null,
      desktopPackage: fs.existsSync(desktopPackagePath) ? sha256(read(desktopPackagePath)) : null
    },
    checks: {},
    boundaries: [
      "Windows Desktop GUI target is scaffolded and statically checked, not packaged as a signed installer.",
      "Browser /app is the same HARNES GUI surface for fallback and non-Windows access.",
      "Mobile access remains local QR/mobile panel; production remote relay remains YELLOW/RED.",
      "Readiness must not be changed by this UI proof alone."
    ]
  };

  try {
    const serverSource = read(serverPath);
    const desktopMain = fs.existsSync(desktopMainPath) ? read(desktopMainPath) : "";
    const desktopPackage = fs.existsSync(desktopPackagePath) ? JSON.parse(read(desktopPackagePath)) : {};
    const connectorPackage = JSON.parse(read(connectorPackagePath));

    proof.checks.serverHasHarnesRenderer = serverSource.includes("renderHarnesAppHtml") && serverSource.includes("HARNES_Codex_Hermes");
    proof.checks.packageScriptRegistered = connectorPackage.scripts && connectorPackage.scripts["proof:harnes-gui"] === "node ../proof-obp031b-harnes-gui-standard.js";
    proof.checks.desktopShellFilesPresent = fs.existsSync(desktopMainPath) && fs.existsSync(desktopPackagePath);
    proof.checks.desktopShellUsesElectronWindow = desktopMain.includes("BrowserWindow") && desktopMain.includes("/app?shell=desktop");
    proof.checks.desktopShellStartsConnector = desktopMain.includes("startConnectorIfNeeded") && desktopMain.includes("server.js");
    proof.checks.desktopShellSecurityBaseline = desktopMain.includes("contextIsolation: true") && desktopMain.includes("nodeIntegration: false") && desktopMain.includes("sandbox: true");
    proof.checks.desktopPackageHasElectron = desktopPackage.devDependencies && Boolean(desktopPackage.devDependencies.electron);

    await wait(250);
    if (spawnError) throw spawnError;
    await waitForHealth();

    const appHtml = await request("GET", `${BASE_URL}/app`);
    const token = extractToken(appHtml.text);
    const appStateUnauthorized = await request("GET", `${BASE_URL}/app/state`);
    const appState = token ? await request("GET", `${BASE_URL}/app/state?token=${encodeURIComponent(token)}`) : { ok: false, status: 0, json: null, text: "" };
    const compare = token ? await request("POST", `${BASE_URL}/llm/compare`, {
      source: "obp031b-proof",
      token,
      live: false,
      prompt: "Проверь HARNES GUI Симбиота: до трех окон LLM, правая панель результата, минимальный рабочий экран."
    }) : { ok: false, status: 0, json: null, text: "" };
    const runtime = token ? await request("POST", `${BASE_URL}/app/agent-runtime/run`, {
      source: "obp031b-proof",
      token,
      approved: true,
      task: "OBP-031B proof: HARNES GUI запускает локальный runtime MVP."
    }) : { ok: false, status: 0, json: null, text: "" };
    const qrMatch = appHtml.text.match(/<img src="([^"]*\/mobile\/qr\.svg\?token=[^"]+)"/);
    const qr = qrMatch ? await request("GET", qrMatch[1].replace(/&amp;/g, "&")) : { ok: false, status: 0, text: "", headers: {} };
    const results = compare.json && compare.json.comparison && Array.isArray(compare.json.comparison.results) ? compare.json.comparison.results : [];

    proof.checks.appHtmlReturned = appHtml.ok && appHtml.text.includes("Симбиот HARNES");
    proof.checks.appUsesHarnesShell = appHtml.text.includes('data-symbiot-app-shell="harnes-desktop-browser-gui"') && appHtml.text.includes('data-design-standard="HARNES_Codex_Hermes"');
    proof.checks.leftToolsPresent = ["LLM Hub", "Контекст / RAG", "Зрение", "Рабочие файлы", "Evidence", "Мобильный доступ", "Windows Agent", "Admin Sync"].every((label) => appHtml.text.includes(label));
    proof.checks.centerChatAndVisualPresent = appHtml.text.includes("hero-visual") && appHtml.text.includes("composer") && appHtml.text.includes("Опиши бизнес-миссию");
    proof.checks.outputSupportsUpToThreePanes = appHtml.text.includes("paneCount") && appHtml.text.includes("Math.min(3") && appHtml.text.includes("＋ окно");
    proof.checks.rightPreviewTogglePresent = appHtml.text.includes("previewToggle") && appHtml.text.includes("Просмотр результата") && appHtml.text.includes("setPreviewOpen");
    proof.checks.themeSwitchPresent = appHtml.text.includes("themeToggle") && appHtml.text.includes("symbiot-theme") && appHtml.text.includes("темная") && appHtml.text.includes("светлая");
    proof.checks.mobileQrPresent = Boolean(qrMatch) && qr.ok && /<svg[\s>]/i.test(qr.text);
    proof.checks.appRemovesOldDashboardCopy = !appHtml.text.includes("Browser GUI MVP") && !appHtml.text.includes("Vault</h3>");
    proof.checks.appStateRequiresSession = appStateUnauthorized.status === 401;
    proof.checks.appStateHarnesMode = appState.ok && appState.json && appState.json.shell && appState.json.shell.mode === "harnes_desktop_browser_gui" && appState.json.shell.designStandard === "HARNES_Codex_Hermes";
    proof.checks.llmCompareViaAppSession = compare.ok && compare.json && compare.json.comparison && results.length === 3;
    proof.checks.runtimeViaAppSession = runtime.ok && runtime.json && runtime.json.run && runtime.json.run.status === "completed_yellow";
    proof.checks.noSecretLeak = hasNoSecretLeak([appHtml.text, appState.text, compare.text, runtime.text, qr.text]);

    proof.appSession = { tokenFingerprint: sha256(token).slice(0, 12), stateStatus: appState.json ? appState.json.status : null };
    proof.comparisonStatus = compare.json && compare.json.comparison ? compare.json.comparison.status : null;
    proof.runtimeStatus = runtime.json && runtime.json.run ? runtime.json.run.status : null;
    proof.serverOutput = { stdout: stdout.slice(-1000), stderr: stderr.slice(-1000) };
    proof.status = Object.values(proof.checks).every(Boolean)
      ? "PASS_WITH_CONDITIONS_HARNES_GUI_STANDARD_YELLOW"
      : "YELLOW_HARNES_GUI_STANDARD_INCOMPLETE";
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
