const fs = require("fs");
const path = require("path");
const http = require("http");
const net = require("net");
const { spawn, execFileSync } = require("child_process");
const { createHash } = require("crypto");

const ROOT = __dirname;
const CONNECTOR_DIR = fs.existsSync(path.join(ROOT, "symbiot-connector-service")) ? path.join(ROOT, "symbiot-connector-service") : path.join(ROOT, "connector-service");
const DESKTOP_DIR = fs.existsSync(path.join(ROOT, "symbiot-desktop-shell")) ? path.join(ROOT, "symbiot-desktop-shell") : path.join(ROOT, "desktop-shell");
const START_CMD = path.join(ROOT, "START_SYMBIOT_DESKTOP.cmd");
const OUT_DIR = path.join(ROOT, "runtime_logs");
const TEMP_ROOT = path.join(OUT_DIR, "obp058_dispatcher_desktop_sources");
const TEMP_APPDATA = path.join(TEMP_ROOT, "appdata");
const TEMP_CONNECTOR_DATA = path.join(TEMP_ROOT, "connector-data");
const TEMP_VAULT = path.join(TEMP_ROOT, "client-vault");
const TEMP_WATCH_FOLDER = path.join(TEMP_ROOT, "watched-folder");
const OUT_FILE = path.join(OUT_DIR, "SYM_OBSIDIAN_PLUGIN_OBP058_DISPATCHER_DESKTOP_SOURCES_PROOF_2026-08-02.json");
const SCREENSHOT_FILE = path.join(OUT_DIR, "SYM_OBSIDIAN_PLUGIN_OBP058_DISPATCHER_DESKTOP_SOURCES_2026-08-02.png");
const BOOT_STATUS_FILE = path.join(OUT_DIR, "SYM_OBP058_DESKTOP_BOOT_STATUS_2026-08-02.json");
const PROOF_STATE_FILE = path.join(OUT_DIR, "SYM_OBP058_DESKTOP_PROOF_STATE_2026-08-02.json");
const PORT = Number(process.env.SYMBIOT_OBP058_PROOF_PORT || Math.floor(18900 + Math.random() * 500));

function read(file) { return fs.readFileSync(file, "utf8"); }
function sha256(value) { return createHash("sha256").update(String(value || "")).digest("hex"); }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function listen(server, port = 0) {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
}
function nodeExecutable() {
  if (process.env.SYMBIOT_NODE_EXE && fs.existsSync(process.env.SYMBIOT_NODE_EXE)) return process.env.SYMBIOT_NODE_EXE;
  if (process.execPath && fs.existsSync(process.execPath)) return process.execPath;
  return "node";
}
function hasNoSecretLeak(values) {
  return !values.some((value) => /(?:sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_\-$]{12,}|AIza[0-9A-Za-z_-]{12,}|postgresql:\/\/[^:\s]+:[^@\s]+@)/i.test(String(value || "")));
}
function pngDimensions(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return { width: 0, height: 0 };
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
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
async function startFakeTelegramApi(botToken) {
  const counters = { getMe: 0, getUpdates: 0 };
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json; charset=utf-8");
    if (req.url.includes(`/bot${botToken}/getMe`)) {
      counters.getMe += 1;
      res.end(JSON.stringify({ ok: true, result: { id: 123456, username: "symbiot_dispatcher_proof_bot", first_name: "Symbiot Proof", can_join_groups: false } }));
      return;
    }
    if (req.url.includes(`/bot${botToken}/getUpdates`)) {
      counters.getUpdates += 1;
      res.end(JSON.stringify({
        ok: true,
        result: [{
          update_id: 901,
          message: {
            message_id: 44,
            date: Math.floor(Date.now() / 1000),
            text: "Desktop proof Telegram event for Dispatcher",
            chat: { id: 1001, type: "private", username: "dispatcher_proof" }
          }
        }]
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false }));
  });
  const port = await listen(server);
  return { server, counters, baseUrl: `http://127.0.0.1:${port}` };
}
async function startFakeImapServer() {
  const counters = { login: 0, search: 0, fetch: 0 };
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("* OK dispatcher proof imap ready\r\n");
    socket.on("data", (chunk) => {
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        const tag = line.split(/\s+/)[0] || "A000";
        if (/LOGIN/i.test(line)) {
          counters.login += 1;
          socket.write(`${tag} OK LOGIN completed\r\n`);
        } else if (/SELECT/i.test(line)) {
          socket.write(`* 1 EXISTS\r\n${tag} OK SELECT completed\r\n`);
        } else if (/NOOP/i.test(line)) {
          socket.write(`${tag} OK NOOP completed\r\n`);
        } else if (/UID SEARCH/i.test(line)) {
          counters.search += 1;
          socket.write(`* SEARCH 77\r\n${tag} OK SEARCH completed\r\n`);
        } else if (/UID FETCH/i.test(line)) {
          counters.fetch += 1;
          socket.write(`* 1 FETCH (UID 77 BODY[] {160}\r\nFrom: client@example.com\r\nSubject: Dispatcher real IMAP proof\r\nDate: Sun, 02 Aug 2026 10:00:00 +0300\r\n\r\nProof email body for Dispatcher.\r\n)\r\n${tag} OK FETCH completed\r\n`);
        } else if (/LOGOUT/i.test(line)) {
          socket.write(`* BYE logout\r\n${tag} OK LOGOUT completed\r\n`);
          socket.end();
        } else {
          socket.write(`${tag} OK completed\r\n`);
        }
      }
    });
  });
  const port = await listen(server);
  return { server, counters, port };
}
function ensureSafeTempRoot() {
  const resolvedLogs = path.resolve(OUT_DIR);
  const resolvedTemp = path.resolve(TEMP_ROOT);
  const relative = path.relative(resolvedLogs, resolvedTemp);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("unsafe_temp_root");
  fs.rmSync(resolvedTemp, { recursive: true, force: true });
  fs.mkdirSync(path.join(TEMP_VAULT, ".obsidian"), { recursive: true });
  fs.mkdirSync(TEMP_APPDATA, { recursive: true });
  fs.mkdirSync(TEMP_CONNECTOR_DATA, { recursive: true });
  fs.mkdirSync(TEMP_WATCH_FOLDER, { recursive: true });
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
        SYMBIOT_VAULT_PATH: TEMP_VAULT,
        SYMBIOT_APP_URL: `http://127.0.0.1:${PORT}/app?shell=desktop&dispatcher-proof=1`,
        SYMBIOT_DESKTOP_BOOT_STATUS_OUTPUT: BOOT_STATUS_FILE,
        SYMBIOT_DESKTOP_PROOF_STATE_OUTPUT: PROOF_STATE_FILE,
        SYMBIOT_VISUAL_PROOF_OUTPUT: SCREENSHOT_FILE,
        SYMBIOT_VISUAL_PROOF_DISPATCHER_SOURCES: "1",
        SYMBIOT_DISPATCHER_PROOF_TELEGRAM_TOKEN: process.env.SYMBIOT_DISPATCHER_PROOF_TELEGRAM_TOKEN || "",
        SYMBIOT_DISPATCHER_PROOF_EMAIL_HOST: process.env.SYMBIOT_DISPATCHER_PROOF_EMAIL_HOST || "",
        SYMBIOT_DISPATCHER_PROOF_EMAIL_PORT: process.env.SYMBIOT_DISPATCHER_PROOF_EMAIL_PORT || "",
        SYMBIOT_DISPATCHER_PROOF_EMAIL_SECURE: process.env.SYMBIOT_DISPATCHER_PROOF_EMAIL_SECURE || "false",
        SYMBIOT_DISPATCHER_PROOF_EMAIL_USERNAME: process.env.SYMBIOT_DISPATCHER_PROOF_EMAIL_USERNAME || "",
        SYMBIOT_DISPATCHER_PROOF_EMAIL_PASSWORD: process.env.SYMBIOT_DISPATCHER_PROOF_EMAIL_PASSWORD || "",
        SYMBIOT_DISPATCHER_PROOF_EMAIL_MAILBOX: process.env.SYMBIOT_DISPATCHER_PROOF_EMAIL_MAILBOX || "INBOX",
        SYMBIOT_DISPATCHER_PROOF_FOLDER: process.env.SYMBIOT_DISPATCHER_PROOF_FOLDER || TEMP_WATCH_FOLDER,
        SYMBIOT_TELEGRAM_API_BASE: process.env.SYMBIOT_TELEGRAM_API_BASE || "",
        SYMBIOT_LLM_LIVE_ENABLED: "0",
        SYMBIOT_SUPABASE_DB_URL: "",
        DATABASE_URL: "",
        SUPABASE_SERVICE_ROLE_KEY: ""
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ status: null, timeout: true, stdout, stderr });
    }, 180000);
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
  ensureSafeTempRoot();
  for (const file of [OUT_FILE, SCREENSHOT_FILE, `${SCREENSHOT_FILE}.error.json`, BOOT_STATUS_FILE, PROOF_STATE_FILE]) {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
  killProcessOnPort(PORT);

  const expectedSources = ["telegram", "email", "folder", "webhook"];
  const externalWebhookSources = ["whatsapp", "bitrix24"];
  const proofBotToken = "123456:abcdefghijklmnopqrstuvwxyzABCDE";
  let fakeTelegram = null;
  let fakeImap = null;
  const connectorServerPath = path.join(CONNECTOR_DIR, "server.js");
  const desktopMainPath = path.join(DESKTOP_DIR, "main.js");
  const proof = {
    id: "OBP-058",
    date: "2026-08-02",
    project: "SYM-SaaS / Dispatcher MVP",
    gate: "Desktop Dispatcher Sources Full Chain",
    status: "YELLOW_NOT_RUN",
    readinessChanged: false,
    d1Changed: false,
    files: {
      connectorServer: connectorServerPath,
      desktopMain: desktopMainPath,
      screenshot: SCREENSHOT_FILE,
      proofState: PROOF_STATE_FILE,
      tempVault: TEMP_VAULT
    },
    fileHashes: {
      connectorServer: sha256(read(connectorServerPath)),
      desktopMain: sha256(read(desktopMainPath))
    },
    checks: {},
    boundaries: [
      "Desktop/Electron proof uses real connector mechanics against local test Telegram API, local test IMAP, a real watched folder and local HTTP webhook.",
      "No Dmitry personal accounts, production secrets, Supabase live or public external webhooks are used.",
      "WhatsApp and Bitrix24 are not counted as connected until public HTTPS callbacks are approved and configured.",
      "Writes mission artifacts to a temporary proof vault, not Dmitry's live vault.",
      "Does not change D1/readiness."
    ]
  };

  try {
    fakeTelegram = await startFakeTelegramApi(proofBotToken);
    fakeImap = await startFakeImapServer();
    fs.writeFileSync(path.join(TEMP_WATCH_FOLDER, "dispatcher-proof-event.txt"), "Desktop proof folder event for Dispatcher", "utf8");
    process.env.SYMBIOT_TELEGRAM_API_BASE = fakeTelegram.baseUrl;
    process.env.SYMBIOT_DISPATCHER_PROOF_TELEGRAM_TOKEN = proofBotToken;
    process.env.SYMBIOT_DISPATCHER_PROOF_EMAIL_HOST = "127.0.0.1";
    process.env.SYMBIOT_DISPATCHER_PROOF_EMAIL_PORT = String(fakeImap.port);
    process.env.SYMBIOT_DISPATCHER_PROOF_EMAIL_SECURE = "false";
    process.env.SYMBIOT_DISPATCHER_PROOF_EMAIL_USERNAME = "proof@example.com";
    process.env.SYMBIOT_DISPATCHER_PROOF_EMAIL_PASSWORD = "local-proof-password";
    process.env.SYMBIOT_DISPATCHER_PROOF_EMAIL_MAILBOX = "INBOX";
    process.env.SYMBIOT_DISPATCHER_PROOF_FOLDER = TEMP_WATCH_FOLDER;

    const electronCmd = electronCommand();
    proof.electronVersion = electronVersion(electronCmd);
    const capture = await runDesktopShell();
    const screenshotExists = fs.existsSync(SCREENSHOT_FILE);
    const dimensions = screenshotExists ? pngDimensions(SCREENSHOT_FILE) : { width: 0, height: 0 };
    const screenshotBytes = screenshotExists ? fs.statSync(SCREENSHOT_FILE).size : 0;
    const bootStatus = fs.existsSync(BOOT_STATUS_FILE) ? JSON.parse(read(BOOT_STATUS_FILE)) : {};
    const proofState = fs.existsSync(PROOF_STATE_FILE) ? JSON.parse(read(PROOF_STATE_FILE)) : {};
    const dispatcherProof = proofState.dispatcherProof || {};
    const dispatcherConnections = proofState.dispatcherConnections || {};
    const connectedSources = expectedSources.filter((source) => {
      const item = dispatcherConnections[source] || {};
      return item.connected === true
        && item.realConnection === true
        && item.productionConnected === false
        && /^CONNECTED_REAL_/.test(String(item.status || ""));
    });
    const passedSources = expectedSources.filter((source) => {
      const item = dispatcherProof[source] || {};
      return String(item.status || "").includes("PASS")
        && item.runtimeStarted === true
        && item.productionTouched === false
        && Number(item.artifactCount || 0) >= 9
        && Number(item.modelCallsBeforeApproval || 0) === 0;
    });
    const externalNotConnected = externalWebhookSources.filter((source) => {
      const item = dispatcherConnections[source] || {};
      return item.connected !== true;
    });
    const vaultMissionFiles = fs.existsSync(TEMP_VAULT)
      ? fs.readdirSync(TEMP_VAULT, { recursive: true }).filter((item) => String(item).endsWith(".md") || String(item).endsWith(".canvas") || String(item).endsWith(".json"))
      : [];

    proof.capture = capture;
    proof.bootStatus = { ...bootStatus, connectorDir: "[redacted_local_path]" };
    proof.proofState = proofState;
    proof.dispatcherConnections = dispatcherConnections;
    proof.dispatcherProof = dispatcherProof;
    proof.realSourceCounters = {
      telegramGetMe: fakeTelegram.counters.getMe,
      telegramGetUpdates: fakeTelegram.counters.getUpdates,
      imapLogin: fakeImap.counters.login,
      imapSearch: fakeImap.counters.search,
      imapFetch: fakeImap.counters.fetch
    };
    proof.screenshot = { exists: screenshotExists, bytes: screenshotBytes, width: dimensions.width, height: dimensions.height };
    proof.vault = { fileCount: vaultMissionFiles.length };
    proof.checks.electronRuntimeAvailable = /^v\d+\./.test(proof.electronVersion);
    proof.checks.desktopShellLoadedHarnes = proofState.shell === "harnes-desktop-browser-gui" && !proofState.fallback;
    proof.checks.dispatcherSourcesPaneVisible = proofState.hasDispatcherSourcesPane === true;
    proof.checks.connectorsHubVisible = proofState.hasConnectorsHub === true;
    proof.checks.onePrimaryButtonPerSource = Number(proofState.primaryConnectorButtonCount || 0) === 6;
    proof.checks.noTechnicalFieldsOnFirstScreen = Array.isArray(proofState.visibleTechnicalSourceFields) && proofState.visibleTechnicalSourceFields.length === 0;
    proof.checks.sourcesViewDoesNotAutoOpenRightPanel = proofState.previewHidden === true;
    proof.checks.realReceivableSourcesConnected = connectedSources.length === expectedSources.length;
    proof.checks.realExternalApisCalled = fakeTelegram.counters.getMe >= 1 && fakeTelegram.counters.getUpdates >= 1 && fakeImap.counters.login >= 1 && fakeImap.counters.search >= 1 && fakeImap.counters.fetch >= 1;
    proof.checks.externalWebhookSourcesNotFakeConnected = externalNotConnected.length === externalWebhookSources.length;
    proof.checks.dispatcherFullChainClicked = proofState.dispatcherFullChain === "done";
    proof.checks.realReceivableSourcesPassed = passedSources.length === expectedSources.length;
    proof.checks.missionArtifactsWrittenToTempVault = vaultMissionFiles.length >= expectedSources.length * 9;
    proof.checks.screenshotCaptured = capture.status === 0 && !capture.timeout && screenshotExists && dimensions.width >= 1200 && dimensions.height >= 800 && screenshotBytes > 50000;
    proof.checks.noProductionOrSecrets = hasNoSecretLeak([capture.stdout, capture.stderr, JSON.stringify(proofState), JSON.stringify(bootStatus)])
      && !JSON.stringify(proofState).includes(proofBotToken)
      && !JSON.stringify(proofState).includes("local-proof-password");
    proof.checks.noReadinessOrD1Change = proof.readinessChanged === false && proof.d1Changed === false;
    proof.status = Object.values(proof.checks).every(Boolean)
      ? "PASS_WITH_CONDITIONS_DISPATCHER_DESKTOP_SOURCES_FULL_CHAIN_YELLOW"
      : "YELLOW_DISPATCHER_DESKTOP_SOURCES_INCOMPLETE";
  } catch (error) {
    proof.status = "FAILED_DISPATCHER_DESKTOP_SOURCES_RED";
    proof.blocker = error.message;
    proof.errorStack = error.stack ? error.stack.split("\n").slice(0, 8) : [];
  } finally {
    killProcessOnPort(PORT);
    if (fakeTelegram) fakeTelegram.server.close();
    if (fakeImap) fakeImap.server.close();
  }

  proof.passed = proof.status === "PASS_WITH_CONDITIONS_DISPATCHER_DESKTOP_SOURCES_FULL_CHAIN_YELLOW";
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ passed: proof.passed, status: proof.status, evidencePath: OUT_FILE, screenshot: SCREENSHOT_FILE }, null, 2));
  if (!proof.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
