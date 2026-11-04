const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createHash } = require("crypto");

const ROOT = __dirname;
const CONNECTOR_DIR = fs.existsSync(path.join(ROOT, "symbiot-connector-service"))
  ? path.join(ROOT, "symbiot-connector-service")
  : path.join(ROOT, "connector-service");
const PLUGIN_DIR = fs.existsSync(path.join(ROOT, "symbiot-obsidian-plugin"))
  ? path.join(ROOT, "symbiot-obsidian-plugin")
  : path.join(ROOT, "obsidian-plugin");
const OUT_DIR = path.join(ROOT, "runtime_logs");
const OUT_FILE = path.join(OUT_DIR, "SYM_OBSIDIAN_PLUGIN_OBP031A_THIN_PLUGIN_BROWSER_GUI_PROOF_2026-07-22.json");
const PORT = Number(process.env.SYMBIOT_OBP031A_PROOF_PORT || 18787);
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
  const pluginMainPath = path.join(PLUGIN_DIR, "main.js");
  const pluginStylesPath = path.join(PLUGIN_DIR, "styles.css");
  const packageJsonPath = path.join(CONNECTOR_DIR, "package.json");
  const tempDataDir = path.join(OUT_DIR, "obp031a_temp_connector");
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
    id: "OBP-031A",
    date: "2026-07-22",
    project: "SYM-SaaS / Symbiot Obsidian Plugin + Connector Runtime",
    gate: "Thin Plugin + Browser GUI Shell",
    status: "YELLOW_NOT_RUN",
    baseUrl: BASE_URL,
    files: {
      server: serverPath,
      pluginMain: pluginMainPath,
      pluginStyles: pluginStylesPath
    },
    fileHashes: {
      server: sha256(read(serverPath)),
      pluginMain: sha256(read(pluginMainPath)),
      pluginStyles: sha256(read(pluginStylesPath))
    },
    checks: {},
    boundaries: [
      "Browser GUI MVP is proved locally against the connector.",
      "Obsidian plugin is proved as a thin launcher by static inspection.",
      "Manual Obsidian reload/client-machine acceptance, signed installer, marketplace and production remote relay remain YELLOW/RED.",
      "Readiness must not be changed by this proof alone."
    ]
  };

  try {
    const pluginMain = read(pluginMainPath);
    const serverSource = read(serverPath);
    const packageJson = JSON.parse(read(packageJsonPath));
    proof.checks.pluginCommandRegistered = pluginMain.includes("symbiot-open-browser-gui") && pluginMain.includes("Симбиот: открыть в браузере");
    proof.checks.ribbonUsesBrowserGui = /addRibbonIcon\("bot",\s*"Симбиот",\s*\(\)\s*=>\s*this\.openBrowserGui\(\)\)/.test(pluginMain);
    proof.checks.pluginKeepsDiagnosticsFallback = pluginMain.includes("symbiot-open-diagnostics") && pluginMain.includes("openControlPanel()");
    proof.checks.browserOpenMethodPresent = pluginMain.includes("openBrowserGui()") && (pluginMain.includes("electronShell.openExternal") || pluginMain.includes("window.open"));
    proof.checks.appRouteImplemented = serverSource.includes('url.pathname === "/app"') && serverSource.includes("renderDesktopAppHtml(req)");
    proof.checks.appStateRouteImplemented = serverSource.includes('url.pathname === "/app/state"') && serverSource.includes("app_or_connector_auth_required");
    proof.checks.appRuntimeRouteImplemented = serverSource.includes('url.pathname === "/app/agent-runtime/run"');
    proof.checks.packageScriptRegistered = packageJson.scripts && packageJson.scripts["proof:browser-gui"] === "node ../proof-obp031a-thin-plugin-browser-gui.js";

    await wait(250);
    if (spawnError) throw spawnError;
    await waitForHealth();
    const appHtml = await request("GET", `${BASE_URL}/app`);
    const token = extractToken(appHtml.text);
    const appStateUnauthorized = await request("GET", `${BASE_URL}/app/state`);
    const appState = token ? await request("GET", `${BASE_URL}/app/state?token=${encodeURIComponent(token)}`) : { ok: false, status: 0, json: null, text: "" };
    const compare = token ? await request("POST", `${BASE_URL}/llm/compare`, {
      source: "obp031a-proof",
      token,
      live: false,
      prompt: "Проверь форму трех окон Симбиота без live-вызова."
    }) : { ok: false, status: 0, json: null, text: "" };
    const runtime = token ? await request("POST", `${BASE_URL}/app/agent-runtime/run`, {
      source: "obp031a-proof",
      token,
      approved: true,
      task: "OBP-031A proof: browser GUI запускает локальный runtime MVP."
    }) : { ok: false, status: 0, json: null, text: "" };
    const qrMatch = appHtml.text.match(/<img src="([^"]*\/mobile\/qr\.svg\?token=[^"]+)"/);
    const qr = qrMatch ? await request("GET", qrMatch[1].replace(/&amp;/g, "&")) : { ok: false, status: 0, text: "", headers: {} };
    const results = compare.json && compare.json.comparison && Array.isArray(compare.json.comparison.results) ? compare.json.comparison.results : [];

    proof.checks.appHtmlReturned = appHtml.ok && (appHtml.text.includes("Симбиот: рабочий экран") || appHtml.text.includes("Симбиот HARNES")) && (appHtml.text.includes('data-symbiot-app-shell="thin-plugin-browser-gui"') || appHtml.text.includes('data-symbiot-app-shell="harnes-desktop-browser-gui"'));
    proof.checks.appHasThreeLlmPanes = (appHtml.text.match(/Окно [123]/g) || []).length >= 3 || (appHtml.text.includes("Math.min(3") && appHtml.text.includes("＋ окно"));
    proof.checks.appHasMobileQr = Boolean(qrMatch) && qr.ok && /<svg[\s>]/i.test(qr.text);
    proof.checks.appHasRussianUserCopy = (appHtml.text.includes("Рабочий экран Симбиота") || appHtml.text.includes("Опиши бизнес-миссию")) && (appHtml.text.includes("Что нельзя обещать рынку") || appHtml.text.includes("Граница обещаний"));
    proof.checks.appStateRequiresSession = appStateUnauthorized.status === 401;
    proof.checks.appStateWithSessionOk = appState.ok && appState.json && appState.json.shell && ["thin_obsidian_plugin_browser_gui", "harnes_desktop_browser_gui"].includes(appState.json.shell.mode);
    proof.checks.appStateDoesNotExposeSecretValues = appState.ok && hasNoSecretLeak([appState.text]);
    proof.checks.llmCompareViaAppSession = compare.ok && compare.json && compare.json.comparison && results.length === 3;
    proof.checks.runtimeViaAppSession = runtime.ok && runtime.json && runtime.json.run && runtime.json.run.status === "completed_yellow";
    proof.checks.noSecretLeak = hasNoSecretLeak([appHtml.text, appState.text, compare.text, runtime.text, qr.text]);

    proof.appSession = { tokenFingerprint: sha256(token).slice(0, 12), stateStatus: appState.json ? appState.json.status : null };
    proof.comparisonStatus = compare.json && compare.json.comparison ? compare.json.comparison.status : null;
    proof.runtimeStatus = runtime.json && runtime.json.run ? runtime.json.run.status : null;
    proof.serverOutput = { stdout: stdout.slice(-1000), stderr: stderr.slice(-1000) };
    proof.status = Object.values(proof.checks).every(Boolean)
      ? "PASS_WITH_CONDITIONS_THIN_PLUGIN_BROWSER_GUI_YELLOW"
      : "YELLOW_THIN_PLUGIN_BROWSER_GUI_INCOMPLETE";
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
